import { Columns3 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { Checkbox } from "@/web/components/form/Checkbox";
import { SearchInput } from "@/web/components/form/SearchInput";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import type { WorkspaceTaskGroup } from "@/web/hooks/use-workspace-task-groups";

/**
 * Column (task-group) filter for the workspace-level My Tasks view.
 *
 * Task groups belong to a specific project, so this filter is only meaningful
 * once at least one project has been selected. The filter is disabled when
 * `projectsSelected` is false; when enabled the options are grouped under
 * their project name so users can quickly find the column they want across
 * multiple projects.
 */
export function TaskGroupFilter({
  groups,
  selected,
  onChange,
  projectsSelected,
  loading,
}: {
  groups: WorkspaceTaskGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  projectsSelected: boolean;
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const isActive = selected.length > 0;

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? groups.filter(
          (g) =>
            g.name.toLowerCase().includes(q) ||
            g.projectName.toLowerCase().includes(q),
        )
      : groups;

    const byProject = new Map<string, { projectId: string; projectName: string; groups: WorkspaceTaskGroup[] }>();
    for (const g of filtered) {
      const entry = byProject.get(g.projectId) ?? {
        projectId: g.projectId,
        projectName: g.projectName,
        groups: [],
      };
      entry.groups.push(g);
      byProject.set(g.projectId, entry);
    }
    return Array.from(byProject.values());
  }, [groups, search]);

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((g) => g !== id)
      : [...selected, id];
    onChange(next);
  }

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={!projectsSelected}
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
          title={
            projectsSelected ? undefined : "Select one or more projects first"
          }
        >
          <Columns3 size={14} />
          Column
          {isActive && (
            <Badge variant="info" className="task-filter-bar__count">
              {selected.length}
            </Badge>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by column
        </Text>
        {groups.length > 5 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            size="sm"
            placeholder="Search columns..."
            className="mb-2"
          />
        )}
        <div className="task-filter-bar__popover-list">
          {loading ? (
            <Text variant="body-3" color="muted">Loading…</Text>
          ) : grouped.length === 0 ? (
            <Text variant="body-3" color="muted">No columns found</Text>
          ) : (
            grouped.map((section) => (
              <Fragment key={section.projectId}>
                <Text
                  variant="body-3"
                  color="muted"
                  weight="semibold"
                  className="mt-1 px-2"
                >
                  {section.projectName}
                </Text>
                {section.groups.map((g) => (
                  <label key={g.id} className="task-filter-bar__option">
                    <Checkbox
                      checked={selected.includes(g.id)}
                      onChange={() => toggle(g.id)}
                    />
                    <span className="truncate">{g.name}</span>
                  </label>
                ))}
              </Fragment>
            ))
          )}
        </div>
      </Popover.Content>
    </Popover>
  );
}
