/**
 * The offline runtime's account-switch guards. `boot()` awaits IndexedDB twice (cache restore,
 * queue start); a sign-out or account switch can land in either gap, and the superseded boot
 * must then tear itself down instead of attaching to the newer account's session:
 *
 * - its persister must stop, or it keeps saving the next account's cache into its database;
 * - it must never become the active outbox;
 * - its teardown must not clear the read barrier a newer runtime already set.
 *
 * Only the timing is controlled here (a gate on the two awaits); IndexedDB, the persister and the
 * queue are real.
 */
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const gates = vi.hoisted(() => ({
  /** Held before the next `persistQueryCache` call runs, then cleared. */
  persist: null as Promise<void> | null,
  /** Each persister's returned stop, in boot order. */
  stops: [] as Array<() => void>,
  /** Every value passed to `setReadBarrier`, in order. */
  barriers: [] as unknown[],
}));

vi.mock("./query-persister", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query-persister")>();
  return {
    ...actual,
    persistQueryCache: async (...args: Parameters<typeof actual.persistQueryCache>) => {
      const hold = gates.persist;
      gates.persist = null;
      if (hold) await hold;
      const stop = vi.fn(await actual.persistQueryCache(...args));
      gates.stops.push(stop);
      return stop;
    },
  };
});

vi.mock("./read-barrier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./read-barrier")>();
  return {
    ...actual,
    setReadBarrier: (next: Parameters<typeof actual.setReadBarrier>[0]) => {
      gates.barriers.push(next);
      actual.setReadBarrier(next);
    },
  };
});

import { Outbox } from "./outbox";
import { activeOutbox, startOfflineRuntime, stopOfflineRuntime } from "./runtime";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const lastBarrier = () => gates.barriers.at(-1);

let queryClient: QueryClient;
let start: MockInstance<Outbox["start"]>;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
  );
  gates.persist = null;
  gates.stops = [];
  gates.barriers = [];
  queryClient = new QueryClient();
  start = vi.spyOn(Outbox.prototype, "start");
});

afterEach(() => {
  stopOfflineRuntime();
  start.mockRestore();
  vi.unstubAllGlobals();
});

describe("startOfflineRuntime — a boot superseded mid-flight", () => {
  it("switching account during the cache restore stops the old persister and never starts its queue", async () => {
    const restore = deferred();
    gates.persist = restore.promise;
    const first = startOfflineRuntime("u1", queryClient);
    await vi.waitFor(() => expect(gates.persist).toBeNull());

    await startOfflineRuntime("u2", queryClient);
    restore.resolve();
    await first;

    expect(gates.stops).toHaveLength(2);
    const [u2Persister, u1Persister] = gates.stops;
    expect(u1Persister).toHaveBeenCalledTimes(1);
    expect(u2Persister).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.contexts[0]).toBe(activeOutbox());
    expect(lastBarrier()).toBe(activeOutbox()!.whenSettled);
  });

  it("does not hydrate the old account's saved reads into the new account's cache", async () => {
    await startOfflineRuntime("u1", queryClient);
    queryClient.setQueryData(["projects", "p1", "tasks"], { tasks: [{ id: "u1-secret" }] });
    stopOfflineRuntime();
    await new Promise((r) => setTimeout(r, 20));
    queryClient.clear();

    const restore = deferred();
    gates.persist = restore.promise;
    const first = startOfflineRuntime("u1", queryClient);
    await vi.waitFor(() => expect(gates.persist).toBeNull());
    await startOfflineRuntime("u2", queryClient);
    restore.resolve();
    await first;

    expect(queryClient.getQueryData(["projects", "p1", "tasks"])).toBeUndefined();
  });

  it("switching account during the queue start keeps the new account's read barrier", async () => {
    const queueStart = deferred();
    start.mockImplementationOnce(() => queueStart.promise);
    const first = startOfflineRuntime("u1", queryClient);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const u1Outbox = start.mock.contexts[0];

    await startOfflineRuntime("u2", queryClient);
    const u2Outbox = activeOutbox()!;
    expect(u2Outbox).not.toBe(u1Outbox);
    expect(lastBarrier()).toBe(u2Outbox.whenSettled);

    queueStart.resolve();
    await first;

    expect(activeOutbox()).toBe(u2Outbox);
    expect(lastBarrier()).toBe(u2Outbox.whenSettled);
    expect(gates.stops[0]).toHaveBeenCalledTimes(1);
  });

  it("signing out during the queue start clears the barrier the old boot set", async () => {
    const queueStart = deferred();
    start.mockImplementationOnce(() => queueStart.promise);
    const first = startOfflineRuntime("u1", queryClient);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const u1Outbox = start.mock.contexts[0] as Outbox;
    expect(lastBarrier()).toBe(u1Outbox.whenSettled);

    stopOfflineRuntime();
    queueStart.resolve();
    await first;

    expect(activeOutbox()).toBeNull();
    expect(lastBarrier()).toBeNull();
    expect(gates.stops[0]).toHaveBeenCalledTimes(1);
  });
});
