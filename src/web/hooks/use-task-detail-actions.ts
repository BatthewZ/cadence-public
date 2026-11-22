import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { Task, TaskCompletionResponse } from "@/web/contexts/ProjectContext";
import { api, apiErrorMessage } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";
import { taskCompletionWrite } from "@/web/lib/task-writes";
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
  /** Called as soon as the delete is confirmed, before the server answers (Dialog: close dialog; Panel: clear URL param) */
  onDeleteSuccess: () => void;
  /** Optional: update task in board context (Panel has ProjectContext, Dialog doesn't) */
  updateTaskInContext?: (taskId: string, updates: Partial<Task>) => void;
  /** Optional: add task to board context (for duplicate result or recurring task) */
  addTaskToContext?: (task: Task) => void;
  /** Optional: remove task from board context on delete; returns its undo */
  removeTaskFromContext?: (taskId: string) => () => void;
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

  const handleToggleComplete = useCallback(async () => {
    if (!localTask) return;
    const wasCompleted = localTask.completed;
    setLocalTask((prev) => (prev ? { ...prev, completed: !wasCompleted } : prev));
    updateTaskInContext?.(taskId, { completed: !wasCompleted });
    freshnessTracker.recordMutation("tasks");

    try {
      const result = await sendWrite<TaskCompletionResponse>(
        taskCompletionWrite({ id: taskId, title: localTask.title }, !wasCompleted),
      );
      if (result.status === "queued") return;
      const res = result.data;
      setLocalTask((prev) => (prev ? { ...prev, ...res.task } : prev));
      updateTaskInContext?.(taskId, res.task);
      if (res.nextRecurringTask) {
        addTaskToContext?.(res.nextRecurringTask);
        toast("Next occurrence created", { variant: "success" });
      }
      if (res.removedRecurringTaskId) {
        removeTaskFromContext?.(res.removedRecurringTaskId);
        toast("Next occurrence removed", { variant: "info" });
      }
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.activity(taskId) });
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspaceId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.activity(workspaceId) });
      if (projectId) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(projectId) });
        void qc.invalidateQueries({ queryKey: queryKeys.projects.activity(projectId) });
      }
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
    removeTaskFromContext,
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
    } catch (err) {
      toast(apiErrorMessage(err, "Failed to duplicate task"), { variant: "error" });
    }
  }, [taskId, addTaskToContext, refetchTasks, qc, workspaceId, projectId, toast]);

  const taskTitle = localTask?.title ?? "task";
  const handleDeleteTask = useCallback(async () => {
    setShowDeleteDialog(false);
    // Cancel task queries to prevent 404 refetches while the view unmounts
    await qc.cancelQueries({ queryKey: ["tasks", taskId] });
    const restore = removeTaskFromContext?.(taskId);
    freshnessTracker.recordMutation("tasks");
    onDeleteSuccess();
    try {
      const result = await sendWrite({
        method: "DELETE",
        path: `/api/tasks/${taskId}`,
        label: `Delete “${taskTitle}”`,
      });
      if (result.status === "sent") {
        void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspaceId) });
        if (projectId) {
          void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(projectId) });
        }
      }
      toast("Task deleted", { variant: "success" });
    } catch {
      restore?.();
      toast("Failed to delete task", { variant: "error" });
    }
  }, [qc, taskId, taskTitle, removeTaskFromContext, workspaceId, projectId, onDeleteSuccess, toast]);

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    handleToggleComplete,
    handleDuplicateTask,
    handleDeleteTask,
  };
}
