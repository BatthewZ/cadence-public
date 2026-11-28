import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { TaskGroup } from "@/web/contexts/ProjectContext";

const sendWriteMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/web/lib/offline/send-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/web/lib/offline/send-write")>();
  sendWriteMock.mockImplementation(actual.sendWrite);
  return { ...actual, sendWrite: sendWriteMock };
});

vi.mock("@/web/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/web/lib/api/client")>("@/web/lib/api/client");
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { api, ApiError } from "@/web/lib/api/client";

import { useTaskActions } from "./use-task-actions";

const mockPatch = api.patch as ReturnType<typeof vi.fn>;
const mockDelete = api.delete as unknown as Mock<(url: string) => Promise<unknown>>;

const TASK_GROUPS: TaskGroup[] = [
  { id: "g-todo", name: "To Do", isCompletionGroup: false, position: "a" },
  { id: "g-done", name: "Done", isCompletionGroup: true, position: "b" },
];

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** A completed task sitting in the completion group — moving it out reopens it. */
function setup() {
  const updateTask = vi.fn();
  const restore = vi.fn();
  const removeTask = vi.fn(() => restore);
  const { result } = renderHook(
    () =>
      useTaskActions({
        task: {
          id: "t-1",
          title: "Ship it",
          priority: "none",
          assigneeId: null,
          taskGroupId: "g-done",
          completed: true,
          dueDate: null,
          position: "000001",
        },
        updateTask,
        removeTask,
        taskGroups: TASK_GROUPS,
        workspaceId: "ws-1",
      }),
    { wrapper }
  );
  return { result, updateTask, removeTask, restore };
}

describe("useTaskActions.handleMoveToGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops the next occurrence the server deleted when the move reopens a recurring task", async () => {
    mockPatch.mockResolvedValue({
      task: { id: "t-1", taskGroupId: "g-todo", completed: false },
      removedRecurringTaskId: "t-2",
    });
    const { result, removeTask } = setup();

    await result.current.handleMoveToGroup("g-todo");

    await waitFor(() => {
      expect(removeTask).toHaveBeenCalledWith("t-2");
    });
  });

  it("removes nothing when the move reports no deleted occurrence", async () => {
    mockPatch.mockResolvedValue({
      task: { id: "t-1", taskGroupId: "g-todo", completed: false },
      removedRecurringTaskId: null,
    });
    const { result, removeTask } = setup();

    await result.current.handleMoveToGroup("g-todo");

    expect(removeTask).not.toHaveBeenCalled();
  });
});

describe("useTaskActions offline-capable writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the optimistic move and skips reconciliation when the move is queued", async () => {
    sendWriteMock.mockResolvedValueOnce({ status: "queued" });
    const { result, updateTask, removeTask } = setup();

    await result.current.handleMoveToGroup("g-todo");

    expect(sendWriteMock).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/api/tasks/t-1/move",
      body: { taskGroupId: "g-todo", position: "000001" },
      label: "Move “Ship it”",
    });
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith("t-1", { taskGroupId: "g-todo", completed: false });
    expect(removeTask).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("removes the task before the server answers the delete", async () => {
    mockDelete.mockImplementation(() => new Promise(() => {}));
    const { result, removeTask } = setup();

    void result.current.handleDeleteConfirm();

    await waitFor(() => expect(removeTask).toHaveBeenCalledWith("t-1"));
    expect(mockDelete).toHaveBeenCalledWith("/api/tasks/t-1");
  });

  it("puts the task back when the server refuses the delete", async () => {
    mockDelete.mockRejectedValue(new ApiError(403, "Forbidden"));
    const { result, restore } = setup();

    await result.current.handleDeleteConfirm();

    expect(restore).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("Failed to delete task", { variant: "error" });
  });

  it("keeps the task deleted when the delete is queued", async () => {
    sendWriteMock.mockResolvedValueOnce({ status: "queued" });
    const { result, removeTask, restore } = setup();

    await result.current.handleDeleteConfirm();

    expect(removeTask).toHaveBeenCalledWith("t-1");
    expect(restore).not.toHaveBeenCalled();
  });
});
