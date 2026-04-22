import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnsplashSearchResponse } from "@/shared/schemas/unsplash";

// Mock the api client module.
vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

import { api } from "@/web/lib/api/client";

import { useUnsplashSearch } from "./use-unsplash-search";

const mockGet = api.get as ReturnType<typeof vi.fn>;

/**
 * Tests for `useUnsplashSearch` — the infinite-query picker wrapper that
 * switches between curated and search endpoints, debounces user input, and
 * threads orientation through to the search endpoint only. These tests are
 * the single source of correctness for that routing logic; a regression
 * here silently breaks every Unsplash picker in the app.
 *
 * Uses real timers (not fake) because `waitFor` depends on wall-clock
 * scheduling and mixing fake timers with React Query's internal scheduler
 * produces spurious timeouts.
 */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function makePage(
  overrides: Partial<UnsplashSearchResponse> = {},
): UnsplashSearchResponse {
  return {
    page: 1,
    perPage: 24,
    total: 0,
    totalPages: 1,
    results: [],
    ...overrides,
  };
}

describe("useUnsplashSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits the curated endpoint when no query is provided", async () => {
    mockGet.mockResolvedValue(makePage());

    const { result } = renderHook(() => useUnsplashSearch({ query: "" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    const url = mockGet.mock.calls[0][0] as string;
    expect(url.startsWith("/api/unsplash/curated")).toBe(true);
    expect(url).toContain("page=1");
    expect(url).toContain("perPage=24");
    expect(result.current.isCurated).toBe(true);
  });

  it("routes to the search endpoint once a query is present", async () => {
    mockGet.mockResolvedValue(makePage());

    const { result } = renderHook(
      () => useUnsplashSearch({ query: "mountains" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });

    const url = mockGet.mock.calls.at(-1)?.[0] as string;
    expect(url.startsWith("/api/unsplash/search")).toBe(true);
    expect(url).toContain("query=mountains");
    expect(result.current.isCurated).toBe(false);
    expect(result.current.debouncedQuery).toBe("mountains");
  });

  it("debounces rapid query changes so only the final value fires a request", async () => {
    mockGet.mockResolvedValue(makePage());

    // Seed with a distinct initial query so we can track how many times the
    // *resolved* query fetches — the initial "seed" debounced value is the
    // literal seed (useState is initialized synchronously), so we assert on
    // the final URL after changes settle.
    const { rerender } = renderHook(
      ({ query }: { query: string }) => useUnsplashSearch({ query }),
      { wrapper: createWrapper(), initialProps: { query: "initial" } },
    );

    // Rapidly change the input multiple times within the 300ms debounce
    // window. Only the final value should drive the fetch — earlier
    // intermediate queries must be dropped.
    rerender({ query: "a" });
    rerender({ query: "ab" });
    rerender({ query: "abc" });
    rerender({ query: "abcd" });

    await waitFor(
      () => {
        const urls = mockGet.mock.calls.map((c) => c[0] as string);
        expect(urls.some((u) => u.includes("query=abcd"))).toBe(true);
      },
      { timeout: 2000 },
    );

    // None of the intermediate values should have been requested.
    const urls = mockGet.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => /query=a($|&)/.test(u))).toBe(false);
    expect(urls.some((u) => /query=ab($|&)/.test(u))).toBe(false);
    expect(urls.some((u) => /query=abc($|&)/.test(u))).toBe(false);
  });

  it("passes orientation through on search queries only", async () => {
    mockGet.mockResolvedValue(makePage());

    const { rerender } = renderHook(
      ({
        query,
        orientation,
      }: {
        query: string;
        orientation?: "landscape" | "portrait" | "squarish";
      }) => useUnsplashSearch({ query, orientation }),
      {
        wrapper: createWrapper(),
        initialProps: {
          query: "forest",
          orientation: "landscape" as const,
        },
      },
    );

    await waitFor(() => {
      const url = mockGet.mock.calls.at(-1)?.[0] as string | undefined;
      expect(url?.startsWith("/api/unsplash/search")).toBe(true);
      expect(url).toContain("orientation=landscape");
    });

    // Clearing the query should fall back to curated, which does NOT accept
    // orientation — the hook must not forward it.
    mockGet.mockClear();
    rerender({ query: "", orientation: "landscape" as const });

    await waitFor(() => {
      const url = mockGet.mock.calls.at(-1)?.[0] as string | undefined;
      expect(url?.startsWith("/api/unsplash/curated")).toBe(true);
      expect(url).not.toContain("orientation");
    });
  });

  it("does not fire requests when disabled", async () => {
    mockGet.mockResolvedValue(makePage());

    renderHook(
      () => useUnsplashSearch({ query: "anything", enabled: false }),
      { wrapper: createWrapper() },
    );

    // Give any pending debounce / query scheduling a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockGet).not.toHaveBeenCalled();
  });
});
