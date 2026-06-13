import { useQuery } from "@tanstack/react-query";

import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

/**
 * One deduplicated label option at workspace scope. Deliberately has NO `id`:
 * labels are project-scoped rows, so the same conceptual label ("Bug" in
 * project A, "bug" in project B) exists as distinct rows with distinct ids.
 * For cross-project filtering the label's identity is its case-insensitive
 * *name* — the endpoint groups by `LOWER(name)` and returns one
 * representative `{ name, color }` per group. Exposing any single row's id
 * here would silently pin a "workspace-wide" filter to one project's label.
 */
export interface WorkspaceLabel {
  name: string;
  color: string;
}

/**
 * Fetches the deduplicated label set across every **active** project the
 * current user can see in a workspace.
 *
 * Used by workspace-level views (e.g. the My Tasks label filter) where the
 * user narrows tasks by label without caring which project a label row
 * physically lives in. Options are name-keyed for the reason documented on
 * {@link WorkspaceLabel}; consumers that feed `LabelFilter` should map each
 * entry to `{ id: name, name, color }` and send the selected *names* to the
 * API (`labelNames` CSV param), never ids.
 *
 * Unlike `useWorkspaceTaskGroups` there is no project-ids argument: the label
 * option list is workspace-wide by design (the server already restricts it to
 * projects the caller can see), so the query runs whenever a workspace id is
 * present.
 */
export function useWorkspaceLabels(
  workspaceId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.workspaces.labels(workspaceId),
    queryFn: () =>
      api.get<{ labels: WorkspaceLabel[] }>(
        `/api/workspaces/${workspaceId}/labels`,
      ),
    enabled: Boolean(workspaceId) && options?.enabled !== false,
  });
}
