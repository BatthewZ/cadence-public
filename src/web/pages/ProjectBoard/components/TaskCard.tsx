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
  type SyntheticEvent,
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
import { useTaskFilterControls } from "@/web/hooks/use-task-filters";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { toggleArrayValue } from "@/web/util/array";
import { isDueToday, isOverdue } from "@/web/util/date";
import {
  PRIORITY_BADGE_VARIANT,
  PRIORITY_BORDER_CLASS,
  PRIORITY_DOT_CLASS,
  PRIORITY_TEXT_CLASS,
} from "@/web/util/task-display";

import { taskIdStr } from "./dnd-helpers";

/**
 * Stops an event from bubbling to the card wrapper. The card's drag listeners
 * live on the wrapper, so an interactive chip inside it must stop the events
 * dnd-kit's sensors arm from, or pressing the chip would start a card drag.
 */
function stopPropagation(e: SyntheticEvent) {
  e.stopPropagation();
}

/**
 * Spread onto every interactive control nested inside the draggable card so a
 * press started on the control never arms a card drag — alongside a separate
 * `onClick` guard that keeps a chip click from opening the card detail.
 *
 * Why all three of pointerdown/mousedown/touchstart: the board's sensors moved
 * from a single PointerSensor (armed by `pointerdown`) to a MouseSensor +
 * TouchSensor pair (armed by `mousedown` and `touchstart` respectively — see
 * `useDndSensors`). After that swap, guarding `pointerdown` alone is a no-op
 * because the sensors never listen for it. Stopping all three is the single
 * source of truth that keeps the guards from drifting out of sync with the
 * sensor set again. `stopPropagation` (never `preventDefault`) leaves the
 * control's own click/tap/focus and native scrolling intact; it only keeps the
 * event from reaching the wrapper's drag listeners.
 */
const stopDragActivation = {
  onPointerDown: stopPropagation,
  onMouseDown: stopPropagation,
  onTouchStart: stopPropagation,
};

// ---------------------------------------------------------------------------
// SortableTaskCard
// ---------------------------------------------------------------------------

