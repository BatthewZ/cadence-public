import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the api client module following the established pattern.
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

import { useFeatures } from "./use-features";

const mockGet = api.get as ReturnType<typeof vi.fn>;

/**
 * Tests for `useFeatures` — the hook that surfaces server-side feature flags
 * (currently `unsplash`) so UI can gate Unsplash integration UX. A regression
 * here breaks the picker visibility everywhere, hence the smoke coverage.
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

describe("useFeatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches /api/config and exposes the features object", async () => {
    mockGet.mockResolvedValueOnce({ features: { unsplash: true } });

    const { result } = renderHook(() => useFeatures(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/api/config");
    expect(result.current.data).toEqual({ unsplash: true });
  });

  it("surfaces disabled flags when the server reports them off", async () => {
    mockGet.mockResolvedValueOnce({ features: { unsplash: false } });

    const { result } = renderHook(() => useFeatures(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ unsplash: false });
  });
});
