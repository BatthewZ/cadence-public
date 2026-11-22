import { useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import type { TaskPriority } from "@/shared/types/roles";
import type { Task, TaskCompletionResponse } from "@/web/contexts/ProjectContext";
import { useProject } from "@/web/contexts/ProjectContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { api, apiErrorMessage } from "@/web/lib/api/client";
import { sendWrites } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";

import { Button } from "../Button";
import { ConfirmDialog } from "../ConfirmDialog";
import { DueDatePopover } from "../DueDatePopover";
import { IconButton } from "../IconButton";
import { Text } from "../Text";
import { useToast } from "../ToastContext";
import { AssignDropdown } from "./AssignDropdown";
import { MoveToGroupDropdown } from "./MoveToGroupDropdown";
import { PriorityDropdown } from "./PriorityDropdown";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface BulkActionBarProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BulkActionBar({ selectedIds, onClearSelection }: BulkActionBarProps) {
  const { addTask: ctxAddTask, updateTask: ctxUpdateTask, removeTask: ctxRemoveTask, tasks, members, taskGroups } =
    useProject();
  const { workspace, members: workspaceMembers } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  const selectedTasks = tasks.filter((t) => selectedIds.has(t.id));

  // Use workspace members for assignee list, fall back to project members
  const assigneeList = workspaceMembers.length > 0
    ? workspaceMembers.map((m) => ({
        userId: m.userId ?? m.id,
        name: m.user?.name ?? "Unknown",
        image: m.user?.image ?? null,
      }))
    : members.map((m) => ({
        userId: m.userId,
        name: m.name,
        image: m.image ?? null,
      }));

  /* ---- Helpers ---- */

  function pluralTasks(verb: string) {
    return `${verb} ${count} task${count !== 1 ? "s" : ""}`;
  }

  function invalidateSelectedTasks() {
    for (const t of selectedTasks) {
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(t.id) });
    }
  }

  /**
   * Optimistic bulk PATCH: applies `optimisticFields` immediately via context,
   * sends `apiPayload` to the server, and rolls back on failure using fields
   * extracted by `getRollback`. A queued write counts as done: it replays later.
   */
  async function optimisticBulkPatch(
    optimisticFields: Record<string, unknown>,
    apiPayload: Record<string, unknown>,
    getRollback: (t: Task) => Record<string, unknown>,
    labelFor: (t: Task) => string,
  ) {
    const rollbacks = selectedTasks.map((t) => ({ id: t.id, ...getRollback(t) }));
    for (const t of selectedTasks) {
      ctxUpdateTask(t.id, optimisticFields);
    }

    try {
      const results = await Promise.all(
        sendWrites(
          selectedTasks.map((t) => ({
            method: "PATCH" as const,
            path: `/api/tasks/${t.id}`,
            body: apiPayload,
            label: labelFor(t),
          }))
        )
      );
      if (results.some((r) => r.status === "sent")) invalidateSelectedTasks();
      toast(pluralTasks("Updated"), { variant: "success" });
      onClearSelection();
    } catch {
      for (const rb of rollbacks) {
        const { id, ...fields } = rb;
        ctxUpdateTask(id, fields);
      }
      toast("Failed to update tasks", { variant: "error" });
    }
  }

  /* ---- Bulk actions ---- */

  function handleBulkPriority(priority: TaskPriority) {
    return optimisticBulkPatch(
      { priority },
      { priority },
      (t) => ({ priority: t.priority }),
      (t) => `Set priority of “${t.title}”`,
    );
  }

  function handleBulkAssign(assigneeId: string | null, assigneeName?: string) {
    return optimisticBulkPatch(
      { assigneeId, assigneeName: assigneeName ?? undefined },
      { assigneeId },
      (t) => ({ assigneeId: t.assigneeId, assigneeName: t.assigneeName }),
      (t) => `Assign “${t.title}”`,
    );
  }

  function handleBulkSetDueDate(dueDate: string | null) {
    return optimisticBulkPatch(
      { dueDate },
      { dueDate },
      (t) => ({ dueDate: t.dueDate }),
      (t) => `Set due date of “${t.title}”`,
    );
  }

  async function handleBulkMoveToGroup(targetGroupId: string) {
    const targetGroup = taskGroups.find((g) => g.id === targetGroupId);
    const rollbacks = selectedTasks.map((t) => ({
      id: t.id,
      taskGroupId: t.taskGroupId,
      completed: t.completed,
    }));
    const optimisticCompleted = targetGroup?.isCompletionGroup ?? false;
    for (const t of selectedTasks) {
      ctxUpdateTask(t.id, { taskGroupId: targetGroupId, completed: optimisticCompleted });
    }

    try {
      const moves = sendWrites<TaskCompletionResponse>(
        selectedTasks.map((t) => ({
          method: "PATCH" as const,
          path: `/api/tasks/${t.id}/move`,
          body: { taskGroupId: targetGroupId, position: t.position },
          label: `Move “${t.title}”`,
        }))
      );
      const results = await Promise.all(
        moves.map((move, i) =>
          move.then((result) => {
            if (result.status === "queued") return result;
            ctxUpdateTask(selectedTasks[i].id, result.data.task);
            if (result.data.removedRecurringTaskId) {
              ctxRemoveTask(result.data.removedRecurringTaskId);
            }
            return result;
          })
        )
      );
      if (results.some((r) => r.status === "sent")) {
        invalidateSelectedTasks();
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboardMyTasksPrefix(workspace.id) });
      }
      toast(pluralTasks("Moved"), { variant: "success" });
      onClearSelection();
    } catch {
      for (const rb of rollbacks) {
        ctxUpdateTask(rb.id, {
          taskGroupId: rb.taskGroupId,
          completed: rb.completed,
        });
      }
      toast("Failed to move tasks", { variant: "error" });
    }
  }

  async function handleBulkDuplicate() {
    try {
      const results = await Promise.all(
        selectedTasks.map((t) => api.post<{ task: Task }>(`/api/tasks/${t.id}/duplicate`, {}))
      );
      for (const result of results) {
        ctxAddTask(result.task);
      }
      invalidateSelectedTasks();
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
      toast(pluralTasks("Duplicated"), { variant: "success" });
      onClearSelection();
    } catch (err) {
      toast(apiErrorMessage(err, "Failed to duplicate tasks"), { variant: "error" });
    }
  }

  async function handleBulkDelete() {
    setDeleting(true);
    const deleted = selectedTasks.map((t) => ({ task: t, restore: ctxRemoveTask(t.id) }));
    onClearSelection();
    setShowDeleteDialog(false);
    const outcomes = await Promise.allSettled(
      sendWrites(
        deleted.map(({ task }) => ({
          method: "DELETE" as const,
          path: `/api/tasks/${task.id}`,
          label: `Delete “${task.title}”`,
        }))
      )
    );
    setDeleting(false);
    const failed = deleted.filter((_, i) => outcomes[i].status === "rejected");
    for (const { restore } of failed) restore();
    if (outcomes.some((o) => o.status === "fulfilled" && o.value.status === "sent")) {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
    }
    if (failed.length > 0) {
      toast(
        failed.length === deleted.length
          ? "Failed to delete tasks"
          : `Failed to delete ${failed.length} of ${deleted.length} tasks`,
        { variant: "error" },
      );
    } else {
      toast(pluralTasks("Deleted"), { variant: "success" });
    }
  }

  return (
    <>
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-0 border border-border-default shadow-xl animate-in slide-in-from-bottom-4 duration-200"
        role="toolbar"
        aria-label="Bulk actions"
      >
        {/* Selection count */}
        <Text variant="body-2" weight="semibold" className="whitespace-nowrap mr-1">
          {count} selected
        </Text>

        <div className="w-px h-5 bg-border-default" />

        {/* Priority */}
        <PriorityDropdown onSelect={(p) => void handleBulkPriority(p)} />

        {/* Assign to */}
        <AssignDropdown members={assigneeList} onSelect={(id, name) => void handleBulkAssign(id, name)} />

        {/* Move to section */}
        <MoveToGroupDropdown taskGroups={taskGroups} onSelect={(id) => void handleBulkMoveToGroup(id)} />

        {/* Set due date */}
        <DueDatePopover onSelect={(d) => void handleBulkSetDueDate(d)} />

        {/* Duplicate */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleBulkDuplicate()}
        >
          <Copy size={14} />
          <span className="hidden sm:inline ml-1">Duplicate</span>
        </Button>

        <div className="w-px h-5 bg-border-default" />

        {/* Delete */}
        <Button
          variant="ghost"
          size="sm"
          className="text-status-error hover:bg-status-error/10"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline ml-1">Delete</span>
        </Button>

        <div className="w-px h-5 bg-border-default" />

        {/* Clear selection */}
        <IconButton
          aria-label="Clear selection"
          className="size-7"
          onClick={onClearSelection}
        >
          <X size={14} />
        </IconButton>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => void handleBulkDelete()}
        title="Delete tasks"
        confirming={deleting}
      >
        Are you sure you want to delete {count} task{count !== 1 ? "s" : ""}? This action
        cannot be undone.
      </ConfirmDialog>
    </>
  );
}
