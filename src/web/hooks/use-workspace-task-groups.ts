import { useQuery } from "@tanstack/react-query";

import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

export interface WorkspaceTaskGroup {
  id: string;
  name: string;
  color: string | null;
  isCompletionGroup: boolean;
  position: string;
  projectId: string;
  projectName: string;
}

/**
 * Fetches task groups across a set of projects in a workspace, restricted to
 * projects the current user can see. Returns an empty list when `projectIds`
 * is empty — no request is issued.
 *
 * Used by workspace-level views (e.g. the My Tasks filter bar) where the user
 * narrows to columns across one or more projects without having to open each
 * project first.
 */
export function useWorkspaceTaskGroups(
  workspaceId: string,
  projectIds: string[],
  options?: { enabled?: boolean },
) {
  const sortedIds = [...projectIds].sort();
  const hasProjects = sortedIds.length > 0;

  return useQuery({
    queryKey: queryKeys.workspaces.taskGroups(workspaceId, sortedIds),
    queryFn: () => {
      const params = new URLSearchParams({ projectIds: sortedIds.join(",") });
      return api.get<{ taskGroups: WorkspaceTaskGroup[] }>(
        `/api/workspaces/${workspaceId}/task-groups?${params.toString()}`,
      );
    },
    enabled: hasProjects && options?.enabled !== false,
  });
}
