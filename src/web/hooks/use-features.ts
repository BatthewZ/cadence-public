import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/web/lib/api/client";

/**
 * Shape of the `/api/config.features` response. Centralised here so any
 * component that reads feature flags stays in sync with the server contract.
 */
export interface Features {
  /** Whether the Unsplash integration is configured and available. */
  unsplash: boolean;
}

interface ConfigResponse {
  features: Features;
}

/**
 * Fetches server-side feature flags via `/api/config`.
 *
 * The response is public (no auth) and cached aggressively — features rarely
 * change at runtime, so a 5-minute stale window keeps the picker / gating code
 * responsive without hammering the endpoint. We also disable refetch-on-focus
 * since the flag set is effectively static for the session.
 *
 * Errors are tolerated: one retry, then callers can fall back to
 * "feature disabled" by treating `data` as `undefined` → flags default off.
 */
export function useFeatures(): UseQueryResult<Features, Error> {
  return useQuery<Features, Error>({
    queryKey: ["config", "features"],
    queryFn: async () => {
      const res = await api.get<ConfigResponse>("/api/config");
      return res.features;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
