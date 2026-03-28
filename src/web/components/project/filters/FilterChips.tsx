import {
  X,
} from "lucide-react";

import type { ProjectMember } from "@/web/contexts/ProjectContext";
import { type Label } from "@/web/hooks/use-labels";
import {
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";
import { getPriorityLabel } from "@/web/util/task-display";

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
      {filters.assigneeIds.map((id) => {
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
            onClick={() => {
              filtersReturn.setFilter("dueDateFrom", null);
              filtersReturn.setFilter("dueDateTo", null);
            }}
            aria-label="Remove due date filter"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {filters.labelIds.map((id) => {
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
