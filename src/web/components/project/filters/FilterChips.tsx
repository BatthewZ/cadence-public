import {
  X,
} from "lucide-react";

import type { ProjectMember } from "@/web/contexts/ProjectContext";
import { type Label } from "@/web/hooks/use-labels";
import {
  FILTER_NONE,
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";
import { getPriorityLabel } from "@/web/util/task-display";

/**
 * Renders one removable chip per active filter value, grouped by dimension.
 *
 * Absence filters get dedicated chips with carefully scoped removers:
 *
 * - The {@link FILTER_NONE} sentinel inside `assigneeIds`/`labelIds` is
 *   excluded from the id→name `.map()` lookups before they run. Letting it
 *   fall through would render a bogus "Unknown" chip (the sentinel matches no
 *   member/label), so "Unassigned"/"No label" are rendered as explicit chips
 *   instead. Their removers strip ONLY the sentinel from the array — real ids
 *   selected alongside it must survive, because absence composes into its
 *   dimension with OR (e.g. "assigned to Alice OR unassigned").
 *
 * - The "No due date" chip's remover uses `clearFilter("noDueDate")`, which
 *   deletes only that one URL param. It must NOT touch
 *   `dueDateFrom`/`dueDateTo`: the range is an independent OR sub-filter of
 *   the same dimension with its own chip, and removing "no due date" while a
 *   range is set should narrow the view to the range — not silently drop the
 *   whole due-date filter.
 *
 * - The date-range chip's remover clears `dueDateFrom` AND `dueDateTo` in ONE
 *   batched `setFilters` call. Two back-to-back `setFilter` calls would NOT
 *   work: react-router's functional `setSearchParams` updater closes over the
 *   render-time params, so the second call would start from the same stale
 *   URL as the first and resurrect the param the first one deleted (here:
 *   removing the chip would leave `dueDateFrom` behind as a half-active
 *   range). See `setFilters` in `use-task-filters` for the full rationale.
 */
export function FilterChips({
  filters,
  members,
  labels,
  filtersReturn,
}: {
  filters: UseTaskFiltersReturn["filters"];
  members: ProjectMember[];
  labels: Label[];
  filtersReturn: UseTaskFiltersReturn;
}) {
  const { clearFilter } = filtersReturn;

  return (
    <div className="task-filter-bar__chips">
      {filters.assigneeIds.includes(FILTER_NONE) && (
        <span className="task-filter-bar__chip">
          Unassigned
          <button
            type="button"
            onClick={() =>
              filtersReturn.setFilter(
                "assigneeIds",
                filters.assigneeIds.filter((a) => a !== FILTER_NONE),
              )
            }
            aria-label="Remove unassigned filter"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {filters.assigneeIds
        .filter((id) => id !== FILTER_NONE)
        .map((id) => {
          const member = members.find((m) => m.userId === id);
          return (
            <span key={`assignee-${id}`} className="task-filter-bar__chip">
              {member?.name ?? "Unknown"}
              <button
                type="button"
                onClick={() =>
                  filtersReturn.setFilter(
                    "assigneeIds",
                    filters.assigneeIds.filter((a) => a !== id),
                  )
                }
                aria-label={`Remove filter for ${member?.name ?? id}`}
              >
                <X size={12} />
              </button>
            </span>
          );
        })}

      {filters.priorities.map((priority) => (
        <span key={`priority-${priority}`} className="task-filter-bar__chip">
          {getPriorityLabel(priority)}
          <button
            type="button"
            onClick={() =>
              filtersReturn.setFilter(
                "priorities",
                filters.priorities.filter((p) => p !== priority),
              )
            }
            aria-label={`Remove priority filter ${priority}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}

      {filters.completed !== null && (
        <span className="task-filter-bar__chip">
          {filters.completed ? "Completed" : "Active"}
          <button
            type="button"
            onClick={() => clearFilter("completed")}
            aria-label="Remove status filter"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {(filters.dueDateFrom || filters.dueDateTo) && (
        <span className="task-filter-bar__chip">
          {filters.dueDateFrom && filters.dueDateTo
            ? `${filters.dueDateFrom} — ${filters.dueDateTo}`
            : filters.dueDateFrom
              ? `From ${filters.dueDateFrom}`
              : `Until ${filters.dueDateTo}`}
          <button
            type="button"
            onClick={() =>
              filtersReturn.setFilters({ dueDateFrom: null, dueDateTo: null })
            }
            aria-label="Remove due date filter"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {filters.noDueDate && (
        <span className="task-filter-bar__chip">
          No due date
          <button
            type="button"
            onClick={() => clearFilter("noDueDate")}
            aria-label="Remove no due date filter"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {filters.labelIds.includes(FILTER_NONE) && (
        <span className="task-filter-bar__chip">
          No label
          <button
            type="button"
            onClick={() =>
              filtersReturn.setFilter(
                "labelIds",
                filters.labelIds.filter((lid) => lid !== FILTER_NONE),
              )
            }
            aria-label="Remove no label filter"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {filters.labelIds
        .filter((id) => id !== FILTER_NONE)
        .map((id) => {
          const lbl = labels.find((l) => l.id === id);
          return (
            <span key={`label-${id}`} className="task-filter-bar__chip">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: lbl?.color }}
              />
              {lbl?.name ?? "Unknown"}
              <button
                type="button"
                onClick={() =>
                  filtersReturn.setFilter(
                    "labelIds",
                    filters.labelIds.filter((lid) => lid !== id),
                  )
                }
                aria-label={`Remove label filter ${lbl?.name ?? id}`}
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
    </div>
  );
}
