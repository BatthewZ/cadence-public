import {
  Filter,
} from "lucide-react";
import { useState } from "react";

import type { Task } from "@/web/contexts/ProjectContext";
import { useProject } from "@/web/contexts/ProjectContext";
import { useLabels } from "@/web/hooks/use-labels";
import {
  type TaskFilters,
  useTaskFilters,
} from "@/web/hooks/use-task-filters";

import { AssigneeFilter } from "./filters/AssigneeFilter";
import { DueDateFilter, type DueDateFilterValue } from "./filters/DueDateFilter";
import { FilterChips } from "./filters/FilterChips";
import { LabelFilter } from "./filters/LabelFilter";
import { PriorityFilter } from "./filters/PriorityFilter";
import { StatusFilter } from "./filters/StatusFilter";
import { LabelManagementDialog } from "./LabelManagementDialog";
import { SaveViewButton, ViewSwitcher } from "./ViewSwitcher";

export interface TaskFilterBarProps {
  tasks: Task[];
}

/**
 * Project-board filter bar. Owns the URL-backed filter state (via
 * `useTaskFilters`) and adapts it onto the filter popovers.
 *
 * Priority/DueDate/Label are controlled components (`selected`/`onChange`
 * style) so the workspace-level My Tasks view can reuse them with non-URL
 * filter state; this bar is the project-scoped owner that maps their changes
 * onto `setFilter`. It also owns the LabelManagementDialog that LabelFilter's
 * zero-labels empty state opens — the dialog requires a `projectId`, which
 * only this project-scoped wrapper has.
 *
 * Saved views mount in two spots of this one bar (see ViewSwitcher.tsx for
 * why the feature is split): the pill leads the controls row so the applied
 * view reads as the context for everything after it, and the zero-views
 * "Save view" affordance sits with "Clear filters" inside the
 * `hasActiveFilters` block — both gated so the bar is pixel-identical to the
 * pre-saved-views bar until the feature is actually useful.
 */
export function TaskFilterBar({ tasks }: TaskFilterBarProps) {
  const { members, project } = useProject();
  const filtersReturn = useTaskFilters(tasks);
  const { filters, setFilter, setFilters, hasActiveFilters, clearFilters } =
    filtersReturn;
  const { data: labelsData } = useLabels(project.id);
  const allLabels = labelsData?.labels ?? [];
  const [managementOpen, setManagementOpen] = useState(false);

  /**
   * Maps a due-date patch onto the URL filter state in ONE update. The keys
   * must be written together via `setFilters`, not via per-key `setFilter`
   * calls: react-router's functional updater closes over the render-time
   * params, so back-to-back `setFilter` calls in this handler would each start
   * from the same stale URL and clobber one another (e.g. a quick-pick would
   * drop its `from` bound, and "Clear dates" would leave the range behind when
   * `noDueDate` is also set).
   */
  function handleDueDateChange(patch: Partial<DueDateFilterValue>) {
    const filterPatch: Partial<TaskFilters> = {};
    if (patch.from !== undefined) filterPatch.dueDateFrom = patch.from;
    if (patch.to !== undefined) filterPatch.dueDateTo = patch.to;
    if (patch.noDueDate !== undefined) filterPatch.noDueDate = patch.noDueDate;
    setFilters(filterPatch);
  }

  return (
    <div className="task-filter-bar">
      <div className="task-filter-bar__controls">
        <ViewSwitcher projectId={project.id} />
        <Filter size={14} className="text-fg-muted shrink-0" />

        <AssigneeFilter
          members={members}
          filtersReturn={filtersReturn}
        />
        <PriorityFilter
          selected={filters.priorities}
          onChange={(next) => setFilter("priorities", next)}
        />
        <StatusFilter filtersReturn={filtersReturn} />
        <DueDateFilter
          from={filters.dueDateFrom}
          to={filters.dueDateTo}
          noDueDate={filters.noDueDate}
          onChange={handleDueDateChange}
        />
        <LabelFilter
          options={allLabels}
          selected={filters.labelIds}
          onChange={(next) => setFilter("labelIds", next)}
          onManageLabels={() => setManagementOpen(true)}
        />

        {hasActiveFilters && (
          <>
            <SaveViewButton projectId={project.id} />
            <button
              type="button"
              className="task-filter-bar__clear"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </>
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

      <LabelManagementDialog
        open={managementOpen}
        onClose={() => setManagementOpen(false)}
        projectId={project.id}
        labels={allLabels}
      />
    </div>
  );
}
