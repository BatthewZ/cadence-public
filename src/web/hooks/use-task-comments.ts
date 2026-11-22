import { type QueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Comment } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";

export interface CommentsPage {
  comments: Comment[];
  nextCursor: string | null;
}

type InfiniteCommentsData = { pages: CommentsPage[]; pageParams: unknown[] };

// ---------------------------------------------------------------------------
// Optimistic cache helpers for task comments.
// Shared between TaskDetailDialog and TaskDetailPanel so the optimistic
// insert / update / rollback logic lives in a single place.
// ---------------------------------------------------------------------------

/**
 * Optimistically appends a comment to the last page of the infinite comments
 * cache. `id` is the client id the create request sends, so the row needs no
 * swap when the server answers.
 */
export function optimisticAddComment(
  qc: QueryClient,
  taskId: string,
  opts: { id: string; body: string; authorId: string; authorName: string },
): void {
  freshnessTracker.recordMutation("tasks");
  const optimisticComment: Comment = {
    id: opts.id,
    body: opts.body,
    authorId: opts.authorId,
    authorName: opts.authorName,
    createdAt: new Date().toISOString(),
  };
  const key = queryKeys.tasks.comments(taskId);
  const current = qc.getQueryData<InfiniteCommentsData>(key);
  if (!current || current.pages.length === 0) {
    // Nothing loaded for this task yet (created offline, or never opened before the connection
    // dropped): start the list with this comment, or it wouldn't show until the device is back
    // online. Seeded stale (`updatedAt: 0`) so the real list still loads as soon as it can.
    qc.setQueryData<InfiniteCommentsData>(
      key,
      { pages: [{ comments: [optimisticComment], nextCursor: null }], pageParams: [undefined] },
      { updatedAt: 0 },
    );
    return;
  }
  qc.setQueryData<InfiniteCommentsData>(
    key,
    (old) => {
      if (!old || old.pages.length === 0) return old;
      const pages = [...old.pages];
      const lastIdx = pages.length - 1;
      pages[lastIdx] = {
        ...pages[lastIdx],
        comments: [...pages[lastIdx].comments, optimisticComment],
      };
      return { ...old, pages };
    },
  );
}

/** Replaces a cached comment with the server's copy of the same row. */
export function mergeServerComment(qc: QueryClient, taskId: string, comment: Comment): void {
  qc.setQueryData<InfiniteCommentsData>(
    queryKeys.tasks.comments(taskId),
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          comments: page.comments.map((c) => (c.id === comment.id ? { ...c, ...comment } : c)),
        })),
      };
    },
  );
}

/** Removes a previously-added optimistic comment from the cache (rollback). */
export function rollbackAddComment(
  qc: QueryClient,
  taskId: string,
  commentId: string,
): void {
  qc.setQueryData<InfiniteCommentsData>(
    queryKeys.tasks.comments(taskId),
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          comments: page.comments.filter((c) => c.id !== commentId),
        })),
      };
    },
  );
}

/**
 * Optimistically updates a comment's body in the cache.
 * Returns the previous body so the caller can rollback on error.
 */
export function optimisticUpdateComment(
  qc: QueryClient,
  taskId: string,
  commentId: string,
  newBody: string,
): string {
  freshnessTracker.recordMutation("tasks");
  let oldBody = "";
  qc.setQueryData<InfiniteCommentsData>(
    queryKeys.tasks.comments(taskId),
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          comments: page.comments.map((c) => {
            if (c.id === commentId) {
              oldBody = c.body;
              return { ...c, body: newBody, updatedAt: new Date().toISOString() };
            }
            return c;
          }),
        })),
      };
    },
  );
  return oldBody;
}

/** Reverts a comment's body to its previous value (rollback). */
export function rollbackUpdateComment(
  qc: QueryClient,
  taskId: string,
  commentId: string,
  previousBody: string,
): void {
  qc.setQueryData<InfiniteCommentsData>(
    queryKeys.tasks.comments(taskId),
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          comments: page.comments.map((c) =>
            c.id === commentId ? { ...c, body: previousBody } : c,
          ),
        })),
      };
    },
  );
}

/**
 * Fetches paginated comments for a task using cursor-based infinite scrolling.
 * Shared between TaskDetailPanel and TaskDetailDialog to avoid duplicating
 * the query setup, flattening logic, and pagination config.
 */
export function useTaskComments(taskId: string, options?: { enabled?: boolean }) {
  const query = useInfiniteQuery<CommentsPage>({
    queryKey: queryKeys.tasks.comments(taskId),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (pageParam) params.set("cursor", pageParam as string);
      return api.get<CommentsPage>(
        `/api/tasks/${taskId}/comments?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: options?.enabled,
  });

  const comments = useMemo(
    () => query.data?.pages.flatMap((p) => p.comments) ?? [],
    [query.data],
  );

  return {
    comments,
    isLoading: query.isLoading,
    isError: query.isError,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
