import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Checkbox, Input } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Badge, Text } from "@/web/components/ui";
import type { WorkspaceProjectSummary } from "@/web/hooks/use-workspace-projects";

/* ------------------------------------------------------------------ */
/*  ProjectMultiSelect                                                 */
/*                                                                     */
/*  Searchable, scrollable checkbox list for picking up to 50 projects */
/*  to scope a token to. Mirrors the backend cap so users can't build  */
/*  a selection the API will reject.                                   */
/* ------------------------------------------------------------------ */

const MAX_PROJECTS = 50;

interface ProjectMultiSelectProps {
  projects: WorkspaceProjectSummary[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
}

export function ProjectMultiSelect({
  projects,
  selectedIds,
  onChange,
  loading,
}: ProjectMultiSelectProps) {
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(needle));
  }, [projects, query]);

  function toggle(id: string) {
    const next = new Set(selectedSet);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= MAX_PROJECTS) return;
      next.add(id);
    }
    onChange([...next]);
  }

  const atCapacity = selectedIds.length >= MAX_PROJECTS;

  return (
    <Stack gap="r5">
      <Row gap="r5" align="center" className="flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search
            size={14}
            className="absolute left-r5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
          />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects..."
            className="pl-r2"
            aria-label="Search projects"
          />
        </div>
        <Badge variant={atCapacity ? "warning" : "default"}>
          {selectedIds.length} / {MAX_PROJECTS} selected
        </Badge>
      </Row>

      {atCapacity && (
        <Alert variant="warning">
          You&apos;ve selected the maximum of {MAX_PROJECTS} projects. Deselect
          one to add another.
        </Alert>
      )}

      <div className="max-h-60 overflow-y-auto rounded-md border border-border-default/60 bg-surface-0">
        {loading ? (
          <div className="p-r4">
            <Text variant="body-3" color="muted">
              Loading projects...
            </Text>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-r4">
            <Text variant="body-3" color="muted">
              {query ? "No projects match your search." : "No projects in this workspace."}
            </Text>
          </div>
        ) : (
          <ul className="divide-y divide-border-default/40">
            {filtered.map((project) => {
              const checked = selectedSet.has(project.id);
              const disabled = !checked && atCapacity;
              return (
                <li key={project.id}>
                  <label
                    className={
                      "flex items-center gap-r5 px-r4 py-r5 " +
                      (disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-1")
                    }
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(project.id)}
                      aria-label={`Toggle access to project ${project.name}`}
                    />
                    <Text variant="body-2" as="span" className="flex-1 truncate">
                      {project.name}
                    </Text>
                    {checked && <Check size={14} className="text-accent shrink-0" />}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Stack>
  );
}
