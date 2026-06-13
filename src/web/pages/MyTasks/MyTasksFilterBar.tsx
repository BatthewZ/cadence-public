import { Filter, X } from "lucide-react";

import type { TaskPriority } from "@/shared/types/roles";
import {
  DueDateFilter,
  type DueDateFilterValue,
} from "@/web/components/project/filters/DueDateFilter";
import {
  LabelFilter,
  type LabelFilterOption,
} from "@/web/components/project/filters/LabelFilter";
import { PriorityFilter } from "@/web/components/project/filters/PriorityFilter";
import { Text } from "@/web/components/ui/Text";
import { FILTER_NONE } from "@/web/hooks/use-task-filters";
import type { WorkspaceLabel } from "@/web/hooks/use-workspace-labels";
import type { WorkspaceProjectSummary } from "@/web/hooks/use-workspace-projects";
import type { WorkspaceTaskGroup } from "@/web/hooks/use-workspace-task-groups";
import { getPriorityLabel } from "@/web/util/task-display";

import { ProjectFilter } from "./filters/ProjectFilter";
import { TaskGroupFilter } from "./filters/TaskGroupFilter";

export interface MyTasksFilterBarProps {
  projects: WorkspaceProjectSummary[];
  taskGroups: WorkspaceTaskGroup[];
  /**
   * Workspace-wide deduplicated label options. Name-keyed: labels are
   * project-scoped rows, so the cross-project identity is the
   * case-insensitive name (see `useWorkspaceLabels`) — the bar maps each
   * entry to a `LabelFilterOption` whose `id` IS the name.
   */
  labels: WorkspaceLabel[];
  selectedProjectIds: string[];
  selectedTaskGroupIds: string[];
  selectedPriorities: TaskPriority[];
  dueDateFrom: string | null;
  dueDateTo: string | null;
  noDueDate: boolean;
  /** Selected label NAMES — never contains the FILTER_NONE sentinel. */
  selectedLabelNames: string[];
  /** Whether the "No label" absence filter is active (the `noLabel` param). */
  noLabel: boolean;
  onProjectsChange: (next: string[]) => void;
  onTaskGroupsChange: (next: string[]) => void;
  onPrioritiesChange: (next: TaskPriority[]) => void;
  /**
   * Patch-style due-date change handler. A single patch can carry several
   * keys (quick-picks set `from`+`to`; "Clear dates" resets all three; the
   * date-range chip remover clears `from`+`to`), and the owner MUST apply the
   * whole patch in ONE `setSearchParams` update — react-router's functional
   * updater closes over the render-time params, so per-key calls in the same
   * handler clobber each other (last write wins).
   */
  onDueDateChange: (patch: Partial<DueDateFilterValue>) => void;
  /**
   * Receives LabelFilter's complete next selection: label names plus the
   * {@link FILTER_NONE} sentinel when the pinned "No label" option is on.
   * The owner splits the sentinel into the `noLabel` boolean and writes both
   * the `label` and `noLabel` params in ONE update — the sentinel must never
   * leak into the `label` param because "none" is a legal label name.
   */
  onLabelsChange: (next: string[]) => void;
  /**
   * Clears EVERY filter dimension atomically. This must be a single callback
   * (not the individual change handlers called back-to-back): all setters
   * write the URL via react-router's functional `setSearchParams`, whose
   * updater closes over the render-time params — each subsequent call would
   * start from the same stale URL and resurrect params an earlier call just
   * deleted.
   */
  onClearAll: () => void;
  projectsLoading?: boolean;
  taskGroupsLoading?: boolean;
}

/**
 * Workspace-level filter bar for the My Tasks page.
 *
 * Combines the workspace-specific project and column (task-group) popovers
 * with the same controlled Priority/DueDate/Label popovers the in-project
 * TaskFilterBar uses, so both surfaces look and behave identically. Label
 * options are workspace-deduplicated by name and `onManageLabels` is omitted
 * deliberately: label management is project-scoped (the dialog needs a
 * `projectId`), so LabelFilter's zero-options state degrades to explanatory
 * text instead.
 *
 * Active filters render as removable chips beneath the controls, mirroring
 * the in-project FilterChips — including dedicated "No due date" / "No label"
 * absence chips whose removers strip ONLY the absence flag (absence
 * OR-composes with the rest of its dimension, so real values must survive).
 */
