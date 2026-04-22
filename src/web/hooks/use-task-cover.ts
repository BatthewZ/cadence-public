import { useCallback } from "react";

import type { UnsplashCoverPayload } from "@/shared/schemas/unsplash";
import type { Task } from "@/web/contexts/ProjectContext";
import { useFileUpload } from "@/web/hooks/use-file-upload";
import { resolveCoverDisplay } from "@/web/hooks/use-project-cover";
import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

interface UseTaskCoverOptions {
  taskId: string;
  /**
   * Current R2 key for the task's cover, or null/undefined if none. Used to
   * derive `coverUrl` — callers should pass the live task state (local or
   * remote) so optimistic updates flow through to the <CoverImage/>.
   */
  coverImageKey: string | null | undefined;
  /**
   * Current Unsplash payload for the task, or null/undefined. Takes
   * precedence over `coverImageKey` when both are transiently set — the XOR
   * invariant normally guarantees only one is populated.
   */
  coverUnsplash: UnsplashCoverPayload | null | undefined;
  setLocalTask: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  updateTaskInContext: (taskId: string, updates: Partial<Task>) => void;
  invalidateTaskQueries: () => void;
  patchTaskMutateAsync: (updates: Partial<TaskDetail>) => Promise<unknown>;
  toast: (
    message: string,
    options?: { variant?: "info" | "success" | "warning" | "error" },
  ) => string;
  refetch: () => Promise<unknown>;
}

/**
 * Encapsulates cover image upload, Unsplash apply, removal, and position-
 * change logic for a task's detail panel.
 *
 * XOR invariant: a task has at most one cover source at any time — either an
 * uploaded `coverImageKey` (R2) or a `coverUnsplash` payload, never both.
 * The backend enforces this atomically on every apply/remove; this hook
 * mirrors it in every optimistic path so callers never observe a transient
 * "both set" state. On upload we clear `coverUnsplash`; on Unsplash apply we
 * clear `coverImageKey`; on remove we clear both.
 *
 * This mirrors the pattern established by `useProjectCover` but is
 * task-specific: uploads hit `/api/tasks/:id/cover`, Unsplash apply hits
 * `/api/tasks/:id/cover/unsplash` (a JSON PUT — `useFileUpload` is not used
 * for that path since the payload isn't multipart), and position changes
 * persist through the task patch mutation.
 */
export function useTaskCover({
  taskId,
  coverImageKey,
  coverUnsplash,
  setLocalTask,
  updateTaskInContext,
  invalidateTaskQueries,
  patchTaskMutateAsync,
  toast,
  refetch,
}: UseTaskCoverOptions) {
  const { state: coverUploadState, upload: uploadFile } = useFileUpload<{
    coverImageKey: string;
  }>();
  const coverUploading = coverUploadState === "uploading";

  const { coverUrl, coverSrcSet, coverAttribution } = resolveCoverDisplay(
    coverImageKey,
    coverUnsplash,
  );

  const handleCoverUpload = useCallback(
    async (file: File) => {
      freshnessTracker.recordMutation("tasks");
      const result = await uploadFile(file, {
        endpoint: `/api/tasks/${taskId}/cover`,
        method: "put",
        fieldName: "file",
      });
      if (result) {
        // XOR: uploading a file cover clears any existing Unsplash payload.
        setLocalTask((prev) =>
          prev
            ? { ...prev, coverImageKey: result.coverImageKey, coverUnsplash: null }
            : prev,
        );
        updateTaskInContext(taskId, {
          coverImageKey: result.coverImageKey,
          coverUnsplash: null,
        });
        invalidateTaskQueries();
      }
    },
    [taskId, uploadFile, setLocalTask, updateTaskInContext, invalidateTaskQueries],
  );

  const handleCoverApplyUnsplash = useCallback(
    async (payload: UnsplashCoverPayload) => {
      freshnessTracker.recordMutation("tasks");
      // XOR: applying Unsplash clears any uploaded image key.
      setLocalTask((prev) =>
        prev ? { ...prev, coverImageKey: null, coverUnsplash: payload } : prev,
      );
      updateTaskInContext(taskId, {
        coverImageKey: null,
        coverUnsplash: payload,
      });
      try {
        await api.put<{ coverUnsplash: UnsplashCoverPayload }>(
          `/api/tasks/${taskId}/cover/unsplash`,
          payload,
        );
        invalidateTaskQueries();
      } catch {
        toast("Failed to set Unsplash cover", { variant: "error" });
        void refetch();
      }
    },
    [taskId, setLocalTask, updateTaskInContext, invalidateTaskQueries, toast, refetch],
  );

  const handleCoverRemove = useCallback(async () => {
    freshnessTracker.recordMutation("tasks");
    // XOR: clear both columns optimistically — the backend clears both too.
    setLocalTask((prev) =>
      prev ? { ...prev, coverImageKey: null, coverUnsplash: null } : prev,
    );
    updateTaskInContext(taskId, { coverImageKey: null, coverUnsplash: null });
    try {
      await api.delete(`/api/tasks/${taskId}/cover`);
      invalidateTaskQueries();
    } catch {
      toast("Failed to remove cover image", { variant: "error" });
      void refetch();
    }
  }, [taskId, setLocalTask, updateTaskInContext, invalidateTaskQueries, toast, refetch]);

  const handleCoverPositionChange = useCallback(
    async (pos: number) => {
      freshnessTracker.recordMutation("tasks");
      setLocalTask((prev) =>
        prev ? { ...prev, coverImagePosition: pos } : prev,
      );
      updateTaskInContext(taskId, { coverImagePosition: pos });
      try {
        await patchTaskMutateAsync({
          coverImagePosition: pos,
        } as Partial<TaskDetail>);
      } catch {
        toast("Failed to update cover position", { variant: "error" });
        void refetch();
      }
    },
    [taskId, setLocalTask, updateTaskInContext, patchTaskMutateAsync, toast, refetch],
  );

  return {
    coverUrl,
    coverSrcSet,
    coverAttribution,
    coverUploading,
    handleCoverUpload,
    handleCoverApplyUnsplash,
    handleCoverRemove,
    handleCoverPositionChange,
  };
}