export function SortableTaskCard({
  task,
  overlay,
  selected,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  canEditTasks = true,
}: {
  task: Task;
  overlay?: boolean;
  selected?: boolean;
  onToggleSelect?: (taskId: string, e: MouseEvent) => void;
  /** Reorder this card one slot earlier in its column (board menu fallback). */
  onMoveUp?: () => void;
  /** Reorder this card one slot later in its column (board menu fallback). */
  onMoveDown?: () => void;
  /** False when the card is already first in its column. */
  canMoveUp?: boolean;
  /** False when the card is already last in its column. */
  canMoveDown?: boolean;
  /**
   * Whether the viewer may mutate this task. Gates both write affordances on
   * the card — the hover "..." actions menu (priority, assignee, move, due
   * date, delete) and the completion checkbox. Every one of them is a write a
   * project `viewer` cannot perform, so offering them only buys an affordance
   * that dead-ends in an error toast; the checkbox stays rendered, disabled,
   * because completion state is information a viewer is meant to read.
   *
   * Defaults to `true` so the permissive placeholder that
   * `useProjectPermissions` returns while the roster loads does not flash the
   * controls away and back; see `ProjectPermissions.isResolved`.
   */
  canEditTasks?: boolean;
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

  // Lightweight URL read/write only — deliberately NOT useTaskFilters(tasks),
  // which would re-filter the whole task list once per rendered card.
  const { filters, setFilter } = useTaskFilterControls();

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
    // Plain click: open detail panel (no selection). Functional updater that
    // only SETS `task` — the object form `setSearchParams({ task: ... })`
    // replaces the entire query string, silently wiping any active filter
    // params (assignee/priority/label/...) the user just built up via
    // click-to-filter. The detail panel's close handler deletes only `task`,
    // so opening must preserve its siblings for filters to survive the
    // open/close round-trip (ProjectListView and TimelineTaskRow do the same).
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("task", task.id);
      return next;
    });
  };

  // Click-to-filter toggles. Each stops propagation (see stopPropagation for
  // the click/pointerdown + dnd-kit rationale) and XORs one value into its
  // filter dimension in the URL.
  const handlePriorityFilterClick = (e: MouseEvent) => {
    e.stopPropagation();
    setFilter("priorities", toggleArrayValue(filters.priorities, task.priority));
  };

  const handleAssigneeFilterClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!task.assigneeId) return;
    setFilter("assigneeIds", toggleArrayValue(filters.assigneeIds, task.assigneeId));
  };

  const handleLabelFilterClick = (e: MouseEvent, labelId: string) => {
    e.stopPropagation();
    setFilter("labelIds", toggleArrayValue(filters.labelIds, labelId));
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
          // The grab cursor is a promise the board cannot keep for a viewer:
          // ProjectBoard builds its sensors with `enabled: canEditTasks`, so
          // without edit rights there is no sensor to arm and the card cannot
          // be dragged at all. Fall back to `cursor-pointer` rather than
          // `cursor-default` — the card is still clickable, it just opens the
          // task detail panel instead of moving.
          className={`group relative ${
            canEditTasks ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
          } hover:shadow-md transition-shadow duration-200 ${
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
          {/* Quick actions menu — visible on hover, editors only */}
          {!overlay && canEditTasks && (
            <div
              className="absolute top-1 right-1 hover-reveal z-10"
              onClick={(e) => e.stopPropagation()}
              {...stopDragActivation}
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
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                  />
                </DropdownMenu.Content>
              </DropdownMenu>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-1.5 text-body-2 leading-snug">
              <div
                className="shrink-0 h-[1lh] flex items-center"
                onClick={(e) => e.stopPropagation()}
                {...stopDragActivation}
              >
                <TaskCheckbox
                  size="sm"
                  checked={task.completed}
                  disabled={!canEditTasks}
                  onChange={(checked) => void handleCheckboxChange(checked)}
                />
              </div>
              {task.icon && (
                <IconDisplay name={task.icon} size={14} className="h-[1lh] text-fg-muted" />
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
                {badgeVariant &&
                  !task.completed &&
                  (overlay ? (
                    // Drag-overlay clone stays inert: plain span, no handlers.
                    <span
                      className={`inline-flex items-center gap-1 ${PRIORITY_TEXT_CLASS[task.priority] ?? ""}`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${PRIORITY_DOT_CLASS[task.priority] ?? ""}`}
                      />
                      <span className="text-body-3 leading-none capitalize">{task.priority}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Filter by priority: ${task.priority.charAt(0).toUpperCase()}${task.priority.slice(1)}`}
                      className={`inline-flex items-center gap-1 cursor-pointer rounded transition-shadow hover:ring-1 hover:ring-accent/50 ${PRIORITY_TEXT_CLASS[task.priority] ?? ""}`}
                      onClick={handlePriorityFilterClick}
                      {...stopDragActivation}
                    >
                      <span
                        className={`size-1.5 rounded-full ${PRIORITY_DOT_CLASS[task.priority] ?? ""}`}
                      />
                      <span className="text-body-3 leading-none capitalize">{task.priority}</span>
                    </button>
                  ))}
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
                      <LabelChip
                        key={lbl.id}
                        label={lbl}
                        size="sm"
                        // Drag-overlay clone stays inert: no handlers.
                        onClick={overlay ? undefined : (e) => handleLabelFilterClick(e, lbl.id)}
                        {...(overlay ? {} : stopDragActivation)}
                      />
                    ))}
                  </div>
                )}
                {task.assigneeName &&
                  // Only clickable when there is an assignee ID to filter by;
                  // the overlay clone stays inert.
                  (overlay || !task.assigneeId ? (
                    <Avatar
                      size="xs"
                      name={task.assigneeName}
                      src={task.assigneeAvatarUrl}
                      className="ml-auto"
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label={`Filter by assignee: ${task.assigneeName}`}
                      className="ml-auto inline-flex rounded-full cursor-pointer transition-shadow hover:ring-2 hover:ring-accent/50"
                      onClick={handleAssigneeFilterClick}
                      {...stopDragActivation}
                    >
                      <Avatar size="xs" name={task.assigneeName} src={task.assigneeAvatarUrl} />
                    </button>
                  ))}
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
