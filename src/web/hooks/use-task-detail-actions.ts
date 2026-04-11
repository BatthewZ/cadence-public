import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { Task } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

interface UseTaskDetailActionsOptions {
  taskId: string;
  localTask: TaskDetail | null;
  setLocalTask: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  toast: (
    message: string,
    options?: { variant?: "info" | "success" | "warning" | "error" },
  ) => string;
  workspaceId: string;
  projectId?: string;
  /** Called after successful task deletion (Dialog: close dialog; Panel: clear URL param) */
  onDeleteSuccess: () => void;
  /** Optional: update task in board context (Panel has ProjectContext, Dialog doesn't) */
  updateTaskInContext?: (taskId: string, updates: Partial<Task>) => void;
  /** Optional: add task to board context (for duplicate result or recurring task) */
  addTaskToContext?: (task: Task) => void;
  /** Optional: remove task from board context on delete */
  removeTaskFromContext?: (taskId: string) => void;
  /** Optional: refetch the project task list after duplication */
  refetchTasks?: () => void;
}

/**
 * Encapsulates task-level actions (complete/uncomplete, duplicate, delete)
 * and the delete confirmation dialog state.
 *
 * Shared between TaskDetailDialog and TaskDetailPanelInner. The two consumers
 * differ in post-success behavior (Dialog closes, Panel clears URL), which is
 * handled via the `onDeleteSuccess` callback and optional context updaters.
 */
export function useTaskDetailActions({
  taskId,
  localTask,
  setLocalTask,
  toast,
  workspaceId,
  projectId,
  onDeleteSuccess,
  updateTaskInContext,
  addTaskToContext,
  removeTaskFromContext,
  refetchTasks,
}: UseTaskDetailActionsOptions) {
  const qc = useQueryClient();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteTaskMutation = useMutation({
    mutationFn: () => api.delete<{ ok: boolean }>(`/api/tasks/${taskId}`),
  });

  const handleToggleComplete = useCallback(async () => {
    if (!localTask) return;
    const wasCompleted = localTask.completed;
    setLocalTask((prev) => (prev ? { ...prev, completed: !wasCompleted } : prev));
    updateTaskInContext?.(taskId, { completed: !wasCompleted });
    freshnessTracker.recordMutation("tasks");

    const endpoint = wasCompleted
      ? `/api/tasks/${taskId}/uncomplete`
      : `/api/tasks/${taskId}/complete`;
    try {
      const res = await api.post<{ task: Task; nextRecurringTask?: Task }>(endpoint, {});
      setLocalTask((prev) => (prev ? { ...prev, ...res.task } : prev));
      updateTaskInContext?.(taskId, res.task);
      if (res.nextRecurringTask) {
        addTaskToContext?.(res.nextRecurringTask);
        toast("Next occurrence created", { variant: "success" });
      }
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) });
      if (projectId) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(projectId) });
      }
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaces.dashboardMyTasksPrefix(workspaceId),
      });
    } catch {
      setLocalTask((prev) => (prev ? { ...prev, completed: wasCompleted } : prev));
      updateTaskInContext?.(taskId, { completed: wasCompleted });
      toast("Failed to update task", { variant: "error" });
    }
  }, [
    localTask,
    setLocalTask,
    updateTaskInContext,
    addTaskToContext,
    taskId,
    projectId,
    workspaceId,
    qc,
    toast,
  ]);

  const handleDuplicateTask = useCallback(async () => {
    freshnessTracker.recordMutation("tasks");
    try {
      const result = await api.post<{ task: Task }>(`/api/tasks/${taskId}/duplicate`, {});
      if (addTaskToContext) {
        addTaskToContext(result.task);
      }
      refetchTasks?.();
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspaceId) });
      if (projectId) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
      }
      toast("Task duplicated", { variant: "success" });
    } catch {
      toast("Failed to duplicate task", { variant: "error" });
    }
  }, [taskId, addTaskToContext, refetchTasks, qc, workspaceId, projectId, toast]);

  const handleDeleteTask = useCallback(async () => {
    try {
      await deleteTaskMutation.mutateAsync();
      setShowDeleteDialog(false);
      // Cancel task queries to prevent 404 refetches while the view unmounts
      await qc.cancelQueries({ queryKey: ["tasks", taskId] });
      removeTaskFromContext?.(taskId);
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspaceId) });
      if (projectId) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(projectId) });
      }
      onDeleteSuccess();
      toast("Task deleted", { variant: "success" });
    } catch {
      toast("Failed to delete task", { variant: "error" });
    }
  }, [deleteTaskMutation, qc, taskId, removeTaskFromContext, workspaceId, projectId, onDeleteSuccess, toast]);

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    handleToggleComplete,
    handleDuplicateTask,
    handleDeleteTask,
    isDeleting: deleteTaskMutation.isPending,
  };
}
