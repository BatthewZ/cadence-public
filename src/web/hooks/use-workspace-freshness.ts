import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";

interface WorkspaceFreshness {
  freshness: {
    workspace: number | null;
    projects: number | null;
    tasks: number | null;
  };
}

/**
 * Polls the workspace freshness endpoint and selectively invalidates React
 * Query caches for workspace-level views (dashboard, project list, My Tasks).
 * Uses a slower interval than project freshness since workspace-level changes
 * are less frequent.
 */
export function useWorkspaceFreshness(workspaceId: string, multiUser = true): void {
  const qc = useQueryClient();
  const lastSeen = useRef<Record<string, number | null>>({});

  const enabled = workspaceId.length > 0 && multiUser;

  const { data } = useQuery({
    queryKey: queryKeys.freshness.workspace(workspaceId),
    queryFn: () => api.get<WorkspaceFreshness>(`/api/workspaces/${workspaceId}/freshness`),
    enabled,
    refetchInterval: enabled ? 3000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data?.freshness) return;

    const { freshness } = data;
    const prev = lastSeen.current;

    if (Object.keys(prev).length === 0) {
      lastSeen.current = { ...freshness };
      return;
    }

    // Workspace detail & members
    if (freshness.workspace !== null && freshness.workspace !== prev.workspace) {
      if (freshnessTracker.shouldInvalidate("workspace")) {
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) });
      }
    }

    // Project list
    if (freshness.projects !== null && freshness.projects !== prev.projects) {
      if (freshnessTracker.shouldInvalidate("projects")) {
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.projects(workspaceId) });
      }
    }

    // Tasks across workspace (dashboard, my tasks, upcoming)
    if (freshness.tasks !== null && freshness.tasks !== prev.tasks) {
      if (freshnessTracker.shouldInvalidate("tasks")) {
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspaceId) });
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboardMyTasksPrefix(workspaceId) });
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboardUpcoming(workspaceId) });
      }
    }

    lastSeen.current = { ...freshness };
  }, [data, workspaceId, qc]);
}
