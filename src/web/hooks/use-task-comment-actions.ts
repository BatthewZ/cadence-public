import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

import type { Comment, Task } from "@/web/contexts/ProjectContext";
import {
  type CommentsPage,
  mergeServerComment,
  optimisticAddComment,
  optimisticUpdateComment,
  rollbackAddComment,
  rollbackUpdateComment,
} from "@/web/hooks/use-task-comments";
import { apiErrorMessage } from "@/web/lib/api/client";
import { sendWrite, type WriteResult } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

function taskTitle(qc: QueryClient, taskId: string): string {
  const title = qc.getQueryData<{ task: { title: string } }>(queryKeys.tasks.detail(taskId))?.task.title;
  return title ? `“${title}”` : "a task";
}

interface UseTaskCommentActionsOptions {
  taskId: string;
  currentUserId: string | undefined;
  currentUserName: string | undefined;
  invalidateTaskQueries: () => void;
  toast: (
    message: string,
    options?: { variant?: "info" | "success" | "warning" | "error" },
  ) => string;
  /** The view's copy of the task, whose `commentCount` heads the comments list. */
  setLocalTask: Dispatch<SetStateAction<TaskDetail | null>>;
  /** The task's project: its card on the board shows the comment count too. */
  projectId: string | undefined;
}

const withCommentDelta = <T extends { commentCount?: number }>(task: T, delta: number): T => ({
  ...task,
  commentCount: Math.max(0, (task.commentCount ?? 0) + delta),
});

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
  setLocalTask,
  projectId,
}: UseTaskCommentActionsOptions) {
  const qc = useQueryClient();

  // Relative to the current value, in the panel and on the card alike: two comments made before
  // either is answered (offline, say) count 2, and a rollback undoes exactly its own change.
  const changeCommentCount = useCallback(
    (delta: 1 | -1) => {
      setLocalTask((prev) => (prev ? withCommentDelta(prev, delta) : prev));
      if (!projectId) return;
      qc.setQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId), (old) =>
        old ? { tasks: old.tasks.map((t) => (t.id === taskId ? withCommentDelta(t, delta) : t)) } : old,
      );
    },
    [qc, taskId, projectId, setLocalTask],
  );

  // Local editing state
  const [commentBody, setCommentBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");

  // A queued write's reply comes with the refresh after the queue drains.
  const invalidateUnlessQueued = (result: WriteResult<unknown> | undefined) => {
    if (result?.status !== "queued") invalidateTaskQueries();
  };

  const createComment = useMutation({
    networkMode: "always",
    mutationFn: (input: { id: string; body: string }) =>
      sendWrite<{ comment: Comment }>({
        method: "POST",
        path: `/api/tasks/${taskId}/comments`,
        body: input,
        label: `Comment on ${taskTitle(qc, taskId)}`,
      }),
    onSuccess: (result) => {
      if (result.status === "sent") mergeServerComment(qc, taskId, result.data.comment);
    },
    onSettled: invalidateUnlessQueued,
  });

  const updateCommentMutation = useMutation({
    networkMode: "always",
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      sendWrite<{ comment: Comment }>({
        method: "PATCH",
        path: `/api/comments/${commentId}`,
        body: { body },
        label: `Edit comment on ${taskTitle(qc, taskId)}`,
      }),
    onSettled: invalidateUnlessQueued,
  });

  const deleteCommentMutation = useMutation({
    networkMode: "always",
    mutationFn: (commentId: string) =>
      sendWrite<{ ok: boolean }>({
        method: "DELETE",
        path: `/api/comments/${commentId}`,
        label: `Delete comment on ${taskTitle(qc, taskId)}`,
      }),
    onSettled: invalidateUnlessQueued,
  });

  const handleAddComment = useCallback(async () => {
    if (!commentBody.trim()) return;
    const body = commentBody.trim();
    setCommentBody("");

    const id = crypto.randomUUID();
    optimisticAddComment(qc, taskId, {
      id,
      body,
      authorId: currentUserId ?? "",
      authorName: currentUserName ?? "",
    });
    changeCommentCount(1);

    try {
      await createComment.mutateAsync({ id, body });
    } catch (err) {
      rollbackAddComment(qc, taskId, id);
      changeCommentCount(-1);
      setCommentBody(body);
      toast(apiErrorMessage(err, "Failed to add comment"), { variant: "error" });
    }
  }, [
    commentBody,
    qc,
    taskId,
    currentUserId,
    currentUserName,
    changeCommentCount,
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
      } catch (err) {
        rollbackUpdateComment(qc, taskId, commentId, oldBody);
        toast(apiErrorMessage(err, "Failed to update comment"), { variant: "error" });
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
      changeCommentCount(-1);

      try {
        await deleteCommentMutation.mutateAsync(commentId);
      } catch (err) {
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
        changeCommentCount(1);
        toast(apiErrorMessage(err, "Failed to delete comment"), { variant: "error" });
      }
    },
    [qc, taskId, changeCommentCount, deleteCommentMutation, toast],
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
