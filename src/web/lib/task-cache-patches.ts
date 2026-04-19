import type { QueryClient } from "@tanstack/react-query";

import type { Task } from "@/web/contexts/ProjectContext";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

/**
 * Apply a partial Task update to every React Query cache that may hold the
 * task, and return a rollback closure that restores the prior snapshots.
 *
 * Why: blanket invalidation cascades into 5+ refetches per single-field edit
 * (tasks.detail + projects.tasks + projects.dashboard + every dashboard
 * sub-key). Optimistic patching keeps the UI in sync with zero refetches; the
 * mutation result is the only network call.
 *
 * Called from useMutation.onMutate; rollback() is called from onError.
 *
 * Caches walked:
 *   - tasks.detail(taskId)                              — single detail (TaskDetail shape)
 *   - projects.tasks(projectId)                         — flat board/list array
 *   - workspaces.dashboardMyTasksPreview(workspaceId)   — flat preview list
 *   - workspaces.dashboardMyTasks(workspaceId, …)       — paginated, multiple filter combos
 *   - workspaces.dashboardUpcoming(workspaceId)         — paginated, time-bucketed
 *
 * The dashboard caches only carry a subset of Task fields (id, title,
 * completed, priority, dueDate, projectId, projectName) — fields outside
 * that subset are silently dropped from those caches via the per-entry
 * key check, so we never invent foreign properties.
 *
 * Ordering / repositioning (e.g. moving across dueDate buckets in
 * dashboardUpcoming, or reordering after priority change) is NOT recomputed
 * locally; the server is source of truth on next mount/focus. Pair with
 * quietInvalidateTaskStats() so stale ordering refreshes silently in the
 * background.
 */

type TaskListCache = { tasks: Array<Record<string, unknown> & { id: string }> };
type DetailCache = { task: TaskDetail };
type PaginatedListCache = {
  pages: Array<{
    tasks: Array<Record<string, unknown> & { id: string }>;
    nextCursor?: unknown;
  }>;
  pageParams: unknown[];
};
type UpcomingCache = {
  pages: Array<{
    buckets: Record<string, Array<Record<string, unknown> & { id: string }>>;
    nextCursor?: unknown;
  }>;
  pageParams: unknown[];
};

export interface PatchTaskInCachesOptions {
  taskId: string;
  workspaceId: string;
  projectId?: string;
  patch: Partial<Task>;
}

type Snapshot = { queryKey: readonly unknown[]; data: unknown };

function applyPatchToEntry<T extends Record<string, unknown> & { id: string }>(
  entry: T,
  patch: Partial<Task>,
): T {
  // Only assign keys that already exist on the entry, so we don't pollute
  // narrow dashboard rows with fields they don't carry (e.g. description).
  const next = { ...entry } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key in entry) next[key] = value;
  }
  return next as T;
}

function patchListCache(
  qc: QueryClient,
  queryKey: readonly unknown[],
  taskId: string,
  patch: Partial<Task>,
  snapshots: Snapshot[],
): void {
  const prev = qc.getQueryData<TaskListCache>(queryKey);
  if (!prev) return;
  const idx = prev.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  snapshots.push({ queryKey, data: prev });
  qc.setQueryData<TaskListCache>(queryKey, {
    tasks: prev.tasks.map((t, i) => (i === idx ? applyPatchToEntry(t, patch) : t)),
  });
}

function patchPaginatedListCaches(
  qc: QueryClient,
  prefix: readonly unknown[],
  taskId: string,
  patch: Partial<Task>,
  snapshots: Snapshot[],
): void {
  const matches = qc.getQueriesData<PaginatedListCache>({
    queryKey: prefix,
    exact: false,
  });
  for (const [queryKey, prev] of matches) {
    if (!prev?.pages) continue;
    let touched = false;
    const nextPages = prev.pages.map((page) => {
      const idx = page.tasks?.findIndex((t) => t.id === taskId) ?? -1;
      if (idx === -1) return page;
      touched = true;
      return {
        ...page,
        tasks: page.tasks.map((t, i) => (i === idx ? applyPatchToEntry(t, patch) : t)),
      };
    });
    if (!touched) continue;
    snapshots.push({ queryKey, data: prev });
    qc.setQueryData<PaginatedListCache>(queryKey, { ...prev, pages: nextPages });
  }
}

