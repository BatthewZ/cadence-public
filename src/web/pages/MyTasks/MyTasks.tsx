import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { TaskPriority } from "@/shared/types/roles";
import { TaskCheckbox } from "@/web/components/form/TaskCheckbox";
import { Container, Row, Stack } from "@/web/components/layout";
import type { DueDateFilterValue } from "@/web/components/project/filters/DueDateFilter";
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
import {
  FILTER_NONE,
  parseDateParam,
  parsePriorities,
} from "@/web/hooks/use-task-filters";
import { useWorkspaceLabels } from "@/web/hooks/use-workspace-labels";
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

/**
 * Parses the `label` URL param: a CSV of label NAMES (not ids — labels are
 * project-scoped rows, so the cross-project identity used at workspace level
 * is the name; see `useWorkspaceLabels`). Mirrors the API's
 * `csvLabelNameList` constraints (trimmed, non-empty, each ≤30 chars, ≤50
 * entries) so a hand-edited URL degrades to dropping the invalid entries
 * instead of producing a request the server 400s on.
 *
 * `FILTER_NONE` ("none") is deliberately NOT special-cased here: label names
 * are user-entered and "none" is a legal label name, so the absence filter
 * travels in the dedicated `noLabel=true` param instead — the sentinel only
 * ever exists transiently inside the LabelFilter popover's selection array.
 */
function parseLabelNameList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= 1 && s.length <= 30)
    .slice(0, 50);
}

/**
 * Every URL search param the My Tasks filter bar owns. `clearAllFilters`
 * derives from this list so a new filter dimension cannot be added to the
 * setters but forgotten by "Clear filters" — exactly the bug class the
 * clear-all regression test pins (a lingering `noLabel` after "clear all"
 * would silently keep narrowing the task list).
 */
const MY_TASKS_FILTER_PARAMS = [
  "project",
  "taskGroup",
  "priority",
  "dueDateFrom",
  "dueDateTo",
  "noDueDate",
  "label",
  "noLabel",
] as const;

