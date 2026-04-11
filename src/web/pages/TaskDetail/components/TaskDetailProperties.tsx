import type { TaskLabelInfo } from "@/shared/schemas/label";
import type { RecurrenceRule } from "@/shared/types/recurrence";
import type { TaskPriority } from "@/shared/types/roles";
import { Input } from "@/web/components/form/Input";
import { Stack } from "@/web/components/layout";
import { TaskLabelPicker } from "@/web/components/project/TaskLabelPicker";
import type { TaskGroup } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

import {
  AssigneePicker,
  AssigneePickerReadOnly,
  GroupPicker,
  GroupPickerReadOnly,
  PriorityPicker,
  PriorityPickerReadOnly,
} from "./PropertyEditors";
import { PropertyRow } from "./PropertyRow";
import { RecurrencePicker, RecurrencePickerReadOnly } from "./RecurrencePicker";

/**
 * Shared property grid rendered in both TaskDetailDialog and TaskDetailPanelInner.
 *
 * Centralises the Group, Priority, Assignee, Due date, Repeat, Cost, and Labels
 * property rows so that both views stay in sync without duplicating markup or logic.
 */

interface TaskPropertyData {
  id: string;
  taskGroupId: string;
  priority: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
  recurrenceRule?: RecurrenceRule | null;
  labels?: TaskLabelInfo[];
}

export interface TaskDetailPropertiesProps {
  /** The subset of task fields required by the property grid. */
  task: TaskPropertyData;
  /** Available task groups for the Group picker. */
  taskGroups: TaskGroup[];
  /** Workspace members for the Assignee picker. */
  members: WorkspaceMember[];
  /** Whether the current user has edit permission. */
  canEditTasks: boolean;
  /** Current cost display value (controlled). */
  costDisplay: string;
  /** Setter for the cost display value. */
  setCostDisplay: (value: string) => void;
  /** Called when the cost input receives focus (for dirty-field tracking). */
  onCostFocus: () => void;
  /** Called when the cost input loses focus (triggers save). */
  onCostBlur: () => void;
  /** Generic patch handler for priority, assignee, due date, recurrence changes. */
  onPatch: (
    updates: Partial<{
      priority: TaskPriority;
      assigneeId: string | null;
      assigneeName: string | undefined;
      assigneeAvatarUrl: string | undefined;
      dueDate: string | null;
      recurrenceRule: RecurrenceRule | null;
    }>
  ) => void;
  /** Handler for changing the task's group. Separated because Dialog and Panel
   *  use different APIs to move a task between groups. */
  onGroupChange: (newGroupId: string) => void;
  /** Project ID for the label picker. When absent, the Labels row is hidden. */
  projectId: string | undefined;
}

export function TaskDetailProperties({
  task,
  taskGroups,
  members,
  canEditTasks,
  costDisplay,
  setCostDisplay,
  onCostFocus,
  onCostBlur,
  onPatch,
  onGroupChange,
  projectId,
}: TaskDetailPropertiesProps) {
  return (
    <Stack gap="r6">
      <PropertyRow label="Group">
        {canEditTasks ? (
          <GroupPicker
            value={task.taskGroupId}
            taskGroups={taskGroups}
            onSelect={(newGroupId) => {
              if (newGroupId !== task.taskGroupId) {
                onGroupChange(newGroupId);
              }
            }}
          />
        ) : (
          <GroupPickerReadOnly value={task.taskGroupId} taskGroups={taskGroups} />
        )}
      </PropertyRow>

      <PropertyRow label="Priority">
        {canEditTasks ? (
          <PriorityPicker
            value={task.priority}
            onSelect={(priority) => {
              onPatch({ priority });
            }}
          />
        ) : (
          <PriorityPickerReadOnly value={task.priority} />
        )}
      </PropertyRow>

      <PropertyRow label="Assigned to">
        {canEditTasks ? (
          <AssigneePicker
            value={task.assigneeId ?? null}
            members={members}
            onSelect={(userId) => {
              const member = userId
                ? members.find((m) => m.userId === userId)
                : undefined;
              onPatch({
                assigneeId: userId,
                assigneeName: member?.user.name ?? undefined,
                assigneeAvatarUrl: member?.user.image ?? undefined,
              });
            }}
          />
        ) : (
          <AssigneePickerReadOnly value={task.assigneeId ?? null} members={members} />
        )}
      </PropertyRow>

      <PropertyRow label="Due date">
        <Input
          type="date"
          value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
          disabled={!canEditTasks}
          onChange={(e) => {
            onPatch({ dueDate: e.target.value || null });
          }}
          className="border-transparent bg-transparent hover:bg-surface-2 focus:bg-surface-0 py-1.5 px-r5 text-body-3 rounded"
        />
      </PropertyRow>

      <PropertyRow label="Repeat">
        {canEditTasks ? (
          <RecurrencePicker
            value={task.recurrenceRule ?? null}
            onSelect={(rule) => onPatch({ recurrenceRule: rule })}
          />
        ) : (
          <RecurrencePickerReadOnly value={task.recurrenceRule ?? null} />
        )}
      </PropertyRow>

      <PropertyRow label="Cost">
        <div className="relative">
          <span className="absolute left-r5 top-1/2 -translate-y-1/2 text-body-3 text-fg-muted pointer-events-none">
            $
          </span>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={costDisplay}
            disabled={!canEditTasks}
            onChange={(e) => setCostDisplay(e.target.value)}
            onFocus={onCostFocus}
            onBlur={onCostBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="border-transparent bg-transparent hover:bg-surface-2 focus:bg-surface-0 py-1.5 pl-6 pr-r5 text-body-3 rounded"
          />
        </div>
      </PropertyRow>

      {projectId && (
        <PropertyRow label="Labels">
          <TaskLabelPicker
            taskId={task.id}
            projectId={projectId}
            labels={task.labels ?? []}
            readOnly={!canEditTasks}
          />
        </PropertyRow>
      )}
    </Stack>
  );
}