export function MyTasksFilterBar({
  projects,
  taskGroups,
  labels,
  selectedProjectIds,
  selectedTaskGroupIds,
  selectedPriorities,
  dueDateFrom,
  dueDateTo,
  noDueDate,
  selectedLabelNames,
  noLabel,
  onProjectsChange,
  onTaskGroupsChange,
  onPrioritiesChange,
  onDueDateChange,
  onLabelsChange,
  onClearAll,
  projectsLoading,
  taskGroupsLoading,
}: MyTasksFilterBarProps) {
  const hasActiveFilters =
    selectedProjectIds.length > 0 ||
    selectedTaskGroupIds.length > 0 ||
    selectedPriorities.length > 0 ||
    Boolean(dueDateFrom || dueDateTo) ||
    noDueDate ||
    selectedLabelNames.length > 0 ||
    noLabel;
  const projectsSelected = selectedProjectIds.length > 0;

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const groupById = new Map(taskGroups.map((g) => [g.id, g]));
  /**
   * Case-insensitive name lookup for chip colors. The URL is user-editable,
   * so a selected name may differ in case from the canonical option ("bug"
   * vs "Bug") — the server matches names case-insensitively, and the chip
   * should find the swatch color the same way.
   */
  const labelByLowerName = new Map(labels.map((l) => [l.name.toLowerCase(), l]));

  /** Name-keyed options per `useWorkspaceLabels` — the name IS the identity. */
  const labelOptions: LabelFilterOption[] = labels.map((l) => ({
    id: l.name,
    name: l.name,
    color: l.color,
  }));
  /**
   * LabelFilter's selection re-joins names with the FILTER_NONE sentinel so
   * its pinned "No label" option reflects the `noLabel` param; the sentinel
   * exists only inside this popover contract and is split back out by the
   * owner's `onLabelsChange` before anything touches the URL.
   */
  const labelSelected = noLabel
    ? [...selectedLabelNames, FILTER_NONE]
    : selectedLabelNames;

  return (
    <div className="task-filter-bar">
      <div className="task-filter-bar__controls">
        <Filter size={14} className="text-fg-muted shrink-0" />
        <ProjectFilter
          projects={projects}
          selected={selectedProjectIds}
          onChange={onProjectsChange}
          loading={projectsLoading}
        />
        <TaskGroupFilter
          groups={taskGroups}
          selected={selectedTaskGroupIds}
          onChange={onTaskGroupsChange}
          projectsSelected={projectsSelected}
          loading={taskGroupsLoading}
        />
        <PriorityFilter
          selected={selectedPriorities}
          onChange={onPrioritiesChange}
        />
        <DueDateFilter
          from={dueDateFrom}
          to={dueDateTo}
          noDueDate={noDueDate}
          onChange={onDueDateChange}
        />
        <LabelFilter
          options={labelOptions}
          selected={labelSelected}
          onChange={onLabelsChange}
        />
        {hasActiveFilters && (
          <button
            type="button"
            className="task-filter-bar__clear"
            onClick={onClearAll}
          >
            Clear filters
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="task-filter-bar__chips">
          {selectedProjectIds.map((id) => {
            const p = projectById.get(id);
            return (
              <span key={`project-${id}`} className="task-filter-bar__chip">
                {p?.name ?? "Unknown project"}
                <button
                  type="button"
                  aria-label={`Remove project filter ${p?.name ?? id}`}
                  onClick={() =>
                    onProjectsChange(selectedProjectIds.filter((x) => x !== id))
                  }
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
          {selectedTaskGroupIds.map((id) => {
            const g = groupById.get(id);
            return (
              <span key={`group-${id}`} className="task-filter-bar__chip">
                {g ? (
                  <>
                    <Text
                      as="span"
                      variant="body-3"
                      color="muted"
                      className="mr-1"
                    >
                      {g.projectName} /
                    </Text>
                    {g.name}
                  </>
                ) : (
                  "Unknown column"
                )}
                <button
                  type="button"
                  aria-label={`Remove column filter ${g?.name ?? id}`}
                  onClick={() =>
                    onTaskGroupsChange(
                      selectedTaskGroupIds.filter((x) => x !== id),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
          {selectedPriorities.map((priority) => (
            <span key={`priority-${priority}`} className="task-filter-bar__chip">
              {getPriorityLabel(priority)}
              <button
                type="button"
                aria-label={`Remove priority filter ${priority}`}
                onClick={() =>
                  onPrioritiesChange(
                    selectedPriorities.filter((p) => p !== priority),
                  )
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {(dueDateFrom || dueDateTo) && (
            <span className="task-filter-bar__chip">
              {dueDateFrom && dueDateTo
                ? `${dueDateFrom} — ${dueDateTo}`
                : dueDateFrom
                  ? `From ${dueDateFrom}`
                  : `Until ${dueDateTo}`}
              {/* Removing the range chip clears BOTH bounds in one patch —
                  the owner applies it as a single URL update (per-key writes
                  would resurrect one bound; see onDueDateChange). It must NOT
                  touch noDueDate: absence is an independent OR sub-filter of
                  the dimension with its own chip. */}
              <button
                type="button"
                aria-label="Remove due date filter"
                onClick={() => onDueDateChange({ from: null, to: null })}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {noDueDate && (
            <span className="task-filter-bar__chip">
              No due date
              <button
                type="button"
                aria-label="Remove no due date filter"
                onClick={() => onDueDateChange({ noDueDate: false })}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {noLabel && (
            <span className="task-filter-bar__chip">
              No label
              {/* Passing the names WITHOUT the sentinel switches noLabel off
                  while keeping every selected label name active. */}
              <button
                type="button"
                aria-label="Remove no label filter"
                onClick={() => onLabelsChange(selectedLabelNames)}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedLabelNames.map((name) => {
            const lbl = labelByLowerName.get(name.toLowerCase());
            return (
              <span key={`label-${name}`} className="task-filter-bar__chip">
                {lbl && (
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: lbl.color }}
                  />
                )}
                {name}
                <button
                  type="button"
                  aria-label={`Remove label filter ${name}`}
                  onClick={() =>
                    onLabelsChange(
                      noLabel
                        ? [
                            ...selectedLabelNames.filter((n) => n !== name),
                            FILTER_NONE,
                          ]
                        : selectedLabelNames.filter((n) => n !== name),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
