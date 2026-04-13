import { Filter, X } from "lucide-react";

import { Text } from "@/web/components/ui/Text";
import type { WorkspaceProjectSummary } from "@/web/hooks/use-workspace-projects";
import type { WorkspaceTaskGroup } from "@/web/hooks/use-workspace-task-groups";

import { ProjectFilter } from "./filters/ProjectFilter";
import { TaskGroupFilter } from "./filters/TaskGroupFilter";

export interface MyTasksFilterBarProps {
  projects: WorkspaceProjectSummary[];
  taskGroups: WorkspaceTaskGroup[];
  selectedProjectIds: string[];
  selectedTaskGroupIds: string[];
  onProjectsChange: (next: string[]) => void;
  onTaskGroupsChange: (next: string[]) => void;
  projectsLoading?: boolean;
  taskGroupsLoading?: boolean;
}

/**
 * Workspace-level filter bar for the My Tasks page.
 *
 * Provides project and column (task-group) multi-select popovers. Task-group
 * options are scoped to the currently selected projects, so the column filter
 * is disabled until at least one project is chosen. Active filters render as
 * removable chips beneath the controls, mirroring the in-project
 * TaskFilterBar for visual consistency.
 */
export function MyTasksFilterBar({
  projects,
  taskGroups,
  selectedProjectIds,
  selectedTaskGroupIds,
  onProjectsChange,
  onTaskGroupsChange,
  projectsLoading,
  taskGroupsLoading,
}: MyTasksFilterBarProps) {
  const hasActiveFilters =
    selectedProjectIds.length > 0 || selectedTaskGroupIds.length > 0;
  const projectsSelected = selectedProjectIds.length > 0;

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const groupById = new Map(taskGroups.map((g) => [g.id, g]));

  function clearAll() {
    onProjectsChange([]);
    onTaskGroupsChange([]);
  }

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
        {hasActiveFilters && (
          <button
            type="button"
            className="task-filter-bar__clear"
            onClick={clearAll}
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
        </div>
      )}
    </div>
  );
}
