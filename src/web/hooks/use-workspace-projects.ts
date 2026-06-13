import { useQuery } from "@tanstack/react-query";

import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

/**
 * Mirrors the rows returned by `GET /api/workspaces/:workspaceId/projects`
 * (the `listProjects` handler: full project table columns plus the
 * `memberCount` / `taskGroupCount` enrichments). Project rows have no
 * `slug` or `archivedAt` columns — archival is expressed via
 * `status === "archived"` — so those fields must never be declared here:
 * non-optional phantom fields would type-check while being `undefined` at
 * runtime for every consumer.
 */
export interface WorkspaceProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: string;
  icon: string | null;
  coverImageKey: string | null;
  coverImagePosition: number | null;
  position: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  taskGroupCount: number;
}

/**
 * Fetches the list of projects in a workspace that the current user can see.
 *
 * Workspace owners/admins see every project in the workspace. Non-elevated
 * members see only the projects they are a direct member of. The backend
 * handles this visibility split, so callers can trust the returned list.
 */
export function useWorkspaceProjects(
  workspaceId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.workspaces.projects(workspaceId),
    queryFn: () =>
      api.get<{ projects: WorkspaceProjectSummary[] }>(
        `/api/workspaces/${workspaceId}/projects`,
      ),
    enabled: options?.enabled,
  });
}
