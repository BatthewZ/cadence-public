import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

export interface ProjectActivityItem {
  id: string;
  taskId: string;
  taskTitle: string;
  actorId: string | null;
  actorName: string | null;
  actorImage: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  /** Set when the action was performed by a Personal Access Token. */
  apiTokenId: string | null;
  /** Display name of the token, joined server-side; null when no token or token deleted. */
  tokenName: string | null;
}

interface ProjectActivityPage {
  activities: ProjectActivityItem[];
  nextCursor: string | null;
}

const ACTIVITY_LIMIT = 15;

export function useProjectActivity(projectId: string) {
  return useInfiniteQuery<ProjectActivityPage>({
    queryKey: queryKeys.projects.activity(projectId),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(ACTIVITY_LIMIT) });
      if (pageParam) params.set("cursor", pageParam as string);
      return api.get<ProjectActivityPage>(
        `/api/projects/${projectId}/activity?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });
}
