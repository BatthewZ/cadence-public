import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/web/contexts/ProjectContext";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";

import { type Label, useAssignLabel, useCreateLabel, useDeleteLabel, useUpdateLabel } from "./use-labels";

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
const mockDelete = vi.mocked(api.delete);
const mockSendWrite = vi.mocked(sendWrite);

const PROJECT_ID = "proj-1";
const NEW_ID = "00000000-0000-4000-8000-000000000001";
const LABELS_KEY = queryKeys.projects.labels(PROJECT_ID);
const TASKS_KEY = queryKeys.projects.tasks(PROJECT_ID);
const DETAIL_KEY = queryKeys.tasks.detail("t-1");

const bug: Label = {
  id: "l-bug",
  projectId: PROJECT_ID,
  name: "Bug",
  color: "#ef4444",
  taskCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const bugInfo = { id: bug.id, name: bug.name, color: bug.color };
const task = { id: "t-1", title: "Fix login", labels: [bugInfo] } as Task;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  queryClient.setQueryData(LABELS_KEY, { labels: [bug] });
  queryClient.setQueryData(TASKS_KEY, { tasks: [task] });
  queryClient.setQueryData(DETAIL_KEY, { task });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper, invalidateSpy: vi.spyOn(queryClient, "invalidateQueries") };
}

const labelsIn = (qc: QueryClient) => qc.getQueryData<{ labels: Label[] }>(LABELS_KEY)?.labels;
const taskLabelsIn = (qc: QueryClient) => ({
  list: qc.getQueryData<{ tasks: Task[] }>(TASKS_KEY)?.tasks[0].labels,
  detail: qc.getQueryData<{ task: Task }>(DETAIL_KEY)?.task.labels,
});

describe("use-labels offline writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
  });

  it("creates a label under a client id, shown before the server answers", async () => {
    let resolvePost!: (value: unknown) => void;
    mockPost.mockReturnValueOnce(new Promise((resolve) => (resolvePost = resolve)));
    const { queryClient, Wrapper } = setup();
    const { result } = renderHook(() => useCreateLabel(PROJECT_ID), { wrapper: Wrapper });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ name: "Docs", color: "#3b82f6" });
    });
    await vi.waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/labels`, {
        id: NEW_ID,
        name: "Docs",
        color: "#3b82f6",
      }),
    );
    expect(labelsIn(queryClient)?.map((l) => l.id)).toEqual([bug.id, NEW_ID]);

    await act(async () => {
      resolvePost({ label: { id: NEW_ID, projectId: PROJECT_ID, name: "Docs", color: "#3b82f6", createdAt: "x" } });
      await pending;
    });
    // The server row has no taskCount; the merge keeps the optimistic one.
    expect(labelsIn(queryClient)?.[1]).toMatchObject({ id: NEW_ID, createdAt: "x", taskCount: 0 });
  });

  it("rolls a refused create back", async () => {
    mockPost.mockRejectedValueOnce(new Error("409"));
    const { queryClient, Wrapper } = setup();
    const { result } = renderHook(() => useCreateLabel(PROJECT_ID), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ name: "Docs", color: "#3b82f6" })).rejects.toThrow("409");
    });

    expect(labelsIn(queryClient)).toEqual([bug]);
  });

  it("keeps a queued rename in cached tasks and does not refetch", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    const { queryClient, Wrapper, invalidateSpy } = setup();
    const { result } = renderHook(() => useUpdateLabel(PROJECT_ID), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ labelId: bug.id, name: "Defect" });
    });

    expect(labelsIn(queryClient)?.[0].name).toBe("Defect");
    const { list, detail } = taskLabelsIn(queryClient);
    expect(list?.[0].name).toBe("Defect");
    expect(detail?.[0].name).toBe("Defect");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("strips a deleted label from cached tasks, named by the label it removes", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    const { queryClient, Wrapper, invalidateSpy } = setup();
    const { result } = renderHook(() => useDeleteLabel(PROJECT_ID), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(bug.id);
    });

    expect(mockSendWrite).toHaveBeenCalledWith(expect.objectContaining({ label: "Delete label “Bug”" }));
    expect(labelsIn(queryClient)).toEqual([]);
    expect(taskLabelsIn(queryClient)).toEqual({ list: [], detail: [] });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("restores the label everywhere when a delete is refused", async () => {
    mockDelete.mockRejectedValueOnce(new Error("403"));
    const { queryClient, Wrapper } = setup();
    const { result } = renderHook(() => useDeleteLabel(PROJECT_ID), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(bug.id)).rejects.toThrow("403");
    });

    expect(labelsIn(queryClient)).toEqual([bug]);
    expect(taskLabelsIn(queryClient)).toEqual({ list: [bugInfo], detail: [bugInfo] });
  });

  it("runs while the browser is offline instead of pausing", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    onlineManager.setOnline(false);
    const { Wrapper } = setup();
    const { result } = renderHook(() => useUpdateLabel(PROJECT_ID), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ labelId: bug.id, color: "#000000" });
    });

    expect(mockSendWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PATCH", label: "Recolor label “Bug”" }),
    );
  });
});

describe("useAssignLabel rollback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("undoes only the assignment when refused, keeping edits made while it was in flight", async () => {
    const docs: Label = { ...bug, id: "l-docs", name: "Docs", taskCount: 0 };
    const other = { id: "t-2", title: "Other", labels: [] } as unknown as Task;
    const { queryClient, Wrapper } = setup();
    queryClient.setQueryData(LABELS_KEY, { labels: [bug, docs] });
    queryClient.setQueryData(TASKS_KEY, { tasks: [task, other] });
    let reject!: (err: Error) => void;
    mockPost.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    const { result } = renderHook(() => useAssignLabel("t-1", PROJECT_ID), { wrapper: Wrapper });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync(docs.id).catch(() => undefined);
    });
    await vi.waitFor(() => expect(taskLabelsIn(queryClient).detail).toHaveLength(2));
    // Meanwhile: the detail view renames the task, and another card is edited.
    queryClient.setQueryData<{ task: Task }>(DETAIL_KEY, (old) => old && { task: { ...old.task, title: "Renamed" } });
    queryClient.setQueryData<{ tasks: Task[] }>(TASKS_KEY, (old) =>
      old && { tasks: old.tasks.map((t) => (t.id === "t-2" ? { ...t, title: "Other, edited" } : t)) },
    );

    await act(async () => {
      reject(new Error("403"));
      await pending;
    });

    expect(taskLabelsIn(queryClient)).toEqual({ list: [bugInfo], detail: [bugInfo] });
    expect(labelsIn(queryClient)?.map((l) => [l.id, l.taskCount])).toEqual([["l-bug", 1], ["l-docs", 0]]);
    expect(queryClient.getQueryData<{ task: Task }>(DETAIL_KEY)?.task.title).toBe("Renamed");
    expect(queryClient.getQueryData<{ tasks: Task[] }>(TASKS_KEY)?.tasks[1].title).toBe("Other, edited");
  });
});

