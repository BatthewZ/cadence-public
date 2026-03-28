import {
  Calendar,
} from "lucide-react";

import { Button } from "@/web/components/ui/Button";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import {
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";
import { startOfDay } from "@/web/util/date";

export function DueDateFilter({
  filtersReturn,
}: {
  filtersReturn: UseTaskFiltersReturn;
}) {
  const { filters, setFilter } = filtersReturn;
  const isActive = Boolean(filters.dueDateFrom || filters.dueDateTo);

  function setQuickPick(type: "overdue" | "this-week" | "this-month") {
    const today = startOfDay(new Date());
    const todayStr = today.toISOString().split("T")[0];

    if (type === "overdue") {
      setFilter("dueDateFrom", null);
      setFilter("dueDateTo", todayStr);
    } else if (type === "this-week") {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
      setFilter("dueDateFrom", todayStr);
      setFilter("dueDateTo", endOfWeek.toISOString().split("T")[0]);
    } else if (type === "this-month") {
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
      );
      setFilter("dueDateFrom", todayStr);
      setFilter("dueDateTo", endOfMonth.toISOString().split("T")[0]);
    }
  }

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
        >
          <Calendar size={14} />
          Due date
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by due date
        </Text>

        <div className="task-filter-bar__date-inputs">
          <label className="task-filter-bar__date-label">
            <Text variant="body-3" color="muted">From</Text>
            <input
              type="date"
              className="task-filter-bar__date-input"
              value={filters.dueDateFrom ?? ""}
              onChange={(e) =>
                setFilter("dueDateFrom", e.target.value || null)
              }
            />
          </label>
          <label className="task-filter-bar__date-label">
            <Text variant="body-3" color="muted">To</Text>
            <input
              type="date"
              className="task-filter-bar__date-input"
              value={filters.dueDateTo ?? ""}
              onChange={(e) =>
                setFilter("dueDateTo", e.target.value || null)
              }
            />
          </label>
        </div>

        <div className="task-filter-bar__quick-picks">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setQuickPick("overdue")}
          >
            Overdue
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setQuickPick("this-week")}
          >
            This week
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setQuickPick("this-month")}
          >
            This month
          </Button>
        </div>

        {isActive && (
          <button
            type="button"
            className="task-filter-bar__clear mt-2"
            onClick={() => {
              setFilter("dueDateFrom", null);
              setFilter("dueDateTo", null);
            }}
          >
            Clear dates
          </button>
        )}
      </Popover.Content>
    </Popover>
  );
}
