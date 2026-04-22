import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type {
  UnsplashCoverPayload,
  UnsplashSearchResponse,
} from "@/shared/schemas/unsplash";
import { useDebounce } from "@/web/hooks/use-debounce";
import { api } from "@/web/lib/api/client";

/** Fixed page size for the picker grid; matches the backend `perPage` cap. */
const PER_PAGE = 24;

/** Debounce window for the raw search input (milliseconds). */
const SEARCH_DEBOUNCE_MS = 300;

/** Orientation filter passed through to the Unsplash search endpoint. */
export type UnsplashOrientation = "landscape" | "portrait" | "squarish";

export interface UseUnsplashSearchOptions {
  /**
   * The user's raw search input. Debounced internally — callers can bind it
   * directly to an input value without pre-debouncing. An empty / whitespace
   * string falls back to the curated feed.
   */
  query: string;
  /**
   * Optional orientation filter. Only applies when a search query is present;
   * the curated endpoint does not support orientation.
   */
  orientation?: UnsplashOrientation;
  /**
   * Whether the query should run. Typically tied to picker open state so the
   * initial request doesn't fire for every mounted task card.
   */
  enabled?: boolean;
}

export interface UseUnsplashSearchResult {
  /** Flattened list of results across every loaded page. */
  results: UnsplashCoverPayload[];
  /** The debounced, trimmed query — useful for rendering "Results for X". */
  debouncedQuery: string;
  /** True when the curated feed is active (no effective query). */
  isCurated: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refetch: () => void;
  totalPages: number;
  total: number;
}

/**
 * Infinite-query wrapper for the Unsplash picker.
 *
 * Transparently switches between the curated and search endpoints based on
 * whether a debounced query is present. The query key embeds the effective
 * mode (`curated` | `search`), the query string, and the orientation so that
 * switching modes reuses cached pages where possible and isolates them where
 * it must (e.g. changing orientation must refetch).
 *
 * Why retry is disabled: the Unsplash endpoints return 503 when the
 * integration isn't configured, and 429 under rate-limit pressure. Retrying
 * in either case wastes quota and muddies the error UX — callers surface the
 * error directly instead.
 */
export function useUnsplashSearch({
  query,
  orientation,
  enabled = true,
}: UseUnsplashSearchOptions): UseUnsplashSearchResult {
  const debouncedQuery = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS);
  const isSearch = debouncedQuery.length > 0;

  const result = useInfiniteQuery<
    UnsplashSearchResponse,
    Error,
    { pages: UnsplashSearchResponse[]; pageParams: number[] },
    readonly (string | null)[],
    number
  >({
    queryKey: [
      "unsplash",
      isSearch ? "search" : "curated",
      debouncedQuery,
      orientation ?? null,
    ] as const,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        page: String(pageParam),
        perPage: String(PER_PAGE),
      });
      if (isSearch) {
        params.set("query", debouncedQuery);
        if (orientation) params.set("orientation", orientation);
        return api.get<UnsplashSearchResponse>(
          `/api/unsplash/search?${params.toString()}`,
        );
      }
      return api.get<UnsplashSearchResponse>(
        `/api/unsplash/curated?${params.toString()}`,
      );
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled,
    // Keep recent queries warm to avoid refetching on rapid open/close of the
    // picker; Unsplash imposes per-minute rate limits so caching matters.
    staleTime: 60_000,
    // Don't retry: 503 (unconfigured) and 429 (rate limited) should surface
    // immediately rather than burn further quota.
    retry: 0,
  });

  const results = useMemo<UnsplashCoverPayload[]>(
    () => result.data?.pages.flatMap((p) => p.results) ?? [],
    [result.data],
  );

  return {
    results,
    debouncedQuery,
    isCurated: !isSearch,
    isLoading: result.isLoading,
    isError: result.isError,
    error: result.error ?? null,
    fetchNextPage: () => {
      void result.fetchNextPage();
    },
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    refetch: () => {
      void result.refetch();
    },
    totalPages: result.data?.pages[0]?.totalPages ?? 0,
    total: result.data?.pages[0]?.total ?? 0,
  };
}
