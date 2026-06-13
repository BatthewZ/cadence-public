import {
  Flag,
} from "lucide-react";

import { TASK_PRIORITIES, type TaskPriority } from "@/shared/types/roles";
import { Checkbox } from "@/web/components/form/Checkbox";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { toggleArrayValue } from "@/web/util/array";
import { getPriorityBadgeVariant, getPriorityLabel } from "@/web/util/task-display";

export interface PriorityFilterProps {
  /** Currently selected priorities (OR-combined within the dimension). */
  selected: TaskPriority[];
  /** Receives the complete next selection when an option is toggled. */
  onChange: (next: TaskPriority[]) => void;
}

/**
 * Priority filter popover, fully controlled via `selected`/`onChange`.
 *
 * Why controlled (unlike AssigneeFilter/StatusFilter, which still take the
 * project-scoped `UseTaskFiltersReturn`): the workspace-level My Tasks view
 * reuses this popover, and there the filter state does not come from
 * `useTaskFilters(tasks)`. Keeping this component pure presentation means a
 * single filter UI serves both surfaces without adapters — the owner decides
 * where the selection lives (URL params on the project board, view state on
 * My Tasks).
 */
export function PriorityFilter({ selected, onChange }: PriorityFilterProps) {
  const isActive = selected.length > 0;

  function toggle(priority: TaskPriority) {
    onChange(toggleArrayValue(selected, priority));
  }

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
        >
          <Flag size={14} />
          Priority
          {isActive && (
            <Badge variant="info" className="task-filter-bar__count">
              {selected.length}
            </Badge>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by priority
        </Text>
        <div className="task-filter-bar__popover-list">
          {TASK_PRIORITIES.map((priority) => (
            <label
              key={priority}
              className="task-filter-bar__option"
            >
              <Checkbox
                checked={selected.includes(priority)}
                onChange={() => toggle(priority)}
              />
              <Badge variant={getPriorityBadgeVariant(priority)}>
                {getPriorityLabel(priority)}
              </Badge>
            </label>
          ))}
        </div>
      </Popover.Content>
    </Popover>
  );
}
