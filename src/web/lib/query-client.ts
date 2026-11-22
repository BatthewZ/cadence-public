import { onlineManager, QueryClient } from "@tanstack/react-query";

import { OfflineError } from "./api/client";
import { OFFLINE_QUERY_ROOTS } from "./offline/persisted-queries";
import { OFFLINE_CACHE_MAX_AGE_MS } from "./offline/query-persister";

// onlineManager assumes "online" until the first online/offline event; a page opened offline must start paused.
if (typeof navigator !== "undefined") onlineManager.setOnline(navigator.onLine);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => !(error instanceof OfflineError) && failureCount < 1,
      retryDelay: 1_000,
      refetchOnWindowFocus: false,
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: false,
      // Not "online" (the default): that pauses a mutation offline and fires it whenever the
      // connection returns. Offline-capable writes queue through sendWrite; the rest fail now.
      networkMode: "always",
    },
  },
});

// Saved for offline use: a restored entry with no observer must outlive the default 5 minutes,
// or it is dropped from memory and then from the saved copy.
for (const root of OFFLINE_QUERY_ROOTS) {
  queryClient.setQueryDefaults([root], { gcTime: OFFLINE_CACHE_MAX_AGE_MS });
}
