import { onlineManager, type QueryClient } from "@tanstack/react-query";

import { notifyUnauthorized } from "@/web/lib/api/client";
import { requestPersistentStorage } from "@/web/lib/pwa";

import { deleteOfflineDb, type OfflineDb, openOfflineDb } from "./idb";
import { Outbox } from "./outbox";
import { startOfflinePrefetch } from "./prefetch";
import { persistQueryCache } from "./query-persister";
import { setReadBarrier } from "./read-barrier";

interface Runtime {
  userId: string;
  ready: Promise<void>;
  settled: boolean;
  db: OfflineDb | null;
  outbox: Outbox | null;
  stop: () => void;
}

let current: Runtime | null = null;
const runtimeListeners = new Set<() => void>();

export function isOnline(): boolean {
  return onlineManager.isOnline();
}

/** The signed-in account's write queue; null before sign-in, or when IndexedDB is unavailable. */
export function activeOutbox(): Outbox | null {
  return current?.outbox ?? null;
}

export function subscribeRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => void runtimeListeners.delete(listener);
}

function notifyRuntime(): void {
  for (const listener of runtimeListeners) listener();
}

async function boot(runtime: Runtime, queryClient: QueryClient): Promise<void> {
  let db: OfflineDb;
  try {
    db = await openOfflineDb(runtime.userId);
  } catch (err) {
    // Private windows and storage-disabled browsers: the app still works online, writes go direct.
    console.warn("[offline] storage unavailable; offline mode is off", err);
    return;
  }
  if (current !== runtime) {
    db.close();
    return;
  }
  runtime.db = db;
  // Offline data is only worth keeping if the browser won't evict it under storage pressure.
  void requestPersistentStorage();
  const stopPersisting = await persistQueryCache(queryClient, db, () => current === runtime);
  // Stopped while restoring (sign-out, account switch): the no-op stop already ran, so tear down
  // here, or this account's persister keeps saving the next account's cache into its database.
  if (current !== runtime) {
    stopPersisting();
    db.close();
    return;
  }

  const outbox = new Outbox({
    db,
    userId: runtime.userId,
    isOnline,
    onDrained: () => void queryClient.invalidateQueries(),
    onUnauthorized: notifyUnauthorized,
  });
  const stopOnline = onlineManager.subscribe((online) => outbox.setOnline(online));
  runtime.outbox = outbox;
  setReadBarrier(outbox.whenSettled);
  await outbox.start();
  // Keeps every visible project readable offline, not only the ones opened while connected.
  const stopPrefetch = startOfflinePrefetch({
    qc: queryClient,
    db,
    outbox,
    isCurrent: () => current === runtime,
  });

  runtime.stop = () => {
    stopPrefetch();
    stopOnline();
    stopPersisting();
    // A newer runtime that already booted has set its own barrier.
    if (!current?.outbox) setReadBarrier(null);
    outbox.stop();
    db.close();
  };
  if (current !== runtime) {
    runtime.stop();
    return;
  }
  notifyRuntime();
}

/**
 * Starts offline mode for the signed-in account: restores its saved reads into `queryClient`,
 * then starts its write queue. Resolves when the cache is restored, so the first render after
 * it reads saved data instead of a spinner. Idempotent per account; another account stops the
 * previous one and empties the in-memory cache first.
 */
export function startOfflineRuntime(userId: string, queryClient: QueryClient): Promise<void> {
  if (current?.userId === userId) return current.ready;
  if (current) {
    stopOfflineRuntime();
    queryClient.clear();
  }
  const runtime: Runtime = {
    userId,
    ready: Promise.resolve(),
    settled: false,
    db: null,
    outbox: null,
    stop: () => undefined,
  };
  current = runtime;
  runtime.ready = boot(runtime, queryClient).finally(() => {
    runtime.settled = true;
  });
  return runtime.ready;
}

/** True once this account's runtime has restored its cache (a remount renders without waiting again). */
export function isRuntimeReady(userId: string): boolean {
  return current?.userId === userId && current.settled;
}

export function stopOfflineRuntime(): void {
  const runtime = current;
  current = null;
  runtime?.stop();
  notifyRuntime();
}

/** Writes made on this device that the server hasn't accepted yet (0 when offline mode is off). */
export function pendingWriteCount(): number {
  return current?.outbox?.getStatus().pending ?? 0;
}

/**
 * Deletes everything this device holds for the account: saved reads and unsent writes. For
 * sign-out; the in-memory cache is the caller's to clear.
 */
export async function wipeOfflineData(userId: string): Promise<void> {
  if (current?.userId === userId) stopOfflineRuntime();
  await deleteOfflineDb(userId);
}
