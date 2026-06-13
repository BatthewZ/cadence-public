import { X } from "lucide-react";

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
 * Centralises the Group, Priority, Assignee, Start/Due date, Repeat, Cost, and
 * Labels property rows so that both views stay in sync without duplicating
 * markup or logic.
 *
 * Start date and Due date are each ALWAYS rendered and each independently
 * optional — set either, both, or neither. This matches every other row in the
 * panel (Priority, Assignee, Repeat, Cost, Labels all show even when unset), so
 * the available properties are legible at a glance rather than hidden behind a
 * progressive-disclosure affordance. The server enforces only the ordering rule
 * (start ≤ due) when both are present, so a start date can stand alone.
 *
 * The two rows share one layout contract: a flex row of [date input][24px clear
 * slot], where the slot always renders — as a clear (×) button when that row
 * holds a value, or as an invisible placeholder when it is empty or read-only.
 * Because the underlying Input is `w-full`, dropping the slot from one row would
 * widen that row's input and visibly misalign the two rows' native calendar
 * icons and right edges. Start sits above Due (chronological order), and native
 * `min`/`max` plumbing between the two inputs lets the browser block an inverted
 * range before the server-side refinement ever has to fire.
 */

/**
 * Shared styling for the transparent inline date inputs. The Start and Due
 * rows render structurally identical inputs, so the class lives here once —
 * a divergence between the two would be a silent visual inconsistency.
 *
 * The fixed `h-8` (2rem) is deliberate and matches `.task-property-picker__trigger`'s
 * `min-height: 2rem`. Without it the input's intrinsic height is set by
 * `text-body-3`'s 1.75rem line-height plus vertical padding (~42px), which made
 * the input rows visibly taller than the dropdown rows (Group, Priority, Repeat
 * — all 32px). Pinning the box to 2rem and dropping the vertical padding (the
 * border-box height now drives layout, and the UA vertically centres the value)
 * makes every property row exactly the same height.
 *
 * A native `type="date"` input renders its empty-state format text
 * (`dd/mm/yyyy`) through the `::-webkit-datetime-edit` pseudo-element, which
 * inherits the input's `color` rather than the `::placeholder` styling used by
 * text inputs. Left alone it draws in full-strength foreground, making the
 * empty Start/Due rows read darker than the Cost row's muted `0.00`
 * placeholder. We therefore mute the input's text colour while it has no value
 * so every empty placeholder on the panel shares the `text-fg-muted` tone, then
 * restore full strength once a real date is present.
 */
function dateInputClass(hasValue: boolean): string {
  return [
    "h-8 border-transparent bg-transparent hover:bg-surface-1 focus:bg-surface-0 px-r5 text-body-3 rounded",
    hasValue ? "" : "text-fg-muted",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The clear (×) icon button shared by the Start and Due rows. A fixed 24px
 * square (rather than icon + tiny padding) gives a real click target and a
 * hover surface, so the control reads as a deliberate button instead of a
 * floating glyph.
 */
const dateClearButtonClass =
  "shrink-0 flex items-center justify-center size-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-2 duration-fast cursor-pointer";

/**
 * Invisible placeholder rendered in place of the clear button whenever a row
 * has nothing to clear (or the viewer is read-only). The Input component is
 * `w-full`, so a row WITH a trailing button lays out its input narrower than
 * a row without one — which visibly misaligns the two rows' native calendar
 * icons and right edges. Reserving the slot unconditionally keeps the Start
 * and Due inputs pixel-identical in every state.
 */
function DateClearSlot() {
  return <span aria-hidden="true" className="shrink-0 size-6" />;
}

interface TaskPropertyData {
  id: string;
  taskGroupId: string;
  priority: TaskPriority;
  assigneeId?: string | null;
  startDate?: string | null;
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
      startDate: string | null;
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

      <PropertyRow label="Start date">
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={task.startDate ? task.startDate.slice(0, 10) : ""}
            // Browser-side guard: a start date can't be picked past the due
            // date. Absent when there is no due date — a start date may stand
            // alone.
            max={task.dueDate?.slice(0, 10)}
            disabled={!canEditTasks}
            onChange={(e) => {
              onPatch({ startDate: e.target.value || null });
            }}
            className={dateInputClass(Boolean(task.startDate))}
          />
          {canEditTasks && task.startDate ? (
            <button
              type="button"
              aria-label="Clear start date"
              title="Clear start date"
              className={dateClearButtonClass}
              onClick={() => {
                onPatch({ startDate: null });
              }}
            >
              <X size={14} />
            </button>
          ) : (
            <DateClearSlot />
          )}
        </div>
      </PropertyRow>

      <PropertyRow label="Due date">
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
            // Browser-side guard: a due date can't be picked before the start
            // date. Absent when there is no start date.
            min={task.startDate?.slice(0, 10)}
            disabled={!canEditTasks}
            onChange={(e) => {
              onPatch({ dueDate: e.target.value || null });
            }}
            className={dateInputClass(Boolean(task.dueDate))}
          />
          {canEditTasks && task.dueDate ? (
            <button
              type="button"
              aria-label="Clear due date"
              title="Clear due date"
              className={dateClearButtonClass}
              // Clears only the due date — a surviving start date is left in
              // place, since a start date no longer requires a due date.
              onClick={() => {
                onPatch({ dueDate: null });
              }}
            >
              <X size={14} />
            </button>
          ) : (
            <DateClearSlot />
          )}
        </div>
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
            className="h-8 border-transparent bg-transparent hover:bg-surface-1 focus:bg-surface-0 pl-6 pr-r5 text-body-3 rounded"
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
