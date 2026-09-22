import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskGroup } from "@/web/contexts/ProjectContext";

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
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
  useToast: () => ({ toast: vi.fn() }),
}));

import { api } from "@/web/lib/api/client";

import { useTaskActions } from "./use-task-actions";

const mockPatch = api.patch as ReturnType<typeof vi.fn>;

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
  const removeTask = vi.fn();
  const { result } = renderHook(
    () =>
      useTaskActions({
        task: {
          id: "t-1",
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
    { wrapper },
  );
  return { result, updateTask, removeTask };
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
