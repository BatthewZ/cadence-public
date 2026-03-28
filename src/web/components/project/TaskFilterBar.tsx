import {
  Filter,
} from "lucide-react";

import type { Task } from "@/web/contexts/ProjectContext";
import { useProject } from "@/web/contexts/ProjectContext";
import { useLabels } from "@/web/hooks/use-labels";
import {
  useTaskFilters,
} from "@/web/hooks/use-task-filters";

import { AssigneeFilter } from "./filters/AssigneeFilter";
import { DueDateFilter } from "./filters/DueDateFilter";
import { FilterChips } from "./filters/FilterChips";
import { LabelFilter } from "./filters/LabelFilter";
import { PriorityFilter } from "./filters/PriorityFilter";
import { StatusFilter } from "./filters/StatusFilter";

export interface TaskFilterBarProps {
  tasks: Task[];
}

export function TaskFilterBar({ tasks }: TaskFilterBarProps) {
  const { members, project } = useProject();
  const filtersReturn = useTaskFilters(tasks);
  const { filters, hasActiveFilters, clearFilters } = filtersReturn;
  const { data: labelsData } = useLabels(project.id);
  const allLabels = labelsData?.labels ?? [];

  return (
    <div className="task-filter-bar">
      <div className="task-filter-bar__controls">
        <Filter size={14} className="text-fg-muted shrink-0" />

        <AssigneeFilter
          members={members}
          filtersReturn={filtersReturn}
        />
        <PriorityFilter filtersReturn={filtersReturn} />
        <StatusFilter filtersReturn={filtersReturn} />
        <DueDateFilter filtersReturn={filtersReturn} />
        <LabelFilter labels={allLabels} filtersReturn={filtersReturn} />

        {hasActiveFilters && (
          <button
            type="button"
            className="task-filter-bar__clear"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <FilterChips
          filters={filters}
          members={members}
          labels={allLabels}
          filtersReturn={filtersReturn}
        />
      )}
    </div>
  );
}
