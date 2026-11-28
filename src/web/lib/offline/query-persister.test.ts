import { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { type OfflineDb, openOfflineDb } from "./idb";
import { mergeSavedCache, OFFLINE_CACHE_MAX_AGE_MS, persistQueryCache } from "./query-persister";

const tasksKey = (projectId: string) => ["projects", projectId, "tasks"];

/** Waits for the save that stopping a persister starts (it isn't awaited by design: it runs on page hide). */
const saved = () => new Promise((r) => setTimeout(r, 30));

/** One browser tab: its own query cache and its own connection to the shared database. */
async function openTab() {
  const db = await openOfflineDb("u1");
  const client = new QueryClient();
  const stop = await persistQueryCache(client, db);
  return { db, client, stop };
}

let connections: OfflineDb[] = [];

beforeEach(() => {
  for (const db of connections) db.close();
  connections = [];
  globalThis.indexedDB = new IDBFactory();
});

async function reload() {
  const tab = await openTab();
  connections.push(tab.db);
  return tab.client;
}

describe("persistQueryCache across tabs", () => {
  it("keeps every tab's projects for offline use, whichever tab saves last", async () => {
    // Both tabs start before either saves, so neither has the other's data in memory.
    const a = await openTab();
    const b = await openTab();
    connections.push(a.db, b.db);

    a.client.setQueryData(tasksKey("pA"), { tasks: [{ id: "a1" }] });
    a.stop();
    await saved();
    b.client.setQueryData(tasksKey("pB"), { tasks: [{ id: "b1" }] });
    b.stop();
    await saved();

    const restored = await reload();
    expect(restored.getQueryData(tasksKey("pA"))).toEqual({ tasks: [{ id: "a1" }] });
    expect(restored.getQueryData(tasksKey("pB"))).toEqual({ tasks: [{ id: "b1" }] });
  });

  it("keeps the newer copy of a query both tabs have, even when the older tab saves last", async () => {
    const a = await openTab();
    const b = await openTab();
    connections.push(a.db, b.db);

    b.client.setQueryData(
      tasksKey("p1"),
      { tasks: [{ id: "t1", title: "Old" }] },
      { updatedAt: 1_000 }
    );
    a.client.setQueryData(
      tasksKey("p1"),
      { tasks: [{ id: "t1", title: "New" }] },
      { updatedAt: 2_000 }
    );
    a.stop();
    await saved();
    b.stop();
    await saved();

    const restored = await reload();
    expect(restored.getQueryData(tasksKey("p1"))).toEqual({ tasks: [{ id: "t1", title: "New" }] });
  });
});

function client(
  queries: { key: unknown[]; updatedAt: number; data?: unknown }[],
  buster = "v1"
): PersistedClient {
  return {
    timestamp: 0,
    buster,
    clientState: {
      mutations: [],
      queries: queries.map(({ key, updatedAt, data }) => ({
        queryKey: key,
        queryHash: JSON.stringify(key),
        state: {
          data: data ?? updatedAt,
          dataUpdateCount: 1,
          dataUpdatedAt: updatedAt,
          error: null,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          status: "success",
          fetchStatus: "idle",
        },
      })),
    },
  };
}

const dataByKey = (merged: PersistedClient) =>
  Object.fromEntries(merged.clientState.queries.map((q) => [q.queryHash, q.state.data]));

describe("mergeSavedCache", () => {
  const now = 10 * OFFLINE_CACHE_MAX_AGE_MS;

  it("is this tab's cache when nothing is saved, or the saved copy is from another build or unreadable", () => {
    const incoming = client([{ key: tasksKey("p1"), updatedAt: now }]);
    expect(mergeSavedCache(undefined, incoming, now)).toBe(incoming);
    expect(
      mergeSavedCache(client([{ key: tasksKey("p2"), updatedAt: now }], "v0"), incoming, now)
    ).toBe(incoming);
    expect(mergeSavedCache({ buster: "v1" } as PersistedClient, incoming, now)).toBe(incoming);
  });

  it("keeps the newer copy of each query and the saved-only ones still within the max age", () => {
    const merged = mergeSavedCache(
      client([
        { key: tasksKey("shared"), updatedAt: now - 10, data: "saved, newer" },
        { key: tasksKey("mine-newer"), updatedAt: now - 20, data: "saved, older" },
        { key: tasksKey("other-tab"), updatedAt: now - 1_000, data: "other tab" },
        { key: tasksKey("expired"), updatedAt: now - OFFLINE_CACHE_MAX_AGE_MS, data: "too old" },
      ]),
      client([
        { key: tasksKey("shared"), updatedAt: now - 20, data: "mine, older" },
        { key: tasksKey("mine-newer"), updatedAt: now - 10, data: "mine, newer" },
      ]),
      now
    );
    expect(dataByKey(merged)).toEqual({
      [JSON.stringify(tasksKey("shared"))]: "saved, newer",
      [JSON.stringify(tasksKey("mine-newer"))]: "mine, newer",
      [JSON.stringify(tasksKey("other-tab"))]: "other tab",
    });
  });

  it("never carries forward a saved query outside the offline allowlist", () => {
    const merged = mergeSavedCache(
      client([{ key: ["workspaces", "w1", "search", "secret"], updatedAt: now }]),
      client([]),
      now
    );
    expect(merged.clientState.queries).toEqual([]);
  });
});
