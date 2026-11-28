import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Comment } from "@/web/contexts/ProjectContext";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

import { useTaskCommentActions } from "./use-task-comment-actions";
import type { CommentsPage } from "./use-task-comments";

vi.mock("@/web/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/web/lib/api/client")>("@/web/lib/api/client");
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
const mockSendWrite = vi.mocked(sendWrite);

const TASK_ID = "task-1";
const PROJECT_ID = "project-1";
const NEW_ID = "00000000-0000-4000-8000-000000000001";
const COMMENTS_KEY = queryKeys.tasks.comments(TASK_ID);

const existing: Comment = {
  id: "c-1",
  body: "First",
  authorId: "u-2",
  authorName: "Bea",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  queryClient.setQueryData(COMMENTS_KEY, {
    pages: [{ comments: [existing], nextCursor: null }],
    pageParams: [undefined],
  });
  queryClient.setQueryData(queryKeys.tasks.detail(TASK_ID), {
    task: { id: TASK_ID, title: "Fix login" },
  });
  const invalidateTaskQueries = vi.fn();
  const toast = vi.fn(() => "toast-id");
  // The board's cached card, and the panel's own copy of the task: both show 1 comment.
  queryClient.setQueryData(queryKeys.projects.tasks(PROJECT_ID), {
    tasks: [{ id: TASK_ID, commentCount: 1 }],
  });
  const local = {
    current: { id: TASK_ID, title: "Fix login", commentCount: 1 } as TaskDetail | null,
  };
  const setLocalTask = (next: SetStateAction<TaskDetail | null>) => {
    local.current = typeof next === "function" ? next(local.current) : next;
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(
    () =>
      useTaskCommentActions({
        taskId: TASK_ID,
        currentUserId: "u-1",
        currentUserName: "Ada",
        invalidateTaskQueries,
        toast,
        setLocalTask,
        projectId: PROJECT_ID,
      }),
    { wrapper: Wrapper }
  );
  const counts = () => ({
    panel: local.current?.commentCount,
    card: queryClient.getQueryData<{ tasks: { commentCount: number }[] }>(
      queryKeys.projects.tasks(PROJECT_ID)
    )?.tasks[0].commentCount,
  });
  return { queryClient, result, invalidateTaskQueries, toast, counts };
}

function cachedComments(queryClient: QueryClient): Comment[] {
  const data = queryClient.getQueryData<{ pages: CommentsPage[] }>(COMMENTS_KEY);
  return data?.pages.flatMap((p) => p.comments) ?? [];
}

async function addComment(result: ReturnType<typeof setup>["result"], body: string) {
  act(() => result.current.setCommentBody(body));
  await act(async () => {
    await result.current.handleAddComment();
  });
}

describe("useTaskCommentActions — add comment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
  });

  it("shows the comment at once under a client id that the create request sends", async () => {
    let resolvePost!: (value: unknown) => void;
    mockPost.mockReturnValueOnce(new Promise((resolve) => (resolvePost = resolve)));
    const { queryClient, result } = setup();

    act(() => result.current.setCommentBody("Looks good"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleAddComment();
    });

    expect(cachedComments(queryClient).at(-1)).toMatchObject({
      id: NEW_ID,
      body: "Looks good",
      authorId: "u-1",
      authorName: "Ada",
    });
    await vi.waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(`/api/tasks/${TASK_ID}/comments`, {
        id: NEW_ID,
        body: "Looks good",
      })
    );

    const serverRow: Comment = {
      ...existing,
      id: NEW_ID,
      body: "Looks good",
      authorId: "u-1",
      authorName: "Ada",
      createdAt: "2026-01-02T00:00:00.000Z",
    };
    await act(async () => {
      resolvePost({ comment: serverRow });
      await pending;
    });
    expect(cachedComments(queryClient)).toEqual([existing, serverRow]);
  });

  it("labels the write with the task's title", async () => {
    mockPost.mockResolvedValueOnce({ comment: { ...existing, id: NEW_ID } });
    const { result } = setup();

    await addComment(result, "Hi");

    expect(mockSendWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", label: "Comment on “Fix login”" })
    );
  });

  it("keeps a queued comment and does not refetch", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    const { queryClient, result, invalidateTaskQueries, toast } = setup();

    await addComment(result, "Offline note");

    expect(cachedComments(queryClient).map((c) => c.id)).toEqual(["c-1", NEW_ID]);
    expect(invalidateTaskQueries).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(result.current.commentBody).toBe("");
  });

  it("rolls the comment back and restores the draft when the server refuses", async () => {
    mockPost.mockRejectedValueOnce(new Error("boom"));
    const { queryClient, result, toast, counts } = setup();

    await addComment(result, "Rejected");

    expect(cachedComments(queryClient)).toEqual([existing]);
    expect(result.current.commentBody).toBe("Rejected");
    // Back to where it was, not one below.
    expect(counts()).toEqual({ panel: 1, card: 1 });
    expect(toast).toHaveBeenCalledWith("Failed to add comment", { variant: "error" });
  });

  it("runs while the browser is offline instead of pausing", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    onlineManager.setOnline(false);
    const { result } = setup();

    await addComment(result, "On the train");

    expect(mockSendWrite).toHaveBeenCalledWith(
      expect.objectContaining({ body: { id: NEW_ID, body: "On the train" } })
    );
  });

  it("counts each new comment in the panel heading and on the card, even before any is answered", async () => {
    mockSendWrite.mockResolvedValue({ status: "queued" });
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-00000000000a")
      .mockReturnValueOnce("00000000-0000-4000-8000-00000000000b");
    const { result, counts } = setup();

    await addComment(result, "One");
    await addComment(result, "Two");

    expect(counts()).toEqual({ panel: 3, card: 3 });
  });
});

describe("useTaskCommentActions — delete comment", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lowers both counts, and restores them if the server refuses", async () => {
    let reject!: (err: Error) => void;
    mockSendWrite.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    const { result, counts } = setup();

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleDeleteComment("c-1");
    });
    expect(counts()).toEqual({ panel: 0, card: 0 });

    await act(async () => {
      reject(new Error("boom"));
      await pending;
    });
    expect(counts()).toEqual({ panel: 1, card: 1 });
  });
});
