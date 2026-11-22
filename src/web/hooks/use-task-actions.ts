import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { TaskPriority } from "@/shared/types/roles";
import { useToast } from "@/web/components/ui/ToastContext";
import type { Task, TaskCompletionResponse, TaskGroup } from "@/web/contexts/ProjectContext";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";

/* ------------------------------------------------------------------ */
/*  useTaskActions                                                     */
/*                                                                     */
/*  Shared optimistic-update handlers for task mutations used across   */
/*  ProjectBoard (TaskCard) and ProjectTimeline (TimelineTaskRow).     */
/*  Centralises the identical API calls, rollback logic, and toast     */
/*  error messages so each view can reuse them without duplication.    */
/* ------------------------------------------------------------------ */

interface UseTaskActionsOptions {
  /** The task to act on. */
  task: Pick<
    Task,
    | "id"
    | "title"
    | "priority"
    | "assigneeId"
    | "assigneeName"
    | "taskGroupId"
    | "completed"
    | "dueDate"
  > & {
    /** Position is optional — only board cards have it for move revert. */
    position?: string;
  };
  /** Optimistic context updater (from ProjectContext). */
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  /** Optimistic context remover (from ProjectContext); returns its undo. */
  removeTask: (taskId: string) => () => void;
  /** Available task groups for move-to-group logic. */
  taskGroups: TaskGroup[];
  /** Workspace ID — needed to invalidate dashboard queries on delete. */
  workspaceId: string;
}

interface UseTaskActionsReturn {
  handlePriorityChange: (priority: TaskPriority) => Promise<void>;
  handleAssigneeChange: (assigneeId: string | null, assigneeName?: string) => Promise<void>;
  handleMoveToGroup: (targetGroupId: string) => Promise<void>;
  handleDueDateChange: (date: string | null) => Promise<void>;
  handleDeleteConfirm: () => Promise<void>;
  /** Whether a delete request is currently in flight. */
  deleting: boolean;
  showDeleteDialog: boolean;
  setShowDeleteDialog: (open: boolean) => void;
}

export function useTaskActions({
  task,
  updateTask,
  removeTask,
  taskGroups,
  workspaceId,
}: UseTaskActionsOptions): UseTaskActionsReturn {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const invalidateTask = () =>
    void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(task.id) });

  const handlePriorityChange = async (priority: TaskPriority) => {
    const oldPriority = task.priority;
    updateTask(task.id, { priority });
    freshnessTracker.recordMutation("tasks");
    try {
      const result = await sendWrite({
        method: "PATCH",
        path: `/api/tasks/${task.id}`,
        body: { priority },
        label: `Set priority of “${task.title}”`,
      });
      if (result.status === "sent") invalidateTask();
    } catch {
      updateTask(task.id, { priority: oldPriority });
      toast("Failed to update priority", { variant: "error" });
    }
  };

  const handleAssigneeChange = async (assigneeId: string | null, assigneeName?: string) => {
    const oldAssigneeId = task.assigneeId;
    const oldAssigneeName = task.assigneeName;
    updateTask(task.id, { assigneeId, assigneeName: assigneeName ?? undefined });
    freshnessTracker.recordMutation("tasks");
    try {
      const result = await sendWrite({
        method: "PATCH",
        path: `/api/tasks/${task.id}`,
        body: { assigneeId },
        label: `Assign “${task.title}”`,
      });
      if (result.status === "sent") invalidateTask();
    } catch {
      updateTask(task.id, { assigneeId: oldAssigneeId, assigneeName: oldAssigneeName });
      toast("Failed to update assignee", { variant: "error" });
    }
  };

  const handleMoveToGroup = async (targetGroupId: string) => {
    if (targetGroupId === task.taskGroupId) return;
    const oldGroupId = task.taskGroupId;
    const oldPosition = task.position;
    const oldCompleted = task.completed;
    const targetGroup = taskGroups.find((g) => g.id === targetGroupId);
    const optimisticCompleted = targetGroup?.isCompletionGroup ?? task.completed;
    updateTask(task.id, { taskGroupId: targetGroupId, completed: optimisticCompleted });
    freshnessTracker.recordMutation("tasks");
    try {
      const movePayload: Record<string, string> = { taskGroupId: targetGroupId };
      if (oldPosition != null) {
        movePayload.position = oldPosition;
      }
      const result = await sendWrite<TaskCompletionResponse>({
        method: "PATCH",
        path: `/api/tasks/${task.id}/move`,
        body: movePayload,
        label: `Move “${task.title}”`,
      });
      if (result.status === "sent") {
        updateTask(task.id, result.data.task);
        if (result.data.removedRecurringTaskId) {
          removeTask(result.data.removedRecurringTaskId);
        }
        invalidateTask();
      }
    } catch {
      const revert: Partial<Task> = {
        taskGroupId: oldGroupId,
        completed: oldCompleted,
      };
      if (oldPosition != null) {
        revert.position = oldPosition;
      }
      updateTask(task.id, revert);
      toast("Failed to move task", { variant: "error" });
    }
  };

  const handleDueDateChange = async (date: string | null) => {
    const oldDueDate = task.dueDate;
    updateTask(task.id, { dueDate: date });
    freshnessTracker.recordMutation("tasks");
    try {
      const result = await sendWrite({
        method: "PATCH",
        path: `/api/tasks/${task.id}`,
        body: { dueDate: date },
        label: `Set due date of “${task.title}”`,
      });
      if (result.status === "sent") invalidateTask();
    } catch {
      updateTask(task.id, { dueDate: oldDueDate });
      toast("Failed to update due date", { variant: "error" });
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    const restore = removeTask(task.id);
    freshnessTracker.recordMutation("tasks");
    setShowDeleteDialog(false);
    try {
      const result = await sendWrite({
        method: "DELETE",
        path: `/api/tasks/${task.id}`,
        label: `Delete “${task.title}”`,
      });
      if (result.status === "sent") {
        void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(task.id) });
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspaceId) });
      }
    } catch {
      restore();
      toast("Failed to delete task", { variant: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return {
    handlePriorityChange,
    handleAssigneeChange,
    handleMoveToGroup,
    handleDueDateChange,
    handleDeleteConfirm,
    deleting,
    showDeleteDialog,
    setShowDeleteDialog,
  };
}
