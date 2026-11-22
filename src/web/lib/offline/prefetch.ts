import { onlineManager, type QueryClient, type QueryKey } from "@tanstack/react-query";

import type { Task } from "@/web/contexts/ProjectContext";
import { api, ApiError } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

import { KV_STORE, type OfflineDb } from "./idb";

/**
 * Keeps every project the person can see readable offline, not just the ones they happened to
 * open while connected. While online, in the background, it loads each workspace's projects and,
 * per project, what its board and task panels show, into the same queries those screens read
 * (so the persister saves them like any other read).
 *
 * Per project it first asks the cheap freshness endpoint and skips a project whose freshness is
 * unchanged since its last load, unless that load is older than PREFETCH_MAX_AGE_MS: freshness
 * doesn't see every edit (subtasks, labels, members).
 */

/** After the runtime starts, so the first screen's own requests go first. */
export const PREFETCH_START_DELAY_MS = 5_000;
export const PREFETCH_INTERVAL_MS = 15 * 60_000;
export const PREFETCH_MAX_AGE_MS = 60 * 60_000;
/** Workspace-level lists fetched less than this ago are left alone. */
const WORKSPACE_FRESH_MS = 5 * 60_000;
/** Completed tasks whose panel is kept: the Done column shows the most recent 10. */
export const COMPLETED_DETAILS_PER_PROJECT = 10;
const CONCURRENCY = 2;

export interface PrefetchOutbox {
  getStatus(): { pending: number; sending: number };
  writesMade(): number;
}

export interface PrefetchDeps {
  qc: QueryClient;
  db: OfflineDb;
  outbox: PrefetchOutbox;
  /** False once this account's runtime has stopped (sign-out, account switch). */
  isCurrent: () => boolean;
  isOnline?: () => boolean;
  get?: <T>(path: string) => Promise<T>;
  now?: () => number;
}

interface ProjectStamp {
  signature: string;
  at: number;
}

interface PrefetchSummary {
  projects: number;
  loaded: number;
  skipped: number;
  failed: number;
}

class Stopped extends Error {}

/** No connection (status 0) or no session: nothing more will load this pass. */
const endsPass = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status === 401);

const stampKey = (projectId: string) => `prefetch:project:${projectId}`;

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

async function inPool<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

type TaskWithSubtasks = Task & { subtasks?: TaskDetail["subtasks"] };

function withoutSubtasks(task: TaskWithSubtasks): Task {
  const plain = { ...task };
  delete plain.subtasks;
  return plain;
}

/** The panels worth having offline: every open task, and the most recently completed. */
function tasksWithDetail<T extends Task>(tasks: T[]): T[] {
  const completed = tasks
    .filter((t) => t.completed)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, COMPLETED_DETAILS_PER_PROJECT);
  return [...tasks.filter((t) => !t.completed), ...completed];
}

