import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { TaskCheckbox } from "@/web/components/form/TaskCheckbox";
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
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";
import { useWorkspaceProjects } from "@/web/hooks/use-workspace-projects";
import { useWorkspaceTaskGroups } from "@/web/hooks/use-workspace-task-groups";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { formatDueDate, isDueToday, isOverdue } from "@/web/util/date";
import { getPriorityBadgeVariant, getPriorityLabel, PRIORITY_SORT_ORDER } from "@/web/util/task-display";

import { MyTasksFilterBar } from "./MyTasksFilterBar";

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

function parseIdList(raw: string | null): string[] {
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export default function MyTasks() {
  useDocumentTitle("My Tasks");
  const { workspace, members } = useWorkspace();
  const qc = useQueryClient();
  const { toast } = useToast();
  const reducedMotion = usePrefersReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<FilterTab>("week");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  const selectedProjectIds = useMemo(
    () => parseIdList(searchParams.get("project")),
    [searchParams],
  );
  const selectedTaskGroupIds = useMemo(
    () => parseIdList(searchParams.get("taskGroup")),
    [searchParams],
  );

  const setProjectFilter = useCallback(
    (next: string[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.length > 0) params.set("project", next.join(","));
          else params.delete("project");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setTaskGroupFilter = useCallback(
    (next: string[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.length > 0) params.set("taskGroup", next.join(","));
          else params.delete("taskGroup");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const projectsQuery = useWorkspaceProjects(workspace.id);
  /**
   * Only active projects are offered in the filter. The my-tasks handler
   * already restricts tasks to active projects, so including archived or
   * completed ones in the dropdown would let users pick filters that
   * deterministically return zero results.
   */
  const projects = useMemo(
    () => (projectsQuery.data?.projects ?? []).filter((p) => p.status === "active"),
    [projectsQuery.data],
  );

  const taskGroupsQuery = useWorkspaceTaskGroups(
    workspace.id,
    selectedProjectIds,
  );
  const taskGroups = useMemo(
    () => taskGroupsQuery.data?.taskGroups ?? [],
    [taskGroupsQuery.data],
  );

  /**
   * Prune selected task-group ids that are no longer valid for the current
   * project selection. Happens when the user deselects a project whose
   * columns were previously filtered on. Only runs once the groups query has
   * resolved so we don't drop ids before we know the real valid set.
   */
  useEffect(() => {
    if (selectedTaskGroupIds.length === 0) return;
    if (selectedProjectIds.length === 0) {
      setTaskGroupFilter([]);
      return;
    }
    if (!taskGroupsQuery.isSuccess) return;
    const validIds = new Set(taskGroups.map((g) => g.id));
    const pruned = selectedTaskGroupIds.filter((id) => validIds.has(id));
    if (pruned.length !== selectedTaskGroupIds.length) {
      setTaskGroupFilter(pruned);
    }
  }, [
    selectedProjectIds,
    selectedTaskGroupIds,
    taskGroups,
    taskGroupsQuery.isSuccess,
    setTaskGroupFilter,
  ]);

  const apiPeriod = getApiPeriod(activeTab);
  const myTasksQueryKey = useMemo(
    () =>
      queryKeys.workspaces.dashboardMyTasks(
        workspace.id,
        apiPeriod ?? "all",
        selectedProjectIds,
        selectedTaskGroupIds,
      ),
    [workspace.id, apiPeriod, selectedProjectIds, selectedTaskGroupIds],
  );

  const {
    data,
    isLoading: loading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<MyTasksResponse>({
    queryKey: myTasksQueryKey,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (apiPeriod) params.set("period", apiPeriod);
      if (pageParam) params.set("cursor", pageParam as string);
      if (selectedProjectIds.length > 0) {
        params.set("projectIds", selectedProjectIds.join(","));
      }
      if (selectedTaskGroupIds.length > 0) {
        params.set("taskGroupIds", selectedTaskGroupIds.join(","));
      }
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

  const handleCompleteTask = useCallback(
    async (taskId: string) => {
      if (completingIds.has(taskId)) return;

      // Start fade-out animation + checkbox check
      setCompletingIds((prev) => new Set(prev).add(taskId));

      // Wait for animation before removing from list
      const delay = reducedMotion ? 0 : 250;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));

      // Snapshot for rollback. Scope to the active filter/period combo so
      // optimistic removal and rollback target the cache entry the user is
      // actually viewing.
      const previousData = qc.getQueryData(myTasksQueryKey);

      // Optimistically remove from all pages
      qc.setQueryData<{ pages: MyTasksResponse[]; pageParams: unknown[] }>(
        myTasksQueryKey,
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              tasks: page.tasks.filter((t) => t.id !== taskId),
            })),
          };
        },
      );

      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });

      try {
        await api.post(`/api/tasks/${taskId}/complete`, {});
        void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
        void qc.invalidateQueries({
          queryKey: queryKeys.workspaces.dashboard(workspace.id),
        });
      } catch {
        qc.setQueryData(myTasksQueryKey, previousData);
        toast("Failed to complete task", { variant: "error" });
      }
    },
    [completingIds, reducedMotion, workspace.id, myTasksQueryKey, qc, toast],
  );

  const columns = useMemo<ColumnDef<MyTask>[]>(
    () => [
      {
        key: "complete",
        header: "",
        width: "40px",
        render: (row) => (
          <div
            className="flex items-center"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <TaskCheckbox
              size="sm"
              checked={completingIds.has(row.id)}
              disabled={completingIds.has(row.id)}
              onChange={() => void handleCompleteTask(row.id)}
              aria-label={`Complete task: ${row.title}`}
            />
          </div>
        ),
      },
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
    [setSelectedTaskId, completingIds, handleCompleteTask],
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

        <MyTasksFilterBar
          projects={projects}
          taskGroups={taskGroups}
          selectedProjectIds={selectedProjectIds}
          selectedTaskGroupIds={selectedTaskGroupIds}
          onProjectsChange={setProjectFilter}
          onTaskGroupsChange={setTaskGroupFilter}
          projectsLoading={projectsQuery.isLoading}
          taskGroupsLoading={taskGroupsQuery.isLoading}
        />

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
                        "ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-semibold",
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
            rowClassName={(row) =>
              completingIds.has(row.id)
                ? "opacity-0 transition-all duration-200 ease-out"
                : "transition-all duration-200"
            }
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
