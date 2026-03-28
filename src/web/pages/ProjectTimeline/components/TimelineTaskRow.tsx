import { Check, MoreHorizontal, UserPlus, UserX } from "lucide-react";
import {
  type MouseEvent,
} from "react";
import { useSearchParams } from "react-router-dom";

import { Checkbox } from "@/web/components/form/Checkbox";
import { Row } from "@/web/components/layout";
import {
  Avatar,
  Badge,
} from "@/web/components/ui";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { DueDatePopover } from "@/web/components/ui/DueDatePopover";
import { IconButton } from "@/web/components/ui/IconButton";
import { TaskContextMenuItems } from "@/web/components/ui/TaskContextMenuItems";
import { useProject } from "@/web/contexts/ProjectContext";
import { useTaskActions } from "@/web/hooks/use-task-actions";
import { formatDueDate, isOverdue } from "@/web/util/date";
import { getPriorityBadgeVariant, getPriorityLabel, PRIORITY_DOT_CLASS, PRIORITY_OPTIONS } from "@/web/util/task-display";

import type { TimelineTask } from "./grouping";

export function TimelineTaskRow({
  task,
  onToggleCompleted,
  selected,
  onToggleSelect,
}: {
  task: TimelineTask;
  onToggleCompleted: (taskId: string, currentlyCompleted: boolean) => void;
  selected?: boolean;
  onToggleSelect?: (taskId: string) => void;
}) {
  const [, setSearchParams] = useSearchParams();
  const { project, updateTask: ctxUpdateTask, removeTask: ctxRemoveTask, members, taskGroups } = useProject();
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

  const handleRowClick = (e: MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(task.id);
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("task", task.id);
      return next;
    });
  };

  return (
    <>
      <Row
        gap="r4"
        align="center"
        className={`group relative px-r4 py-r5 hover:bg-surface-1 rounded-md transition-colors cursor-pointer ${
          selected ? "ring-2 ring-accent bg-accent/5" : ""
        }`}
        onClick={handleRowClick}
      >
        {/* Selection checkmark overlay */}
        {selected && (
          <div className="absolute top-1 left-1 z-10 size-5 rounded-full bg-accent flex items-center justify-center">
            <Check size={12} className="text-fg-on-accent" />
          </div>
        )}

        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={task.completed}
            onChange={() => onToggleCompleted(task.id, task.completed)}
            aria-label={`Mark "${task.title}" as ${task.completed ? "incomplete" : "complete"}`}
          />
        </div>

        <span
          className={`flex-1 text-left font-medium truncate ${
            task.completed
              ? "line-through text-fg-muted"
              : "text-fg-primary"
          }`}
        >
          {task.title}
        </span>

        {/* Inline editable assignee */}
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger asChild>
              {task.assigneeName ? (
                <button type="button" className="shrink-0" aria-label="Change assigned person">
                  <Avatar
                    name={task.assigneeName}
                    src={task.assigneeAvatarUrl}
                    size="xs"
                  />
                </button>
              ) : (
                <button
                  type="button"
                  className="shrink-0 size-6 rounded-full border border-dashed border-border-default flex items-center justify-center hover-reveal text-fg-muted hover:text-fg-primary hover:border-border-strong"
                  aria-label="Assign task"
                >
                  <UserPlus size={12} />
                </button>
              )}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className="min-w-[160px]">
              <DropdownMenu.Label>Assign to</DropdownMenu.Label>
              <DropdownMenu.Item
                index={0}
                icon={<UserX size={14} className="text-fg-muted" />}
                onSelect={() => void handleAssigneeChange(null)}
              >
                <span className={!task.assigneeId ? "font-semibold" : ""}>
                  Unassigned
                </span>
              </DropdownMenu.Item>
              {members.map((member, i) => (
                <DropdownMenu.Item
                  key={member.userId}
                  index={i + 1}
                  icon={<Avatar size="xs" name={member.name} src={member.image} className="!size-4" />}
                  onSelect={() => void handleAssigneeChange(member.userId, member.name)}
                >
                  <span className={task.assigneeId === member.userId ? "font-semibold" : ""}>
                    {member.name}
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>

        {/* Inline editable priority */}
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger asChild>
              {task.priority && task.priority !== "none" ? (
                <button type="button" aria-label="Change priority">
                  <Badge variant={getPriorityBadgeVariant(task.priority)}>
                    {getPriorityLabel(task.priority)}
                  </Badge>
                </button>
              ) : (
                <button
                  type="button"
                  className="shrink-0 hover-reveal"
                  aria-label="Set priority"
                >
                  <Badge variant="default">Priority</Badge>
                </button>
              )}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className="min-w-[140px]">
              <DropdownMenu.Label>Set priority</DropdownMenu.Label>
              {PRIORITY_OPTIONS.map((opt, i) => (
                <DropdownMenu.Item
                  key={opt.value}
                  index={i}
                  icon={
                    <span
                      className={`size-2 rounded-full ${PRIORITY_DOT_CLASS[opt.value] ?? "bg-surface-3"}`}
                    />
                  }
                  onSelect={() => void handlePriorityChange(opt.value)}
                >
                  <span className={task.priority === opt.value ? "font-semibold" : ""}>
                    {opt.label}
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>

        {/* Inline editable due date */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <DueDatePopover
            onSelect={(date) => void handleDueDateChange(date)}
            currentDate={task.dueDate}
            placement="bottom-end"
            trigger={
              <button
                type="button"
                className={`text-sm shrink-0 ${
                  task.dueDate && isOverdue(task.dueDate)
                    ? "text-status-error font-medium"
                    : "text-fg-secondary"
                }`}
                aria-label="Change due date"
              >
                {formatDueDate(task.dueDate)}
              </button>
            }
          />
        </div>

        {/* Quick actions three-dot menu */}
        <div
          className="shrink-0 hover-reveal"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger asChild>
              <IconButton
                aria-label="Task actions"
                className="size-6 shrink-0 bg-surface-1/80 hover:bg-surface-2 backdrop-blur-sm"
              >
                <MoreHorizontal size={14} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className="min-w-[180px]">
              <TaskContextMenuItems
                task={task}
                members={members}
                taskGroups={taskGroups}
                dotSize="sm"
                onPriorityChange={(p) => void handlePriorityChange(p)}
                onAssigneeChange={(id, name) => void handleAssigneeChange(id, name)}
                onMoveToGroup={(id) => void handleMoveToGroup(id)}
                onDueDateChange={(d) => void handleDueDateChange(d)}
                onDeleteRequest={() => setShowDeleteDialog(true)}
              />
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </Row>

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
