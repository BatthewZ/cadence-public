import {
  Tag,
} from "lucide-react";

import { Checkbox } from "@/web/components/form/Checkbox";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { type Label } from "@/web/hooks/use-labels";
import {
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";

export function LabelFilter({
  labels,
  filtersReturn,
}: {
  labels: Label[];
  filtersReturn: UseTaskFiltersReturn;
}) {
  const { filters, setFilter } = filtersReturn;
  const isActive = filters.labelIds.length > 0;

  function toggle(labelId: string) {
    const next = filters.labelIds.includes(labelId)
      ? filters.labelIds.filter((id) => id !== labelId)
      : [...filters.labelIds, labelId];
    setFilter("labelIds", next);
  }

  if (labels.length === 0) return null;

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
        >
          <Tag size={14} />
          Label
          {isActive && (
            <Badge variant="info" className="task-filter-bar__count">
              {filters.labelIds.length}
            </Badge>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by label
        </Text>
        <div className="task-filter-bar__popover-list">
          {labels.map((lbl) => (
            <label
              key={lbl.id}
              className="task-filter-bar__option"
            >
              <Checkbox
                checked={filters.labelIds.includes(lbl.id)}
                onChange={() => toggle(lbl.id)}
              />
              <span
                className="inline-block size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: lbl.color }}
              />
              <span className="truncate">{lbl.name}</span>
            </label>
          ))}
        </div>
      </Popover.Content>
    </Popover>
  );
}
