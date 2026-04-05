import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Check,
  CheckSquare,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Repeat,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useSearchParams } from "react-router-dom";

import { TaskCheckbox } from "@/web/components/form/TaskCheckbox";
import { LabelChip } from "@/web/components/project/LabelChip";
import { Avatar } from "@/web/components/ui/Avatar";
import { Card } from "@/web/components/ui/Card";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { IconButton } from "@/web/components/ui/IconButton";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { TaskContextMenuItems } from "@/web/components/ui/TaskContextMenuItems";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import { type Task, useProject } from "@/web/contexts/ProjectContext";
import { useTaskActions } from "@/web/hooks/use-task-actions";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { isDueToday, isOverdue } from "@/web/util/date";
import {
  PRIORITY_BADGE_VARIANT,
  PRIORITY_BORDER_CLASS,
  PRIORITY_DOT_CLASS,
  PRIORITY_TEXT_CLASS,
} from "@/web/util/task-display";

import { taskIdStr } from "./dnd-helpers";

// ---------------------------------------------------------------------------
// SortableTaskCard
// ---------------------------------------------------------------------------

export function SortableTaskCard({
  task,
  overlay,
  selected,
  onToggleSelect,
}: {
  task: Task;
  overlay?: boolean;
  selected?: boolean;
  onToggleSelect?: (taskId: string, e: MouseEvent) => void;
}) {
  const [, setSearchParams] = useSearchParams();
  const {
    project,
    updateTask: ctxUpdateTask,
    removeTask: ctxRemoveTask,
    addTask,
    members,
    taskGroups,
  } = useProject();
  const { toast } = useToast();
  const qc = useQueryClient();
  const {
    handlePriorityChange,
    handleAssigneeChange,
    handleMoveToGroup,
    handleDueDateChange,
    handleDeleteConfirm,
    deleting,
    showDeleteDialog,
    setShowDeleteDialog,
  } = useTaskActions({
    task,
    updateTask: ctxUpdateTask,
    removeTask: ctxRemoveTask,
    taskGroups,
    workspaceId: project.workspaceId,
  });

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: taskIdStr(task.id),
    data: { type: "task", task },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const badgeVariant = PRIORITY_BADGE_VARIANT[task.priority];

  const overdue = !task.completed && isOverdue(task.dueDate);
  const dueToday = !task.completed && isDueToday(task.dueDate);
  const dueDateColor = overdue
    ? "text-status-error"
    : dueToday
      ? "text-status-warning"
      : "text-fg-secondary";

  const formattedDue = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  const handleClick = (e: MouseEvent) => {
    if (isDragging) return;
    // Shift+click or Ctrl/Cmd+click toggles selection
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(task.id, e);
      return;
    }
    // Plain click: open detail panel (no selection)
    setSearchParams({ task: task.id });
  };

  const handleCheckboxChange = async (checked: boolean) => {
    // Optimistic update
    ctxUpdateTask(task.id, { completed: checked });

    try {
      const endpoint = checked
        ? `/api/tasks/${task.id}/complete`
        : `/api/tasks/${task.id}/uncomplete`;
      const res = await api.post<{ task: Task; nextRecurringTask?: Task }>(endpoint, {});
      // Apply the full server response (includes new taskGroupId, position)
      ctxUpdateTask(task.id, res.task);
      if (res.nextRecurringTask) {
        addTask(res.nextRecurringTask);
      }
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(task.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(project.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboardMyTasksPrefix(project.workspaceId) });
    } catch {
      // Revert
      ctxUpdateTask(task.id, { completed: !checked });
      toast("Failed to update task", { variant: "error" });
    }
  };

  return (
    <>
      <div
        ref={overlay ? undefined : setNodeRef}
        style={overlay ? undefined : style}
        {...(overlay ? {} : attributes)}
        {...(overlay ? {} : listeners)}
      >
        <Card
          padding="r5"
          shadow="sm"
          className={`group relative cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow duration-200 ${
            PRIORITY_BORDER_CLASS[task.priority] ?? ""
          } ${overlay ? "shadow-lg rotate-2" : ""} ${task.completed ? "opacity-60" : ""} ${
            selected ? "ring-2 ring-accent border-accent" : ""
          }`}
          onClick={handleClick}
        >
          {/* Selection checkmark overlay */}
          {selected && (
            <div className="absolute top-1 left-1 z-10 size-5 rounded-full bg-accent flex items-center justify-center">
              <Check size={12} className="text-fg-on-accent" />
            </div>
          )}
          {/* Quick actions menu — visible on hover */}
          {!overlay && (
            <div
              className="absolute top-1 right-1 hover-reveal z-10"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <DropdownMenu placement="bottom-end">
                <DropdownMenu.Trigger asChild>
                  <IconButton
                    aria-label="Task actions"
                    className="size-6 shrink-0 p-1 bg-surface-1/80 hover:bg-surface-2 backdrop-blur-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal size={14} />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content className="min-w-[11.25rem]">
                  <TaskContextMenuItems
                    task={task}
                    members={members}
                    taskGroups={taskGroups}
                    onPriorityChange={(p) => void handlePriorityChange(p)}
                    onAssigneeChange={(id, name) => void handleAssigneeChange(id, name)}
                    onMoveToGroup={(id) => void handleMoveToGroup(id)}
                    onDueDateChange={(d) => void handleDueDateChange(d)}
                    onDeleteRequest={() => setShowDeleteDialog(true)}
                  />
                </DropdownMenu.Content>
              </DropdownMenu>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-1.5">
              <div
                className="shrink-0 mt-0.5"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <TaskCheckbox
                  size="sm"
                  checked={task.completed}
                  onChange={(checked) => void handleCheckboxChange(checked)}
                />
              </div>
              {task.icon && (
                <IconDisplay name={task.icon} size={14} className="mt-0.5 text-fg-muted" />
              )}
              <Text
                variant="body-2"
                weight="semibold"
                className={`line-clamp-2 leading-snug ${task.completed ? "line-through text-fg-muted" : ""}`}
              >
                {task.title}
              </Text>
            </div>
            {(badgeVariant ||
              formattedDue ||
              task.recurrenceRule ||
              (task.subtaskCount ?? 0) > 0 ||
              (task.commentCount ?? 0) > 0 ||
              (task.attachmentCount ?? 0) > 0 ||
              (task.labels?.length ?? 0) > 0 ||
              task.assigneeName) && (
              <div className="flex items-center gap-2 flex-wrap ml-[1.625rem]">
                {badgeVariant && !task.completed && (
                  <span
                    className={`inline-flex items-center gap-1 ${PRIORITY_TEXT_CLASS[task.priority] ?? ""}`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${PRIORITY_DOT_CLASS[task.priority] ?? ""}`}
                    />
                    <span className="text-body-3 leading-none capitalize">{task.priority}</span>
                  </span>
                )}
                {formattedDue && (
                  <span className={`inline-flex items-center gap-1 leading-none ${dueDateColor}`}>
                    <Calendar size={12} className="shrink-0" />
                    <span className={`text-body-3 leading-none ${dueDateColor}`}>
                      {formattedDue}
                    </span>
                  </span>
                )}
                {task.recurrenceRule && (
                  <span className="inline-flex items-center gap-1 text-fg-muted leading-none">
                    <Repeat size={12} />
                  </span>
                )}
                {(task.subtaskCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-fg-muted leading-none">
                    <CheckSquare size={12} />
                    <span className="text-body-3 leading-none">
                      {task.subtaskCompletedCount ?? 0}/{task.subtaskCount}
                    </span>
                  </span>
                )}
                {(task.commentCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-fg-muted leading-none">
                    <MessageSquare size={12} />
                    <span className="text-body-3 leading-none">{task.commentCount}</span>
                  </span>
                )}
                {(task.attachmentCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-fg-muted leading-none">
                    <Paperclip size={12} />
                    <span className="text-body-3 leading-none">{task.attachmentCount}</span>
                  </span>
                )}
                {(task.labels?.length ?? 0) > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {task.labels!.map((lbl) => (
                      <LabelChip key={lbl.id} label={lbl} size="sm" />
                    ))}
                  </div>
                )}
                {task.assigneeName && (
                  <Avatar
                    size="xs"
                    name={task.assigneeName}
                    src={task.assigneeAvatarUrl}
                    className="ml-auto"
                  />
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => void handleDeleteConfirm()}
        title="Delete task"
        confirming={deleting}
      >
        Are you sure you want to delete &ldquo;{task.title}&rdquo;? This action cannot be undone.
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// TaskCardOverlay (non-interactive clone for DragOverlay)
// ---------------------------------------------------------------------------

export function TaskCardOverlay({ task }: { task: Task }) {
  return <SortableTaskCard task={task} overlay />;
}