export default function MyTasks() {
  const { workspace, members } = useWorkspace();
  useDocumentTitle(`${workspace.name} — My Tasks`);
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
  /**
   * The remaining filter dimensions parse through the same validators the
   * project board uses (`parsePriorities` / `parseDateParam` from
   * `use-task-filters`): the URL is user-editable, and the server 400s on
   * invalid dates/priorities, so unvalidated passthrough would turn a
   * hand-typed `?dueDateFrom=banana` into a permanently failing query.
   * Validation makes bad values degrade to "no filter" instead.
   */
  const selectedPriorities = useMemo(
    () => parsePriorities(searchParams.get("priority")),
    [searchParams],
  );
  const dueDateFrom = useMemo(
    () => parseDateParam(searchParams.get("dueDateFrom")),
    [searchParams],
  );
  const dueDateTo = useMemo(
    () => parseDateParam(searchParams.get("dueDateTo")),
    [searchParams],
  );
  const noDueDate = searchParams.get("noDueDate") === "true";
  const selectedLabelNames = useMemo(
    () => parseLabelNameList(searchParams.get("label")),
    [searchParams],
  );
  const noLabel = searchParams.get("noLabel") === "true";

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

  const setPriorityFilter = useCallback(
    (next: TaskPriority[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.length > 0) params.set("priority", next.join(","));
          else params.delete("priority");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /**
   * Applies a due-date patch (any subset of from/to/noDueDate) in ONE
   * `setSearchParams` call. The patch can carry multiple keys — quick-picks
   * set `from`+`to` together, "Clear dates" resets all three — and per-key
   * calls would clobber each other: react-router's functional updater closes
   * over the render-time params, so back-to-back calls in the same handler
   * each start from the same stale URL and the last write wins.
   */
  const setDueDateFilter = useCallback(
    (patch: Partial<DueDateFilterValue>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (patch.from !== undefined) {
            if (patch.from) params.set("dueDateFrom", patch.from);
            else params.delete("dueDateFrom");
          }
          if (patch.to !== undefined) {
            if (patch.to) params.set("dueDateTo", patch.to);
            else params.delete("dueDateTo");
          }
          if (patch.noDueDate !== undefined) {
            if (patch.noDueDate) params.set("noDueDate", "true");
            else params.delete("noDueDate");
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /**
   * Receives LabelFilter's full next selection — label NAMES plus optionally
   * the {@link FILTER_NONE} sentinel from the pinned "No label" option — and
   * splits the sentinel out into the dedicated `noLabel=true` param. The
   * sentinel must never be written into the `label` param itself: label names
   * are user-entered and "none" is a legal label name, so `label=none` has to
   * unambiguously mean "the label named none". Both params are written in
   * this ONE `setSearchParams` call for the stale-closure reason documented
   * on {@link setDueDateFilter}.
   */
  const setLabelFilter = useCallback(
    (next: string[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          const names = next.filter((n) => n !== FILTER_NONE);
          if (names.length > 0) params.set("label", names.join(","));
          else params.delete("label");
          if (next.includes(FILTER_NONE)) params.set("noLabel", "true");
          else params.delete("noLabel");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /**
   * Clears ALL filter params in ONE `setSearchParams` call. Calling the
   * individual setters back-to-back does NOT work: react-router's functional
   * updater closes over the render-time params, so each subsequent call
   * starts from the same stale URL as the first and resurrects the params an
   * earlier call just deleted — "Clear filters" would silently leave most
   * filters active. The param list lives in {@link MY_TASKS_FILTER_PARAMS} so
   * this stays in sync with the setters by construction.
   */
  const clearAllFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        for (const param of MY_TASKS_FILTER_PARAMS) params.delete(param);
        return params;
      },
      { replace: true },
    );
  }, [setSearchParams]);

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
   * Workspace-wide deduplicated label options (name-keyed — see
   * `useWorkspaceLabels` for why labels have no cross-project id). Unlike
   * task groups these are independent of the project selection: the server
   * already scopes them to active projects the user can see.
   */
  const labelsQuery = useWorkspaceLabels(workspace.id);
  const labels = useMemo(
    () => labelsQuery.data?.labels ?? [],
    [labelsQuery.data],
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
        {
          priorities: selectedPriorities,
          dueDateFrom,
          dueDateTo,
          noDueDate,
          labelNames: selectedLabelNames,
          noLabel,
        },
      ),
    [
      workspace.id,
      apiPeriod,
      selectedProjectIds,
      selectedTaskGroupIds,
      selectedPriorities,
      dueDateFrom,
      dueDateTo,
      noDueDate,
      selectedLabelNames,
      noLabel,
    ],
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
      if (selectedPriorities.length > 0) {
        params.set("priority", selectedPriorities.join(","));
      }
      if (dueDateFrom) params.set("dueDateFrom", dueDateFrom);
      if (dueDateTo) params.set("dueDateTo", dueDateTo);
      if (noDueDate) params.set("noDueDate", "true");
      // URL param `label` (names CSV) maps to API param `labelNames`; the
      // absence flag is the separate `noLabel` param on both sides, never a
      // sentinel inside the names list ("none" is a legal label name).
      if (selectedLabelNames.length > 0) {
        params.set("labelNames", selectedLabelNames.join(","));
      }
      if (noLabel) params.set("noLabel", "true");
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
          labels={labels}
          selectedProjectIds={selectedProjectIds}
          selectedTaskGroupIds={selectedTaskGroupIds}
          selectedPriorities={selectedPriorities}
          dueDateFrom={dueDateFrom}
          dueDateTo={dueDateTo}
          noDueDate={noDueDate}
          selectedLabelNames={selectedLabelNames}
          noLabel={noLabel}
          onProjectsChange={setProjectFilter}
          onTaskGroupsChange={setTaskGroupFilter}
          onPrioritiesChange={setPriorityFilter}
          onDueDateChange={setDueDateFilter}
          onLabelsChange={setLabelFilter}
          onClearAll={clearAllFilters}
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
