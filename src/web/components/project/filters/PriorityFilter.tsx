import {
  Flag,
} from "lucide-react";

import { TASK_PRIORITIES, type TaskPriority } from "@/shared/types/roles";
import { Checkbox } from "@/web/components/form/Checkbox";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import {
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";
import { getPriorityBadgeVariant, getPriorityLabel } from "@/web/util/task-display";

export function PriorityFilter({
  filtersReturn,
}: {
  filtersReturn: UseTaskFiltersReturn;
}) {
  const { filters, setFilter } = filtersReturn;
  const isActive = filters.priorities.length > 0;

  function toggle(priority: TaskPriority) {
    const next = filters.priorities.includes(priority)
      ? filters.priorities.filter((p) => p !== priority)
      : [...filters.priorities, priority];
    setFilter("priorities", next);
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
              {filters.priorities.length}
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
                checked={filters.priorities.includes(priority)}
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
