import {
  Calendar,
} from "lucide-react";

import { Checkbox } from "@/web/components/form/Checkbox";
import { Button } from "@/web/components/ui/Button";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { startOfDay } from "@/web/util/date";

/**
 * The full value of the due-date filter dimension: an inclusive `from`/`to`
 * range plus the `noDueDate` absence flag. The flag composes with the range
 * as an OR — a task passes the dimension if it is in range OR (`noDueDate`
 * and it has no due date) — mirroring `applyFilters` in `use-task-filters`.
 */
export interface DueDateFilterValue {
  from: string | null;
  to: string | null;
  noDueDate: boolean;
}

export interface DueDateFilterProps extends DueDateFilterValue {
  /**
   * Receives a partial patch containing only the keys that changed. The owner
   * merges it into its own state — on the project board that is ONE batched
   * `setFilters(patch)` call against the URL params (per-key `setFilter`
   * calls would clobber each other: react-router's functional updater closes
   * over the render-time params, so the last write wins and earlier keys are
   * lost), on My Tasks it is view state. Patch (rather than full-value)
   * semantics keep quick-picks from clobbering `noDueDate` and vice versa.
   */
  onChange: (patch: Partial<DueDateFilterValue>) => void;
}

/**
 * Due-date filter popover, fully controlled via `from`/`to`/`noDueDate` plus
 * a patch-style `onChange`.
 *
 * Why controlled (unlike AssigneeFilter/StatusFilter, which still take the
 * project-scoped `UseTaskFiltersReturn`): the workspace-level My Tasks view
 * reuses this popover with non-URL-backed filter state, so the component must
 * not reach into `useTaskFilters` itself.
 */
export function DueDateFilter({ from, to, noDueDate, onChange }: DueDateFilterProps) {
  const isActive = Boolean(from || to) || noDueDate;

  function setQuickPick(type: "overdue" | "this-week" | "this-month") {
    const today = startOfDay(new Date());
    const todayStr = today.toISOString().split("T")[0];

    if (type === "overdue") {
      onChange({ from: null, to: todayStr });
    } else if (type === "this-week") {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
      onChange({ from: todayStr, to: endOfWeek.toISOString().split("T")[0] });
    } else if (type === "this-month") {
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
      );
      onChange({ from: todayStr, to: endOfMonth.toISOString().split("T")[0] });
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
              value={from ?? ""}
              onChange={(e) => onChange({ from: e.target.value || null })}
            />
          </label>
          <label className="task-filter-bar__date-label">
            <Text variant="body-3" color="muted">To</Text>
            <input
              type="date"
              className="task-filter-bar__date-input"
              value={to ?? ""}
              onChange={(e) => onChange({ to: e.target.value || null })}
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

        <label className="task-filter-bar__option mt-2">
          <Checkbox
            checked={noDueDate}
            onChange={() => onChange({ noDueDate: !noDueDate })}
          />
          <span className="truncate">No due date</span>
        </label>

        {isActive && (
          <button
            type="button"
            className="task-filter-bar__clear mt-2"
            onClick={() => onChange({ from: null, to: null, noDueDate: false })}
          >
            Clear dates
          </button>
        )}
      </Popover.Content>
    </Popover>
  );
}
