import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { type OfflineDb, openOfflineDb } from "./idb";
import {
  COMPLETED_DETAILS_PER_PROJECT,
  PREFETCH_MAX_AGE_MS,
  type PrefetchDeps,
  prefetchForOffline,
} from "./prefetch";

const subtask = { id: "s1", title: "Sub", completed: false, position: "a0" };

function project(id: string) {
  const open = {
    id: `${id}-open`,
    title: "Open",
    completed: false,
    completedAt: null,
    taskGroupId: "g",
    position: "a0",
    commentCount: 2,
    subtasks: [subtask],
  };
  // More completed tasks than the Done column shows; days 1..12, so the newest are 03..12.
  const done = Array.from({ length: 12 }, (_, i) => ({
    id: `${id}-done-${i + 1}`,
    title: `Done ${i + 1}`,
    completed: true,
    completedAt: `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    taskGroupId: "d",
    position: `b${i}`,
    subtasks: [],
  }));
  return { tasks: [open, ...done] };
}

let db: OfflineDb;
let qc: QueryClient;
let clock: number;
let freshness: Record<string, number>;
let calls: string[];
let writes: number;
let pending: number;
let current: boolean;
let routes: Record<string, () => unknown>;

function deps(overrides: Partial<PrefetchDeps> = {}): PrefetchDeps {
  return {
    qc,
    db,
    outbox: { getStatus: () => ({ pending, sending: 0 }), writesMade: () => writes },
    isCurrent: () => current,
    isOnline: () => true,
    now: () => clock,
    get: <T>(path: string) => {
      calls.push(path);
      const route = routes[path];
      if (!route) return Promise.reject(new Error(`unexpected ${path}`));
      try {
        return Promise.resolve(route() as T);
      } catch (err) {
        return Promise.reject(err as Error);
      }
    },
    ...overrides,
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db = await openOfflineDb("u1");
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  clock = 1_000_000;
  freshness = { p1: 1, p2: 1 };
  calls = [];
  writes = 0;
  pending = 0;
  current = true;
  routes = {
    "/api/workspaces": () => ({ workspaces: [{ id: "w1" }] }),
    "/api/workspaces/w1": () => ({ workspace: { id: "w1" } }),
    "/api/workspaces/w1/members": () => ({ members: [] }),
    "/api/workspaces/w1/projects": () => ({ projects: [{ id: "p1" }, { id: "p2" }] }),
  };
  for (const id of ["p1", "p2"]) {
    routes[`/api/projects/${id}/freshness`] = () => ({ freshness: { tasks: freshness[id] } });
    routes[`/api/projects/${id}`] = () => ({ project: { id } });
    routes[`/api/projects/${id}/members`] = () => ({ members: [] });
    routes[`/api/projects/${id}/task-groups`] = () => ({ taskGroups: [] });
    routes[`/api/projects/${id}/labels`] = () => ({ labels: [] });
    routes[`/api/projects/${id}/views`] = () => ({ views: [] });
    routes[`/api/projects/${id}/tasks?include=subtasks`] = () => project(id);
  }
});

afterEach(() => db.close());

const tasksOf = (id: string) =>
  qc.getQueryData<{ tasks: Record<string, unknown>[] }>(queryKeys.projects.tasks(id))?.tasks;
const detailOf = (id: string) =>
  qc.getQueryData<{ task: Record<string, unknown> }>(queryKeys.tasks.detail(id))?.task;
const projectLoads = () => calls.filter((c) => c.endsWith("?include=subtasks"));

describe("prefetchForOffline", () => {
  it("loads every project's board and its tasks' panels, without subtasks on the board's list", async () => {
    await expect(prefetchForOffline(deps())).resolves.toMatchObject({
      projects: 2,
      loaded: 2,
      skipped: 0,
      failed: 0,
    });

    for (const id of ["p1", "p2"]) {
      expect(qc.getQueryData(queryKeys.projects.detail(id))).toEqual({ project: { id } });
      expect(qc.getQueryData(queryKeys.projects.taskGroups(id))).toEqual({ taskGroups: [] });
      expect(tasksOf(id)).toHaveLength(13);
      expect(tasksOf(id)?.every((t) => !("subtasks" in t))).toBe(true);
    }
    expect(detailOf("p1-open")).toMatchObject({
      projectId: "p1",
      subtasks: [subtask],
      commentCount: 2,
    });
    // Open tasks, plus the most recently completed the Done column shows.
    const done = Array.from({ length: 12 }, (_, i) => detailOf(`p1-done-${i + 1}`) !== undefined);
    expect(done.filter(Boolean)).toHaveLength(COMPLETED_DETAILS_PER_PROJECT);
    expect(done.slice(0, 2)).toEqual([false, false]);
  });

  it("skips an unchanged project, and reloads one whose freshness changed or whose copy is an hour old", async () => {
    await prefetchForOffline(deps());
    calls = [];

    await expect(prefetchForOffline(deps())).resolves.toMatchObject({ loaded: 0, skipped: 2 });
    expect(projectLoads()).toEqual([]);

    freshness.p2 = 2;
    await expect(prefetchForOffline(deps())).resolves.toMatchObject({ loaded: 1, skipped: 1 });
    expect(projectLoads()).toEqual(["/api/projects/p2/tasks?include=subtasks"]);

    calls = [];
    clock += PREFETCH_MAX_AGE_MS;
    await expect(prefetchForOffline(deps())).resolves.toMatchObject({ loaded: 2 });
  });

  it("drops a load when this device made a write meanwhile (it may predate it), and retries next pass", async () => {
    const original = routes["/api/projects/p1/tasks?include=subtasks"];
    routes["/api/projects/p1/tasks?include=subtasks"] = () => {
      writes++;
      return original();
    };

    await expect(prefetchForOffline(deps())).resolves.toMatchObject({ loaded: 1 });
    expect(tasksOf("p1")).toBeUndefined();
    expect(detailOf("p1-open")).toBeUndefined();

    routes["/api/projects/p1/tasks?include=subtasks"] = original;
    await expect(prefetchForOffline(deps())).resolves.toMatchObject({ loaded: 1, skipped: 1 });
    expect(tasksOf("p1")).toHaveLength(13);
  });

  it("writes nothing once the account's runtime has stopped", async () => {
    routes["/api/workspaces/w1/projects"] = () => {
      current = false; // signed out while this was in flight
      return { projects: [{ id: "p1" }] };
    };
    await expect(prefetchForOffline(deps())).resolves.toBeNull();
    expect(qc.getQueryData(queryKeys.workspaces.projects("w1"))).toBeUndefined();
    expect(tasksOf("p1")).toBeUndefined();
  });

  it("keeps a task panel newer than the load (fetched or edited since)", async () => {
    qc.setQueryData(
      queryKeys.tasks.detail("p1-open"),
      { task: { id: "p1-open", title: "Edited here" } },
      { updatedAt: clock + 1 }
    );
    await prefetchForOffline(deps());
    expect(detailOf("p1-open")).toEqual({ id: "p1-open", title: "Edited here" });
  });

  it("doesn't run while writes wait to sync, or offline", async () => {
    pending = 1;
    await expect(prefetchForOffline(deps())).resolves.toBeNull();
    pending = 0;
    await expect(prefetchForOffline(deps({ isOnline: () => false }))).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("carries on past a project that fails, and stops the pass when the connection goes", async () => {
    routes["/api/projects/p1/tasks?include=subtasks"] = () => {
      throw new ApiError(500, "boom");
    };
    await expect(prefetchForOffline(deps())).resolves.toMatchObject({ loaded: 1, failed: 1 });
    expect(tasksOf("p2")).toHaveLength(13);

    routes["/api/projects/p1/freshness"] = () => {
      throw new ApiError(0, "offline");
    };
    await expect(prefetchForOffline(deps())).resolves.toBeNull();
  });
});