/** One background pass. Exported for tests; the runtime calls it through `startOfflinePrefetch`. */
export async function prefetchForOffline(deps: PrefetchDeps): Promise<PrefetchSummary | null> {
  const { qc, db, outbox, isCurrent } = deps;
  const get = deps.get ?? (<T>(path: string) => api.get<T>(path));
  const now = deps.now ?? Date.now;
  const online = deps.isOnline ?? (() => onlineManager.isOnline());
  // Writes waiting to sync: the server's copy lacks them, so loading it would hide them on screen.
  const canRun = () =>
    isCurrent() && online() && !saveData() && outbox.getStatus().pending === 0 && outbox.getStatus().sending === 0;
  if (!canRun()) return null;

  /** Fetches `path` into `key`, unless the run stopped or this device made a write meanwhile. */
  const load = async <T>(key: QueryKey, path: string, onLoaded?: (data: T, startedAt: number) => unknown) => {
    const startedAt = now();
    const writes = outbox.writesMade();
    const data = await get<T>(path);
    if (!canRun()) throw new Stopped();
    if (outbox.writesMade() !== writes) return null;
    qc.setQueryData(key, onLoaded ? onLoaded(data, startedAt) : data, { updatedAt: startedAt });
    return data;
  };
  const freshEnough = (key: QueryKey) => now() - (qc.getQueryState(key)?.dataUpdatedAt ?? 0) < WORKSPACE_FRESH_MS;
  const loadUnlessFresh = <T>(key: QueryKey, path: string) =>
    freshEnough(key) ? Promise.resolve(qc.getQueryData<T>(key) ?? null) : load<T>(key, path);

  const summary: PrefetchSummary = { projects: 0, loaded: 0, skipped: 0, failed: 0 };
  try {
    const workspaces = await loadUnlessFresh<{ workspaces: { id: string }[] }>(queryKeys.workspaces.all, "/api/workspaces");
    const projectIds: string[] = [];
    for (const ws of workspaces?.workspaces ?? []) {
      await loadUnlessFresh(queryKeys.workspaces.detail(ws.id), `/api/workspaces/${ws.id}`);
      await loadUnlessFresh(queryKeys.workspaces.members(ws.id), `/api/workspaces/${ws.id}/members`);
      const projects = await loadUnlessFresh<{ projects: { id: string }[] }>(
        queryKeys.workspaces.projects(ws.id),
        `/api/workspaces/${ws.id}/projects`,
      );
      for (const p of projects?.projects ?? []) projectIds.push(p.id);
    }
    summary.projects = projectIds.length;

    await inPool(projectIds, async (projectId) => {
      if (!canRun()) throw new Stopped();
      try {
        await prefetchProject(projectId);
      } catch (err) {
        if (err instanceof Stopped || endsPass(err)) throw new Stopped();
        // One project failing (access just removed, a server error) doesn't stop the others.
        summary.failed++;
      }
    });
  } catch (err) {
    if (err instanceof Stopped || endsPass(err)) return null;
    throw err;
  }
  return summary;

  async function prefetchProject(projectId: string): Promise<void> {
    const { freshness } = await get<{ freshness: unknown }>(`/api/projects/${projectId}/freshness`);
    const signature = JSON.stringify(freshness);
    const stamp = await db.get<ProjectStamp>(KV_STORE, stampKey(projectId));
    const cached = qc.getQueryData(queryKeys.projects.tasks(projectId)) !== undefined;
    if (cached && stamp?.signature === signature && now() - stamp.at < PREFETCH_MAX_AGE_MS) {
      summary.skipped++;
      return;
    }
    const at = now();
    const results = await Promise.all([
      load(queryKeys.projects.detail(projectId), `/api/projects/${projectId}`),
      load(queryKeys.projects.members(projectId), `/api/projects/${projectId}/members`),
      load(queryKeys.projects.taskGroups(projectId), `/api/projects/${projectId}/task-groups`),
      load(queryKeys.projects.labels(projectId), `/api/projects/${projectId}/labels`),
      load(queryKeys.projects.savedViews(projectId), `/api/projects/${projectId}/views`),
      load<{ tasks: TaskWithSubtasks[] }>(
        queryKeys.projects.tasks(projectId),
        `/api/projects/${projectId}/tasks?include=subtasks`,
        (data, startedAt) => {
          seedTaskDetails(qc, projectId, data.tasks, startedAt);
          // The board's query holds the plain list; the subtasks went to each task's detail.
          return { tasks: data.tasks.map(withoutSubtasks) };
        },
      ),
    ]);
    // A write made meanwhile left something unloaded: no stamp, so the next pass tries again.
    if (results.some((r) => r === null)) return;
    await db.put(KV_STORE, { signature, at } satisfies ProjectStamp, stampKey(projectId));
    summary.loaded++;
  }
}

/**
 * Each task's detail (what its panel shows) from the list with subtasks. A detail already newer
 * than this load (fetched, or edited on this device since) is kept.
 */
function seedTaskDetails(
  qc: QueryClient,
  projectId: string,
  tasks: TaskWithSubtasks[],
  startedAt: number,
): void {
  for (const task of tasksWithDetail(tasks)) {
    const key = queryKeys.tasks.detail(task.id);
    if ((qc.getQueryState(key)?.dataUpdatedAt ?? 0) >= startedAt) continue;
    const detail: TaskDetail = { ...task, projectId, subtasks: task.subtasks ?? [], commentCount: task.commentCount ?? 0 };
    qc.setQueryData(key, { task: detail }, { updatedAt: startedAt });
  }
}

/**
 * Runs `prefetchForOffline` a little after start, every PREFETCH_INTERVAL_MS, and when the
 * connection returns. A pass due while writes wait to sync is retried shortly after. Returns stop.
 */
export function startOfflinePrefetch(deps: PrefetchDeps): () => void {
  let stopped = false;
  let running = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    if (stopped || running) return;
    if (deps.outbox.getStatus().pending > 0) {
      retry ??= setTimeout(() => {
        retry = null;
        run();
      }, 30_000);
      return;
    }
    running = true;
    void prefetchForOffline(deps)
      .catch((err: unknown) => console.warn("[offline] background refresh failed", err))
      .finally(() => {
        running = false;
      });
  };
  const later = () => setTimeout(run, PREFETCH_START_DELAY_MS);

  const first = later();
  const interval = setInterval(run, PREFETCH_INTERVAL_MS);
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = onlineManager.subscribe((isOnline) => {
    if (!isOnline) return;
    if (reconnect) clearTimeout(reconnect);
    reconnect = later();
  });

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
    if (reconnect) clearTimeout(reconnect);
    if (retry) clearTimeout(retry);
    unsubscribe();
  };
}
