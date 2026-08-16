import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { jitteredInterval } from "@/web/lib/poll-interval";
import { queryKeys } from "@/web/lib/query-keys";

/** Centre of the project poll interval; jittered per tick. */
const PROJECT_POLL_MS = 1500;

interface ProjectFreshness {
  freshness: {
    project: number | null;
    tasks: number | null;
    taskGroups: number | null;
  };
}

/**
 * Polls the project freshness endpoint and selectively invalidates React Query
 * caches when another user's changes are detected. Pauses automatically when
 * the browser tab is hidden.
 */
export function useProjectFreshness(projectId: string, multiUser = true): void {
  const qc = useQueryClient();
  const lastSeen = useRef<Record<string, number | null>>({});

  const enabled = projectId.length > 0 && multiUser;

  const { data } = useQuery({
    queryKey: queryKeys.freshness.project(projectId),
    queryFn: () => api.get<ProjectFreshness>(`/api/projects/${projectId}/freshness`),
    enabled,
    refetchInterval: enabled ? jitteredInterval(PROJECT_POLL_MS) : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data?.freshness) return;

    const { freshness } = data;
    const prev = lastSeen.current;

    // On first poll, just record timestamps without invalidating
    if (Object.keys(prev).length === 0) {
      lastSeen.current = { ...freshness };
      return;
    }

    // Project detail, members, labels
    if (freshness.project !== null && freshness.project !== prev.project) {
      if (freshnessTracker.shouldInvalidate("project")) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
        void qc.invalidateQueries({ queryKey: queryKeys.projects.members(projectId) });
        void qc.invalidateQueries({ queryKey: queryKeys.projects.labels(projectId) });
      }
    }

    // Board list, plus the `tasks` prefix for any open detail view — the payload
    // is one MAX(updatedAt) and names no task id.
    if (freshness.tasks !== null && freshness.tasks !== prev.tasks) {
      if (freshnessTracker.shouldInvalidate("tasks")) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
        void qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
      }
    }

    // Task groups
    if (freshness.taskGroups !== null && freshness.taskGroups !== prev.taskGroups) {
      if (freshnessTracker.shouldInvalidate("taskGroups")) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.taskGroups(projectId) });
      }
    }

    lastSeen.current = { ...freshness };
  }, [data, projectId, qc]);
}
