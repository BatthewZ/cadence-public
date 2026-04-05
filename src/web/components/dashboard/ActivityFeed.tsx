import { History } from "lucide-react";
import type { ReactNode } from "react";

import { Row, Stack } from "@/web/components/layout";
import { Avatar, Button, Card, Skeleton, Text } from "@/web/components/ui";
import { formatRelativeTime } from "@/web/util/activity";

/**
 * Base activity fields that every feed item must provide.
 * Both WorkspaceActivityItem and ProjectActivityItem satisfy this shape.
 */
interface BaseActivityItem {
  id: string;
  taskId: string;
  taskTitle: string;
  actorName: string | null;
  actorImage: string | null;
  createdAt: string;
}

/**
 * A single rendered row in the activity timeline.
 * The calling page maps its raw data (including any grouping logic)
 * into this flat shape so the shared component stays presentation-only.
 */
interface ActivityFeedRow<T extends BaseActivityItem> {
  /** Unique key for the row (typically `activity.id`). */
  key: string;
  /** The underlying activity item (used for avatar, actor name, etc.). */
  activity: T;
  /** Pre-formatted message string describing the action. */
  message: string;
}

interface ActivityFeedProps<T extends BaseActivityItem> {
  /** Pre-processed rows ready for rendering. */
  rows: ActivityFeedRow<T>[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean | undefined;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  onTaskClick: (taskId: string) => void;
  /**
   * Optional renderer for extra contextual info per row (e.g. project name
   * in the workspace dashboard). Returns a ReactNode rendered between the
   * task link and the timestamp.
   */
  renderExtra?: (activity: T) => ReactNode;
}

/**
 * Shared activity feed component used by both the workspace and project
 * dashboards. It handles the common loading/error/empty states, timeline
 * rendering with avatars, and infinite-scroll "Load more" logic.
 *
 * The calling page is responsible for:
 * - Invoking the appropriate data-fetching hook
 * - Performing any grouping (e.g. label activity collapsing)
 * - Mapping raw data into `ActivityFeedRow[]` with pre-formatted messages
 *
 * This eliminates the ~150 lines of duplicated component code that
 * previously existed in Dashboard/components/ActivityFeed.tsx and
 * ProjectDashboard/components/ActivityFeed.tsx.
 */
function ActivityFeed<T extends BaseActivityItem>({
  rows,
  isLoading,
  isError,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  onTaskClick,
  renderExtra,
}: ActivityFeedProps<T>) {
  if (isLoading) {
    return (
      <Card>
        <Stack gap="r4">
          <Row gap="r5" align="center">
            <History size={16} className="text-fg-muted" />
            <Text variant="h6">Recent Activity</Text>
          </Row>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-start gap-r5">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </Stack>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <Stack gap="r4">
          <Row gap="r5" align="center">
            <History size={16} className="text-fg-muted" />
            <Text variant="h6">Recent Activity</Text>
          </Row>
          <Text variant="body-2" color="secondary">
            Failed to load activity.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <History size={16} className="text-fg-muted" />
          <Text variant="h6">Recent Activity</Text>
        </Row>

        {rows.length === 0 ? (
          <Text variant="body-3" color="muted">
            No activity yet
          </Text>
        ) : (
          <div className="relative">
            {/* Timeline connector line */}
            {rows.length > 1 && (
              <div className="absolute left-3 top-6 bottom-6 w-px bg-border-default" />
            )}
            <div className="space-y-4">
              {rows.map((row) => {
                const { activity, message } = row;
                return (
                  <div
                    key={row.key}
                    className="relative flex items-start gap-r5"
                  >
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
                        </span>{" "}
                        {message}
                      </Text>
                      <div className="flex items-center gap-r6 mt-0.5">
                        <button
                          type="button"
                          className="text-[var(--font-size-body-3)] text-accent hover:underline cursor-pointer truncate max-w-48"
                          onClick={() => onTaskClick(activity.taskId)}
                        >
                          {activity.taskTitle}
                        </button>
                        {renderExtra && (
                          <Text
                            variant="body-3"
                            color="muted"
                            className="shrink-0 text-[0.625rem]"
                          >
                            {renderExtra(activity)}
                          </Text>
                        )}
                        <Text variant="body-3" color="muted">
                          {formatRelativeTime(activity.createdAt)}
                        </Text>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more from server */}
            {hasNextPage && (
              <div className="flex justify-center mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Stack>
    </Card>
  );
}

export { ActivityFeed };
export type { ActivityFeedRow, BaseActivityItem };
