import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { useMemo, useState } from "react";

import { Stack } from "@/web/components/layout";
import { Avatar } from "@/web/components/ui/Avatar";
import { Button } from "@/web/components/ui/Button";
import { Skeleton } from "@/web/components/ui/Skeleton";
import { Text } from "@/web/components/ui/Text";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import {
  type ActivityItem,
  formatActivityMessage,
  formatRelativeTime,
  formatTokenAttribution,
} from "@/web/util/activity";

const INITIAL_LIMIT = 4;

interface ActivityPage {
  activities: ActivityItem[];
  nextCursor: string | null;
}

interface TaskActivityFeedProps {
  taskId: string;
  members: WorkspaceMember[];
}

const activityHeader = (
  <div className="flex items-center gap-r5">
    <History size={16} className="text-fg-muted" />
    <Text variant="body-2" weight="semibold">Activity</Text>
  </div>
);

export function TaskActivityFeed({ taskId, members }: TaskActivityFeedProps) {
  const [expanded, setExpanded] = useState(false);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<ActivityPage>({
    queryKey: queryKeys.tasks.activity(taskId),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(INITIAL_LIMIT + 1) });
      if (pageParam) params.set("cursor", pageParam as string);
      return api.get<ActivityPage>(
        `/api/tasks/${taskId}/activity?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const allActivities = useMemo(
    () => data?.pages.flatMap((p) => p.activities) ?? [],
    [data],
  );

  const canCollapse = allActivities.length > INITIAL_LIMIT;
  const visibleActivities = canCollapse && !expanded
    ? allActivities.slice(0, INITIAL_LIMIT)
    : allActivities;

  if (isLoading) {
    return (
      <Stack gap="r4">
        {activityHeader}
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-r5">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </Stack>
    );
  }

  if (isError) {
    return (
      <Stack gap="r4">
        {activityHeader}
        <Text variant="body-2" color="secondary">Failed to load activity.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="r4">
      {activityHeader}

      {allActivities.length === 0 ? (
        <Text variant="body-3" color="muted">No activity yet</Text>
      ) : (
        <div className="relative">
          {/* Timeline connector line */}
          {visibleActivities.length > 1 && (
            <div className="absolute left-3 top-6 bottom-6 w-px bg-border-default" />
          )}
          <div className="space-y-4">
            {visibleActivities.map((activity) => {
              const tokenAttribution = formatTokenAttribution(activity);
              return (
                <div key={activity.id} className="relative flex items-start gap-r5">
                  <div className="relative z-10 shrink-0 rounded-full bg-surface-0">
                    <Avatar
                      size="xs"
                      name={activity.actorName ?? undefined}
                      src={activity.actorImage ?? undefined}
                    />
                  </div>
                  <div className="min-w-0 flex-1 pt-px">
                    <Text variant="body-3">
                      <span className="font-semibold">
                        {activity.actorName ?? "Someone"}
                      </span>
                      {tokenAttribution && (
                        <>
                          {" "}
                          <span className="text-fg-muted">{tokenAttribution}</span>
                        </>
                      )}{" "}
                      {formatActivityMessage(activity, members)}
                    </Text>
                    <Text variant="body-3" color="muted">
                      {formatRelativeTime(activity.createdAt)}
                    </Text>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Show more / Show less toggle for initially loaded items */}
          {canCollapse && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 flex items-center gap-1 text-fg-muted hover:text-fg-default text-[var(--font-size-body-3)] cursor-pointer duration-fast"
            >
              {expanded ? (
                <>
                  <ChevronUp size={14} />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown size={14} />
                  Show {allActivities.length - INITIAL_LIMIT} more {allActivities.length - INITIAL_LIMIT === 1 ? "activity" : "activities"}
                </>
              )}
            </button>
          )}

          {/* Load more from server */}
          {expanded && hasNextPage && (
            <div className="flex justify-center mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading..." : "Load more activity"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Stack>
  );
}
