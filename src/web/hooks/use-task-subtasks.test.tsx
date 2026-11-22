import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Subtask } from "@/web/contexts/ProjectContext";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

import { useLocalTask } from "./use-local-task";
import { useTaskSubtasks } from "./use-task-subtasks";

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

vi.mock("@/web/lib/offline/send-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/web/lib/offline/send-write")>();
  return { ...actual, sendWrite: vi.fn(actual.sendWrite) };
});

import { api } from "@/web/lib/api/client";
const mockPost = vi.mocked(api.post);
const mockPatch = vi.mocked(api.patch);
const mockSendWrite = vi.mocked(sendWrite);

const TASK_ID = "task-1";
const NEW_ID = "00000000-0000-4000-8000-000000000001";
const existing: Subtask = { id: "s-1", title: "Draft", completed: false, position: "a0" };

const DETAIL_KEY = queryKeys.tasks.detail(TASK_ID);

/** The hook as a detail view runs it: its working copy comes from `useLocalTask` over the detail query. */
async function setup() {
  const invalidateTaskQueries = vi.fn();
  const updateTaskInContext = vi.fn();
  const toast = vi.fn(() => "toast-id");
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const seed = { id: TASK_ID, title: "Fix login", subtasks: [existing] } as TaskDetail;
  queryClient.setQueryData(DETAIL_KEY, { task: seed });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => {
    // As in the views: the server copy is the detail query's data, so writes to it flow back.
    const { data } = useQuery<{ task: TaskDetail }>({ queryKey: DETAIL_KEY, queryFn: () => new Promise(() => {}), enabled: false });
    const { localTask, setLocalTask } = useLocalTask(TASK_ID, data?.task);
    const subtasks = useTaskSubtasks({
      taskId: TASK_ID,
      localTask,
      setLocalTask,
      updateTaskInContext,
      invalidateTaskQueries,
      toast,
    });
    return { localTask, ...subtasks };
  }, { wrapper });
  // The working copy is adopted from the query in a microtask (useTaskServerSync).
  await act(async () => {});
  const saved = () => queryClient.getQueryData<{ task: TaskDetail }>(DETAIL_KEY)?.task.subtasks;
  return { result, invalidateTaskQueries, updateTaskInContext, toast, saved };
}

async function addSubtask(result: Awaited<ReturnType<typeof setup>>["result"], title: string) {
  act(() => result.current.setNewSubtaskTitle(title));
  await act(async () => {
    await result.current.handleAddSubtask();
  });
}

describe("useTaskSubtasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a new subtask at once under the client id the create request sends", async () => {
    let resolvePost!: (value: unknown) => void;
    mockPost.mockReturnValueOnce(new Promise((resolve) => (resolvePost = resolve)));
    const { result, invalidateTaskQueries } = await setup();

    act(() => result.current.setNewSubtaskTitle("Write tests"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleAddSubtask();
    });

    expect(result.current.localTask?.subtasks.map((s) => s.id)).toEqual(["s-1", NEW_ID]);
    expect(mockPost).toHaveBeenCalledWith(`/api/tasks/${TASK_ID}/subtasks`, {
      id: NEW_ID,
      title: "Write tests",
    });
    expect(mockSendWrite).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Add subtask “Write tests”" }),
    );

    const serverRow: Subtask = { id: NEW_ID, title: "Write tests", completed: false, position: "a1" };
    await act(async () => {
      resolvePost({ subtask: serverRow });
      await pending;
    });
    expect(result.current.localTask?.subtasks).toEqual([existing, serverRow]);
    expect(invalidateTaskQueries).toHaveBeenCalled();
  });

  it("keeps a queued subtask and does not refetch", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    const { result, invalidateTaskQueries, toast } = await setup();

    await addSubtask(result, "Offline subtask");

    expect(result.current.localTask?.subtasks.map((s) => s.title)).toEqual(["Draft", "Offline subtask"]);
    expect(invalidateTaskQueries).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("removes the subtask when the server refuses", async () => {
    mockPost.mockRejectedValueOnce(new Error("boom"));
    const { result, toast, updateTaskInContext } = await setup();

    await addSubtask(result, "Rejected");

    expect(result.current.localTask?.subtasks).toEqual([existing]);
    // Back to the one subtask it started with, not one below.
    expect(updateTaskInContext).toHaveBeenLastCalledWith(TASK_ID, { subtaskCount: 1, subtaskCompletedCount: 0 });
    expect(toast).toHaveBeenCalledWith("Failed to add subtask", { variant: "error" });
  });

  it("keeps a queued toggle without refetching, and reverts a refused one", async () => {
    const { result, invalidateTaskQueries } = await setup();

    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    await act(async () => {
      await result.current.handleSubtaskToggle(existing);
    });
    expect(result.current.localTask?.subtasks[0].completed).toBe(true);
    expect(invalidateTaskQueries).not.toHaveBeenCalled();

    const completed = result.current.localTask!.subtasks[0];
    mockPatch.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await result.current.handleSubtaskToggle(completed);
    });
    expect(mockPatch).toHaveBeenCalledWith("/api/subtasks/s-1", { completed: false });
    expect(result.current.localTask?.subtasks[0].completed).toBe(true);
  });

  it("writes each edit to the task's detail query, so reopening the view keeps it", async () => {
    mockSendWrite.mockResolvedValue({ status: "queued" });
    const { result, saved } = await setup();

    await addSubtask(result, "Offline subtask");
    await act(async () => {
      await result.current.handleSubtaskToggle(existing);
    });

    expect(saved()?.map((s) => [s.title, s.completed])).toEqual([
      ["Draft", true],
      ["Offline subtask", false],
    ]);
  });

  it("sets the card's counts from the subtasks as they stand, across edits made before any settles", async () => {
    mockSendWrite.mockResolvedValue({ status: "queued" });
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-00000000000a")
      .mockReturnValueOnce("00000000-0000-4000-8000-00000000000b");
    const { result, updateTaskInContext } = await setup();

    await addSubtask(result, "Two");
    await addSubtask(result, "Three");
    await act(async () => {
      await result.current.handleSubtaskToggle(existing);
    });
    expect(updateTaskInContext).toHaveBeenLastCalledWith(TASK_ID, { subtaskCount: 3, subtaskCompletedCount: 1 });

    await act(async () => {
      await result.current.handleDeleteSubtask("s-1");
    });
    expect(updateTaskInContext).toHaveBeenLastCalledWith(TASK_ID, { subtaskCount: 2, subtaskCompletedCount: 0 });
  });
});
