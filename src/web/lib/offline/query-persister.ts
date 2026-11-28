import type { QueryClient } from "@tanstack/react-query";
import {
  type PersistedClient,
  type Persister,
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/react-query-persist-client";

import { KV_STORE, type OfflineDb } from "./idb";
import { isOfflineQueryKey } from "./persisted-queries";

const CACHE_KEY = "query-cache";
/** Older than this, a saved cache is dropped rather than shown. */
export const OFFLINE_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SAVE_THROTTLE_MS = 1_000;

/**
 * A new build may read responses differently, so a cache saved by another version is discarded
 * (the write queue is not: it holds REST requests, which the API keeps compatible).
 */
const BUSTER = __APP_VERSION__;

/**
 * Merges this tab's cache into the saved one rather than replacing it. Every open tab saves to the
 * same record, and each holds only the data it has loaded, so a plain overwrite would leave only
 * the last tab's projects available offline. Per query, the copy with the newer `dataUpdatedAt`
 * wins (an optimistic edit counts as an update). Queries only the saved copy has are kept until
 * they are older than the cache's max age. A saved copy from another build is dropped.
 */
export function mergeSavedCache(
  saved: PersistedClient | undefined,
  incoming: PersistedClient,
  now: number = Date.now()
): PersistedClient {
  const savedQueries = saved?.buster === incoming.buster ? saved.clientState?.queries : undefined;
  if (!Array.isArray(savedQueries)) return incoming;
  const byHash = new Map(incoming.clientState.queries.map((query) => [query.queryHash, query]));
  for (const query of savedQueries) {
    if (!isOfflineQueryKey(query.queryKey)) continue;
    const mine = byHash.get(query.queryHash);
    const keep = mine
      ? query.state.dataUpdatedAt > mine.state.dataUpdatedAt
      : now - query.state.dataUpdatedAt < OFFLINE_CACHE_MAX_AGE_MS;
    if (keep) byHash.set(query.queryHash, query);
  }
  return { ...incoming, clientState: { ...incoming.clientState, queries: [...byHash.values()] } };
}

/** Saves at most once a second (the cache changes on every keystroke-driven optimistic write), and on page hide. */
function idbPersister(db: OfflineDb): Persister & { flush: () => Promise<void> } {
  let pending: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const client = pending;
    pending = null;
    if (client)
      await db.update<PersistedClient>(KV_STORE, CACHE_KEY, (saved) =>
        mergeSavedCache(saved, client)
      );
  };

  return {
    persistClient: (client) => {
      pending = client;
      timer ??= setTimeout(() => void flush().catch(() => undefined), SAVE_THROTTLE_MS);
    },
    restoreClient: () => db.get<PersistedClient>(KV_STORE, CACHE_KEY),
    removeClient: () => db.delete(KV_STORE, CACHE_KEY),
    flush,
  };
}

/**
 * Puts the saved cache back into `queryClient`, then keeps saving it. Returns the unsubscribe.
 * A failed restore (corrupt or unreadable data) starts from an empty cache rather than failing the app.
 * `isCurrent` is checked once the saved cache is read: false (the account changed while reading)
 * skips hydrating, so one account's saved reads never land in the next account's cache.
 */
export async function persistQueryCache(
  queryClient: QueryClient,
  db: OfflineDb,
  isCurrent: () => boolean = () => true
): Promise<() => void> {
  const persister = idbPersister(db);
  try {
    await persistQueryClientRestore({
      queryClient,
      persister: {
        ...persister,
        restoreClient: async () => {
          const saved = await persister.restoreClient();
          return isCurrent() ? saved : undefined;
        },
      },
      maxAge: OFFLINE_CACHE_MAX_AGE_MS,
      buster: BUSTER,
    });
  } catch {
    await persister.removeClient();
  }
  const unsubscribe = persistQueryClientSubscribe({
    queryClient,
    persister,
    buster: BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === "success" && isOfflineQueryKey(query.queryKey),
      shouldDehydrateMutation: () => false,
    },
  });
  const flushNow = () => void persister.flush().catch(() => undefined);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flushNow();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flushNow);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flushNow);
    flushNow();
  };
}
