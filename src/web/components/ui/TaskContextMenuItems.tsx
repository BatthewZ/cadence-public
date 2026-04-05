import { ArrowRightLeft, Calendar, Flag, Trash2, Users, UserX } from "lucide-react";

import type { TaskPriority } from "@/shared/types/roles";
import { Input } from "@/web/components/form/Input";
import { Avatar } from "@/web/components/ui/Avatar";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import type { ProjectMember, TaskGroup } from "@/web/contexts/ProjectContext";
import { PRIORITY_DOT_CLASS, PRIORITY_OPTIONS } from "@/web/util/task-display";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface TaskContextMenuTask {
  priority: string;
  assigneeId?: string | null;
  taskGroupId: string;
  dueDate?: string | null;
}

interface TaskContextMenuItemsProps {
  task: TaskContextMenuTask;
  members: ProjectMember[];
  taskGroups: TaskGroup[];
  /** Dot indicator size in the priority / move-to sub-menus. */
  dotSize?: "sm" | "md";
  onPriorityChange: (priority: TaskPriority) => void;
  onAssigneeChange: (assigneeId: string | null, name?: string) => void;
  onMoveToGroup: (groupId: string) => void;
  onDueDateChange: (date: string | null) => void;
  onDeleteRequest: () => void;
  /** Running index counter for flat DropdownMenu.Items (due-date clear & delete).
   *  Returns the next available index. Defaults to 0. */
  menuItemIndexStart?: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Shared sub-menu items for task context menus used across ProjectBoard
 * and ProjectTimeline. Renders priority, assign-to, and move-to flyout
 * sub-menus, a due-date date-picker, and a delete item.
 */
export function TaskContextMenuItems({
  task,
  members,
  taskGroups,
  dotSize = "md",
  onPriorityChange,
  onAssigneeChange,
  onMoveToGroup,
  onDueDateChange,
  onDeleteRequest,
  menuItemIndexStart = 0,
}: TaskContextMenuItemsProps) {
  const dot = dotSize === "sm" ? "size-2" : "size-2.5";
  let menuItemIndex = menuItemIndexStart;

  return (
    <>
      {/* Priority sub-menu */}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger icon={<Flag size={14} />}>
          Change priority
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent className="min-w-[10rem]">
          {PRIORITY_OPTIONS.map((opt, i) => (
            <DropdownMenu.SubItem
              key={opt.value}
              index={i}
              icon={
                <span
                  className={`${dot} rounded-full ${PRIORITY_DOT_CLASS[opt.value] ?? "bg-surface-3"}`}
                />
              }
              onSelect={() => onPriorityChange(opt.value)}
            >
              <span className={task.priority === opt.value ? "font-semibold" : ""}>
                {opt.label}
              </span>
            </DropdownMenu.SubItem>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>

      {/* Assign to sub-menu */}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger icon={<Users size={14} />}>
          Assign to
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent className="min-w-[10rem]">
          <DropdownMenu.SubItem
            index={0}
            icon={<UserX size={14} className="text-fg-muted" />}
            onSelect={() => onAssigneeChange(null)}
          >
            <span className={!task.assigneeId ? "font-semibold" : ""}>Unassigned</span>
          </DropdownMenu.SubItem>
          {members.map((member, i) => (
            <DropdownMenu.SubItem
              key={member.userId}
              index={i + 1}
              icon={<Avatar size="xs" name={member.name} src={member.image} className="!size-4" />}
              onSelect={() => onAssigneeChange(member.userId, member.name)}
            >
              <span className={task.assigneeId === member.userId ? "font-semibold" : ""}>
                {member.name}
              </span>
            </DropdownMenu.SubItem>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>

      {/* Move to sub-menu */}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger icon={<ArrowRightLeft size={14} />}>
          Move to
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent className="min-w-[10rem]">
          {taskGroups.map((group, i) => (
            <DropdownMenu.SubItem
              key={group.id}
              index={i}
              icon={
                group.isCompletionGroup ? (
                  <span className={`${dot} rounded-full bg-status-success`} />
                ) : group.color ? (
                  <span
                    className={`${dot} rounded-full`}
                    style={{ backgroundColor: group.color }}
                  />
                ) : (
                  <span className={`${dot} rounded-full bg-surface-3`} />
                )
              }
              onSelect={() => onMoveToGroup(group.id)}
            >
              <span className={task.taskGroupId === group.id ? "font-semibold" : ""}>
                {group.name}
              </span>
            </DropdownMenu.SubItem>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>

      <DropdownMenu.Divider />

      {/* Due date */}
      <DropdownMenu.Label>Due date</DropdownMenu.Label>
      <div
        className="px-1.5 py-1"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Input
          type="date"
          value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
          className="text-body-3 py-1"
          onChange={(e) => {
            onDueDateChange(e.target.value || null);
          }}
        />
      </div>
      {task.dueDate &&
        (() => {
          const clearIdx = menuItemIndex++;
          return (
            <DropdownMenu.Item
              index={clearIdx}
              icon={<Calendar size={14} className="text-fg-muted" />}
              onSelect={() => onDueDateChange(null)}
            >
              Clear due date
            </DropdownMenu.Item>
          );
        })()}

      <DropdownMenu.Divider />

      {/* Delete */}
      {(() => {
        const deleteIdx = menuItemIndex++;
        return (
          <DropdownMenu.Item
            index={deleteIdx}
            variant="danger"
            icon={<Trash2 size={14} />}
            onSelect={onDeleteRequest}
          >
            Delete task
          </DropdownMenu.Item>
        );
      })()}
    </>
  );
}
