import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";

import { Container, Row, Stack } from "@/web/components/layout";
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Tabs,
  Text,
} from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { TaskDetailDialog } from "@/web/components/ui/TaskDetailDialog";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { formatDueDate, isDueToday, isOverdue } from "@/web/util/date";
import { getPriorityBadgeVariant, getPriorityLabel, PRIORITY_SORT_ORDER } from "@/web/util/task-display";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MyTaskRaw {
  id: string;
  title: string;
  completed: boolean;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  dueDate: string | null;
  projectId: string;
  projectName: string;
}

interface MyTask extends MyTaskRaw {
  project: { id: string; name: string };
}

interface MyTasksResponse {
  tasks: MyTaskRaw[];
  nextCursor: string | null;
}

function normalizeMyTask(t: MyTaskRaw): MyTask {
  return { ...t, project: { id: t.projectId, name: t.projectName } };
}

/* ------------------------------------------------------------------ */
/*  Filter tab definitions                                             */
/* ------------------------------------------------------------------ */

/**
 * FilterTab controls both the API period parameter and an optional
 * client-side post-filter. "all" and "week" map directly to API
 * periods. "today" and "overdue" fetch all tasks and filter on the
 * client so we can apply date logic without requiring new API params.
 */
type FilterTab = "all" | "today" | "week" | "overdue";

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "overdue", label: "Overdue" },
];

/**
 * Map a FilterTab to the API period param. Tabs that require client-side
 * filtering pass no period so the API returns the full set.
 */
