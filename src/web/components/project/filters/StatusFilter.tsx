import {
  CheckCircle2,
} from "lucide-react";

import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import {
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";

export function StatusFilter({
  filtersReturn,
}: {
  filtersReturn: UseTaskFiltersReturn;
}) {
  const { filters, setFilter } = filtersReturn;
  const isActive = filters.completed !== null;

  function set(value: boolean | null) {
    setFilter("completed", value);
  }

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
        >
          <CheckCircle2 size={14} />
          Status
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by status
        </Text>
        <div className="task-filter-bar__popover-list">
          {([
            { label: "All tasks", value: null },
            { label: "Active only", value: false },
            { label: "Completed only", value: true },
          ] as const).map((option) => (
            <button
              key={String(option.value)}
              type="button"
              className={`task-filter-bar__option task-filter-bar__option--button ${
                filters.completed === option.value
                  ? "task-filter-bar__option--selected"
                  : ""
              }`}
              onClick={() => set(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Popover.Content>
    </Popover>
  );
}
