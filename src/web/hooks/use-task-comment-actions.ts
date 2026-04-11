import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { Comment, Task } from "@/web/contexts/ProjectContext";
import {
  type CommentsPage,
  optimisticAddComment,
  optimisticUpdateComment,
  rollbackAddComment,
  rollbackUpdateComment,
} from "@/web/hooks/use-task-comments";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

interface UseTaskCommentActionsOptions {
  taskId: string;
  currentUserId: string | undefined;
  currentUserName: string | undefined;
  invalidateTaskQueries: () => void;
  toast: (
    message: string,
    options?: { variant?: "info" | "success" | "warning" | "error" },
  ) => string;
  /**
   * Optional context updater for comment count on board task cards.
   * The Panel passes `updateTaskInContext`; the Dialog passes a noop or omits it.
   */
  updateTaskInContext?: (taskId: string, updates: Partial<Task>) => void;
  /** Current comment count from localTask, used for optimistic count updates. */
  commentCount?: number;
}

/**
 * Encapsulates comment CRUD mutations, local editing state, and optimistic
 * update/rollback logic for the task detail views.
 *
 * Shared between TaskDetailDialog and TaskDetailPanelInner to eliminate
 * duplicated comment management code. Uses the cache helpers from
 * `use-task-comments.ts` for optimistic cache manipulation.
 */
export function useTaskCommentActions({
  taskId,
  currentUserId,
  currentUserName,
  invalidateTaskQueries,
  toast,
  updateTaskInContext,
  commentCount,
}: UseTaskCommentActionsOptions) {
  const qc = useQueryClient();

  // Local editing state
  const [commentBody, setCommentBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");

  // Mutations
  const createComment = useMutation({
    mutationFn: (input: { body: string }) =>
      api.post<{ comment: Comment }>(`/api/tasks/${taskId}/comments`, input),
    onSettled: invalidateTaskQueries,
  });

  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api.patch<{ comment: Comment }>(`/api/comments/${commentId}`, { body }),
    onSettled: invalidateTaskQueries,
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      api.delete<{ ok: boolean }>(`/api/comments/${commentId}`),
    onSettled: invalidateTaskQueries,
  });

  const handleAddComment = useCallback(async () => {
    if (!commentBody.trim()) return;
    const body = commentBody.trim();
    setCommentBody("");

    const optimisticComment = optimisticAddComment(qc, taskId, {
      body,
      authorId: currentUserId ?? "",
      authorName: currentUserName ?? "",
    });
    updateTaskInContext?.(taskId, { commentCount: (commentCount ?? 0) + 1 });

    try {
      await createComment.mutateAsync({ body });
    } catch {
      rollbackAddComment(qc, taskId, optimisticComment.id);
      updateTaskInContext?.(taskId, {
        commentCount: Math.max(0, (commentCount ?? 1) - 1),
      });
      setCommentBody(body);
      toast("Failed to add comment", { variant: "error" });
    }
  }, [
    commentBody,
    qc,
    taskId,
    currentUserId,
    currentUserName,
    updateTaskInContext,
    commentCount,
    createComment,
    toast,
  ]);

  const handleUpdateComment = useCallback(
    async (commentId: string) => {
      const body = editingCommentBody.trim();
      if (!body) return;
      setEditingCommentId(null);

      const oldBody = optimisticUpdateComment(qc, taskId, commentId, body);

      try {
        await updateCommentMutation.mutateAsync({ commentId, body });
      } catch {
        rollbackUpdateComment(qc, taskId, commentId, oldBody);
        toast("Failed to update comment", { variant: "error" });
      }
    },
    [editingCommentBody, qc, taskId, updateCommentMutation, toast],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      // Find the comment in cache for rollback
      const cacheData = qc.getQueryData<{
        pages: CommentsPage[];
        pageParams: unknown[];
      }>(queryKeys.tasks.comments(taskId));
      let removedComment: Comment | undefined;
      if (cacheData) {
        for (const page of cacheData.pages) {
          removedComment = page.comments.find((c) => c.id === commentId);
          if (removedComment) break;
        }
      }
      if (!removedComment) return;

      // Optimistically remove from cache
      qc.setQueryData<{ pages: CommentsPage[]; pageParams: unknown[] }>(
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
      updateTaskInContext?.(taskId, {
        commentCount: Math.max(0, (commentCount ?? 1) - 1),
      });

      try {
        await deleteCommentMutation.mutateAsync(commentId);
      } catch {
        // Restore on failure
        qc.setQueryData<{ pages: CommentsPage[]; pageParams: unknown[] }>(
          queryKeys.tasks.comments(taskId),
          (old) => {
            if (!old) return old;
            const pages = [...old.pages];
            const lastIdx = pages.length - 1;
            pages[lastIdx] = {
              ...pages[lastIdx],
              comments: [...pages[lastIdx].comments, removedComment],
            };
            return { ...old, pages };
          },
        );
        updateTaskInContext?.(taskId, {
          commentCount: (commentCount ?? 0) + 1,
        });
        toast("Failed to delete comment", { variant: "error" });
      }
    },
    [qc, taskId, updateTaskInContext, commentCount, deleteCommentMutation, toast],
  );

  const resetCommentState = useCallback(() => {
    setCommentBody("");
    setEditingCommentId(null);
    setEditingCommentBody("");
  }, []);

  return {
    commentBody,
    setCommentBody,
    editingCommentId,
    setEditingCommentId,
    editingCommentBody,
    setEditingCommentBody,
    handleAddComment,
    handleUpdateComment,
    handleDeleteComment,
    resetCommentState,
    isAddingComment: createComment.isPending,
  };
}