function patchUpcomingCaches(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  patch: Partial<Task>,
  snapshots: Snapshot[],
): void {
  const queryKey = queryKeys.workspaces.dashboardUpcoming(workspaceId);
  const prev = qc.getQueryData<UpcomingCache>(queryKey);
  if (!prev?.pages) return;
  let touched = false;
  const nextPages = prev.pages.map((page) => {
    if (!page.buckets) return page;
    let pageTouched = false;
    const nextBuckets: Record<string, Array<Record<string, unknown> & { id: string }>> = {};
    for (const [bucketName, entries] of Object.entries(page.buckets)) {
      const idx = entries.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        nextBuckets[bucketName] = entries;
        continue;
      }
      pageTouched = true;
      touched = true;
      nextBuckets[bucketName] = entries.map((t, i) =>
        i === idx ? applyPatchToEntry(t, patch) : t,
      );
    }
    return pageTouched ? { ...page, buckets: nextBuckets } : page;
  });
  if (!touched) return;
  snapshots.push({ queryKey, data: prev });
  qc.setQueryData<UpcomingCache>(queryKey, { ...prev, pages: nextPages });
}

export function patchTaskInCaches(
  qc: QueryClient,
  { taskId, workspaceId, projectId, patch }: PatchTaskInCachesOptions,
): () => void {
  const snapshots: Snapshot[] = [];

  // 1) tasks.detail — single object with { task: TaskDetail }
  const detailKey = queryKeys.tasks.detail(taskId);
  const prevDetail = qc.getQueryData<DetailCache>(detailKey);
  if (prevDetail?.task) {
    snapshots.push({ queryKey: detailKey, data: prevDetail });
    qc.setQueryData<DetailCache>(detailKey, {
      task: { ...prevDetail.task, ...patch } as TaskDetail,
    });
  }

  // 2) projects.tasks(projectId) — flat array
  if (projectId) {
    patchListCache(qc, queryKeys.projects.tasks(projectId), taskId, patch, snapshots);
  }

  // 3) workspaces.dashboardMyTasksPreview — flat array
  patchListCache(
    qc,
    queryKeys.workspaces.dashboardMyTasksPreview(workspaceId),
    taskId,
    patch,
    snapshots,
  );

  // 4) workspaces.dashboardMyTasks (every filter combo) — paginated array
  patchPaginatedListCaches(
    qc,
    queryKeys.workspaces.dashboardMyTasksPrefix(workspaceId),
    taskId,
    patch,
    snapshots,
  );

  // 5) workspaces.dashboardUpcoming — paginated, time-bucketed
  patchUpcomingCaches(qc, workspaceId, taskId, patch, snapshots);

  return () => {
    for (const snap of snapshots) {
      qc.setQueryData(snap.queryKey, snap.data);
    }
  };
}

/**
 * Mark task-stat caches stale without triggering an immediate refetch
 * (refetchType: 'none'). Stats refresh on the next mount/focus instead of
 * piling more requests onto a single user action.
 *
 * Use after a task-field mutation to keep counts/priority-breakdown/overdue
 * lists eventually-consistent without burning network on every keystroke.
 */
export function quietInvalidateTaskStats(
  qc: QueryClient,
  workspaceId: string,
  projectId?: string,
): void {
  void qc.invalidateQueries({
    queryKey: queryKeys.workspaces.dashboard(workspaceId),
    refetchType: "none",
  });
  if (projectId) {
    void qc.invalidateQueries({
      queryKey: queryKeys.projects.dashboard(projectId),
      refetchType: "none",
    });
  }
}
