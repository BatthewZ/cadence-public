import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { Row, Stack } from "@/web/components/layout";
import {
  Accordion,
  Badge,
  Button,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Skeleton,
  Text,
} from "@/web/components/ui";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { formatDueDate, isOverdue } from "@/web/util/date";
import {
  getPriorityBadgeVariant,
  getPriorityLabel,
} from "@/web/util/task-display";

import type { DashboardTask, MyTasksResponse, UpcomingResponse } from "./types";
import { normalizeTask } from "./types";

/* ------------------------------------------------------------------ */
/*  Bucket key mapping for Accordion                                   */
/* ------------------------------------------------------------------ */

const bucketKey: Record<string, string> = {
  Overdue: "overdue",
  Today: "today",
  "This Week": "this-week",
  "Next Week": "next-week",
  "This Month": "this-month",
  Later: "later",
};

/* ------------------------------------------------------------------ */
/*  TaskRow — compact task row inside accordion                        */
/* ------------------------------------------------------------------ */

function TaskRow({ task, onTaskClick }: { task: DashboardTask; onTaskClick: (taskId: string) => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-r5 py-r5 text-left hover:bg-surface-1 rounded-md transition-colors"
      onClick={() => onTaskClick(task.id)}
    >
      <Text variant="body-2" className="flex-1 truncate">
        {task.title}
      </Text>
      <Text variant="body-3" color="muted" className="shrink-0">
        {task.project.name}
      </Text>
      {task.dueDate && (
        <Text
          variant="body-3"
          color={isOverdue(task.dueDate) ? "primary" : "secondary"}
          className={`shrink-0 ${isOverdue(task.dueDate) ? "text-status-error" : ""}`}
        >
          {formatDueDate(task.dueDate)}
        </Text>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  TimeGroupedTaskList — Accordion with date buckets                  */
/* ------------------------------------------------------------------ */

function TimeGroupedTaskList({ onTaskClick }: { onTaskClick: (taskId: string) => void }) {
  const { workspace } = useWorkspace();
  const {
    data,
    isLoading: loading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<UpcomingResponse>({
    queryKey: queryKeys.workspaces.dashboardUpcoming(workspace.id),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (pageParam) params.set("cursor", pageParam as string);
      return api.get<UpcomingResponse>(
        `/api/workspaces/${workspace.id}/dashboard/upcoming?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  if (loading) {
    return (
      <Stack gap="r4">
        {Array.from({ length: 2 }, (_, i) => (
          <Stack key={i} gap="r5">
            <Skeleton variant="text" className="h-5 w-28" />
            {Array.from({ length: 3 }, (_, j) => (
              <Row key={j} align="center" gap="r5" className="py-r5">
                <Skeleton variant="rounded" className="h-5 w-14 shrink-0" />
                <Skeleton variant="text" className="h-4 flex-1" />
                <Skeleton variant="text" className="h-4 w-16 shrink-0" />
              </Row>
            ))}
          </Stack>
        ))}
      </Stack>
    );
  }

  if (error) {
    return (
      <QueryErrorRetry message="Failed to load upcoming tasks." onRetry={refetch} />
    );
  }

  // Merge buckets across all pages
  const bucketLabelMap: Record<string, string> = {
    overdue: "Overdue",
    today: "Today",
    this_week: "This Week",
    next_week: "Next Week",
    this_month: "This Month",
    later: "Later",
  };
  const bucketOrder = ["overdue", "today", "this_week", "next_week", "this_month", "later"];

  const mergedBuckets: Record<string, DashboardTask[]> = {};
  for (const page of data?.pages ?? []) {
    for (const key of bucketOrder) {
      if (key in page.buckets) {
        if (!mergedBuckets[key]) mergedBuckets[key] = [];
        mergedBuckets[key].push(...(page.buckets[key] ?? []).map(normalizeTask));
      }
    }
  }

  const buckets = bucketOrder
    .filter((key) => key in mergedBuckets)
    .map((key) => ({ label: bucketLabelMap[key] ?? key, tasks: mergedBuckets[key] ?? [] }));
  const nonEmptyBuckets = buckets.filter((b) => b.tasks.length > 0);

  if (nonEmptyBuckets.length === 0) {
    return (
      <EmptyState size="md">
        <EmptyStateTitle>No upcoming tasks</EmptyStateTitle>
        <EmptyStateDescription>
          Tasks with due dates will appear here grouped by time.
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  // Auto-expand Overdue and Today
  const defaultOpen = nonEmptyBuckets
    .filter((b) => b.label === "Overdue" || b.label === "Today")
    .map((b) => bucketKey[b.label] ?? b.label);

  return (
    <>
      <Accordion mode="multiple" defaultValue={defaultOpen}>
        {nonEmptyBuckets.map((bucket) => {
          const key = bucketKey[bucket.label] ?? bucket.label;
          return (
            <Accordion.Item key={key} value={key}>
              <Accordion.Trigger>
                <Row gap="r5" align="center">
                  <span>{bucket.label}</span>
                  {bucket.label === "Overdue" ? (
                    <Badge variant="error">{bucket.tasks.length}</Badge>
                  ) : (
                    <Badge variant="default">{bucket.tasks.length}</Badge>
                  )}
                </Row>
              </Accordion.Trigger>
              <Accordion.Content>
                <Stack gap="r6">
                  {bucket.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onTaskClick={onTaskClick} />
                  ))}
                </Stack>
              </Accordion.Content>
            </Accordion.Item>
          );
        })}
      </Accordion>
      {hasNextPage && (
        <div className="flex justify-center mt-r4">
          <Button
            variant="ghost"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading..." : "Load more tasks"}
          </Button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  MyTasksPreview — compact preview of assigned tasks (top 5)         */
/* ------------------------------------------------------------------ */

const MY_TASKS_PREVIEW_LIMIT = 5;

function MyTasksPreview({ onTaskClick }: { onTaskClick: (taskId: string) => void }) {
  const { workspace } = useWorkspace();
  const { data, isLoading: loading, error, refetch } = useQuery({
    queryKey: queryKeys.workspaces.dashboardMyTasksPreview(workspace.id),
    queryFn: () => api.get<MyTasksResponse>(`/api/workspaces/${workspace.id}/dashboard/my-tasks`),
  });

  if (loading) {
    return (
      <Stack gap="r6">
        {Array.from({ length: 3 }, (_, i) => (
          <Row key={i} align="center" gap="r5" className="py-r5">
            <Skeleton variant="rounded" className="h-5 w-14 shrink-0" />
            <Skeleton variant="text" className="h-4 flex-1" />
            <Skeleton variant="rounded" className="h-5 w-20 shrink-0" />
            <Skeleton variant="text" className="h-4 w-16 shrink-0" />
          </Row>
        ))}
      </Stack>
    );
  }

  if (error) {
    return (
      <QueryErrorRetry message="Failed to load tasks." onRetry={refetch} />
    );
  }

  const allTasks = (data?.tasks ?? []).map(normalizeTask);
  const previewTasks = allTasks.slice(0, MY_TASKS_PREVIEW_LIMIT);

  if (allTasks.length === 0) {
    return (
      <EmptyState size="md">
        <EmptyStateTitle>No tasks assigned</EmptyStateTitle>
        <EmptyStateDescription>
          Tasks assigned to you will appear here.
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  return (
    <Stack gap="r6">
      {previewTasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className="flex w-full items-center gap-r5 py-r5 text-left hover:bg-surface-1 rounded-md transition-colors"
          onClick={() => onTaskClick(task.id)}
        >
          <Badge variant={getPriorityBadgeVariant(task.priority)} className="shrink-0">
            {getPriorityLabel(task.priority)}
          </Badge>
          <Text variant="body-2" className="flex-1 truncate">
            {task.title}
          </Text>
          <Text variant="body-3" color="muted" className="shrink-0">
            {task.project.name}
          </Text>
          {task.dueDate && (
            <Text
              variant="body-3"
              color={isOverdue(task.dueDate) ? "primary" : "secondary"}
              className={`shrink-0 ${isOverdue(task.dueDate) ? "text-status-error" : ""}`}
            >
              {formatDueDate(task.dueDate)}
            </Text>
          )}
        </button>
      ))}
    </Stack>
  );
}

export { MyTasksPreview,TaskRow, TimeGroupedTaskList };
