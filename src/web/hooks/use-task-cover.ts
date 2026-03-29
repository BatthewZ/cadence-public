import { useCallback } from "react";

import type { Task } from "@/web/contexts/ProjectContext";
import { useFileUpload } from "@/web/hooks/use-file-upload";
import { api } from "@/web/lib/api/client";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

interface UseTaskCoverOptions {
  taskId: string;
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
 * Encapsulates cover image upload, removal, and position-change logic
 * for a task's detail panel.
 *
 * This mirrors the pattern established by `useProjectCover` but is
 * task-specific: upload goes to `/api/tasks/:id/cover`, position changes
 * persist through the task patch mutation, and removals optimistically
 * clear the cover then rollback on failure.
 */
export function useTaskCover({
  taskId,
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

  const handleCoverUpload = useCallback(
    async (file: File) => {
      const result = await uploadFile(file, {
        endpoint: `/api/tasks/${taskId}/cover`,
        method: "put",
        fieldName: "file",
      });
      if (result) {
        setLocalTask((prev) =>
          prev ? { ...prev, coverImageKey: result.coverImageKey } : prev,
        );
        updateTaskInContext(taskId, {
          coverImageKey: result.coverImageKey,
        });
        invalidateTaskQueries();
      }
    },
    [taskId, uploadFile, setLocalTask, updateTaskInContext, invalidateTaskQueries],
  );

  const handleCoverRemove = useCallback(async () => {
    setLocalTask((prev) =>
      prev ? { ...prev, coverImageKey: null } : prev,
    );
    updateTaskInContext(taskId, { coverImageKey: null });
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
    coverUploading,
    handleCoverUpload,
    handleCoverRemove,
    handleCoverPositionChange,
  };
}