function getApiPeriod(tab: FilterTab): string | undefined {
  switch (tab) {
    case "week":
      return "week";
    case "all":
    case "today":
    case "overdue":
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/*  MyTasks page                                                       */
/* ------------------------------------------------------------------ */

export default function MyTasks() {
  useDocumentTitle("My Tasks");
  const { workspace, members } = useWorkspace();

  const [activeTab, setActiveTab] = useState<FilterTab>("week");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const apiPeriod = getApiPeriod(activeTab);
  const {
    data,
    isLoading: loading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<MyTasksResponse>({
    queryKey: queryKeys.workspaces.dashboardMyTasks(workspace.id, apiPeriod ?? "all"),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (apiPeriod) params.set("period", apiPeriod);
      if (pageParam) params.set("cursor", pageParam as string);
      return api.get<MyTasksResponse>(
        `/api/workspaces/${workspace.id}/dashboard/my-tasks?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const allTasks = useMemo(
    () => (data?.pages.flatMap((p) => p.tasks) ?? []).map(normalizeMyTask),
    [data?.pages],
  );

  /** Apply client-side filter for "today" and "overdue" tabs. */
  const filteredTasks = useMemo(() => {
    switch (activeTab) {
      case "today":
        return allTasks.filter((t) => t.dueDate && isDueToday(t.dueDate));
      case "overdue":
        return allTasks.filter((t) => t.dueDate && isOverdue(t.dueDate));
      default:
        return allTasks;
    }
  }, [allTasks, activeTab]);

  /** Counts for each tab so users can see distribution at a glance. */
  const tabCounts = useMemo(() => {
    const todayCount = allTasks.filter((t) => t.dueDate && isDueToday(t.dueDate)).length;
    const overdueCount = allTasks.filter((t) => t.dueDate && isOverdue(t.dueDate)).length;
    return {
      all: allTasks.length,
      today: todayCount,
      week: activeTab === "week" ? allTasks.length : null,
      overdue: overdueCount,
    };
  }, [allTasks, activeTab]);

  // Custom sort comparator for priority and dueDate
  const sortComparator = useMemo(
    () =>
      (
        a: MyTask,
        b: MyTask,
        columnKey: string,
        direction: "asc" | "desc",
      ): number => {
        let result: number;

        if (columnKey === "priority") {
          const aOrder = PRIORITY_SORT_ORDER[a.priority] ?? 99;
          const bOrder = PRIORITY_SORT_ORDER[b.priority] ?? 99;
          result = aOrder - bOrder;
        } else if (columnKey === "dueDate") {
          const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          result = aTime - bTime;
        } else {
          // Fallback for other sortable string columns
          result = a.title.localeCompare(b.title);
        }

        return direction === "desc" ? -result : result;
      },
    [],
  );

  const columns = useMemo<ColumnDef<MyTask>[]>(
    () => [
      {
        key: "title",
        header: "Task",
        render: (row) => (
          <button
            type="button"
            className="text-left text-fg-primary hover:underline font-medium"
            onClick={() => setSelectedTaskId(row.id)}
          >
            {row.title}
          </button>
        ),
      },
      {
        key: "project",
        header: "Project",
        render: (row) => <Badge variant="default">{row.project.name}</Badge>,
      },
      {
        key: "priority",
        header: "Priority",
        sortable: true,
        render: (row) => (
          <Badge variant={getPriorityBadgeVariant(row.priority)}>
            {getPriorityLabel(row.priority)}
          </Badge>
        ),
      },
      {
        key: "dueDate",
        header: "Due Date",
        sortable: true,
        render: (row) => (
          <Text
            variant="body-3"
            as="span"
            color={
              row.dueDate && isOverdue(row.dueDate) ? "primary" : "secondary"
            }
            className={
              row.dueDate && isOverdue(row.dueDate) ? "text-status-error" : ""
            }
          >
            {formatDueDate(row.dueDate)}
          </Text>
        ),
      },
    ],
    [setSelectedTaskId],
  );

  return (
    <Container size="xl" className="py-r2">
      <Stack gap="r3">
        <Breadcrumbs>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
          <Breadcrumbs.Item current>My Tasks</Breadcrumbs.Item>
        </Breadcrumbs>
        <Row justify="between" align="center">
          <Text variant="h3">My Tasks</Text>
          {!loading && (
            <Text variant="body-2" color="muted">
              {filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"}
            </Text>
          )}
        </Row>

        <Tabs
          defaultValue="week"
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as FilterTab)}
          variant="underline"
        >
          <Tabs.List>
            {FILTER_TABS.map((tab) => {
              const isActive = activeTab === tab.value;
              const count =
                tab.value === "week"
                  ? tabCounts.week
                  : tabCounts[tab.value];
              const isOverdueTab = tab.value === "overdue";
              const hasOverdue = isOverdueTab && (tabCounts.overdue ?? 0) > 0;

              return (
                <Tabs.Tab key={tab.value} value={tab.value} className="gap-1.5">
                  {isOverdueTab && hasOverdue && (
                    <AlertTriangle size={14} className={isActive ? "" : "text-status-error"} />
                  )}
                  {tab.label}
                  {count != null && !loading && (
                    <span
                      className={[
                        "ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold",
                        hasOverdue
                          ? "bg-status-error/10 text-status-error"
                          : "bg-surface-2 text-fg-muted",
                      ].join(" ")}
                    >
                      {count}
                    </span>
                  )}
                </Tabs.Tab>
              );
            })}
          </Tabs.List>
        </Tabs>

        {isError && (
          <QueryErrorRetry message="Failed to load tasks." onRetry={refetch} />
        )}

        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <DataTable<MyTask>
            data={filteredTasks}
            columns={columns}
            rowKey={(row) => row.id}
            loading={loading}
            sortComparator={sortComparator}
            emptyContent={
              <EmptyState size="md">
                <EmptyStateTitle>No tasks assigned to you</EmptyStateTitle>
                <EmptyStateDescription>
                  Tasks assigned to you will appear here
                </EmptyStateDescription>
              </EmptyState>
            }
          />
        </div>

        {hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading..." : "Load more tasks"}
            </Button>
          </div>
        )}
      </Stack>

      {selectedTaskId && (
        <TaskDetailDialog
          taskId={selectedTaskId}
          members={members}
          open={!!selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </Container>
  );
}
