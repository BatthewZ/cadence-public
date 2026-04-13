import { FolderKanban } from "lucide-react";
import { useMemo, useState } from "react";

import { Checkbox } from "@/web/components/form/Checkbox";
import { SearchInput } from "@/web/components/form/SearchInput";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import type { WorkspaceProjectSummary } from "@/web/hooks/use-workspace-projects";

export function ProjectFilter({
  projects,
  selected,
  onChange,
  loading,
}: {
  projects: WorkspaceProjectSummary[];
  selected: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const isActive = selected.length > 0;

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((p) => p !== id)
      : [...selected, id];
    onChange(next);
  }

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
        >
          <FolderKanban size={14} />
          Project
          {isActive && (
            <Badge variant="info" className="task-filter-bar__count">
              {selected.length}
            </Badge>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by project
        </Text>
        {projects.length > 5 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            size="sm"
            placeholder="Search projects..."
            className="mb-2"
          />
        )}
        <div className="task-filter-bar__popover-list">
          {loading ? (
            <Text variant="body-3" color="muted">Loading…</Text>
          ) : filtered.length === 0 ? (
            <Text variant="body-3" color="muted">No projects found</Text>
          ) : (
            filtered.map((p) => (
              <label key={p.id} className="task-filter-bar__option">
                <Checkbox
                  checked={selected.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="truncate">{p.name}</span>
              </label>
            ))
          )}
        </div>
      </Popover.Content>
    </Popover>
  );
}
