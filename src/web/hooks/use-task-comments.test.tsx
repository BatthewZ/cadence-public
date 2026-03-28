import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentsPage } from "./use-task-comments";
import { useTaskComments } from "./use-task-comments";

// Mock the api client module following the use-file-upload.test.tsx pattern
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
const mockGet = api.get as ReturnType<typeof vi.fn>;

/**
 * Tests for the useTaskComments hook which provides cursor-based infinite
 * scrolling for task comments. This hook is shared between TaskDetailPanel
 * and TaskDetailDialog — a regression here breaks comment loading in both.
 */

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useTaskComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty comments array initially before data loads", () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useTaskComments("task-1"), {
      wrapper: createWrapper(),
    });
    expect(result.current.comments).toEqual([]);
  });

  it("flattens pages of comments into a single array", async () => {
    const page1: CommentsPage = {
      comments: [
        { id: "c1", body: "First", authorId: "u1", authorName: "Alice", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" },
        { id: "c2", body: "Second", authorId: "u1", authorName: "Alice", createdAt: "2025-01-01T01:00:00.000Z", updatedAt: "2025-01-01T01:00:00.000Z" },
      ],
      nextCursor: "2025-01-01T01:00:00.000Z",
    };

    mockGet.mockResolvedValueOnce(page1);

    const { result } = renderHook(() => useTaskComments("task-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.comments).toHaveLength(2);
    });

    expect(result.current.comments[0].id).toBe("c1");
    expect(result.current.comments[1].id).toBe("c2");
  });

  it("computes hasNextPage from nextCursor presence", async () => {
    const pageWithMore: CommentsPage = {
      comments: [
        { id: "c1", body: "First", authorId: "u1", authorName: "Alice", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" },
      ],
      nextCursor: "2025-01-01T00:00:00.000Z",
    };

    mockGet.mockResolvedValueOnce(pageWithMore);

    const { result } = renderHook(() => useTaskComments("task-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.comments).toHaveLength(1);
    });

    expect(result.current.hasNextPage).toBe(true);
  });

  it("returns hasNextPage false when nextCursor is null (end of data)", async () => {
    const lastPage: CommentsPage = {
      comments: [
        { id: "c1", body: "Only one", authorId: "u1", authorName: "Alice", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" },
      ],
      nextCursor: null,
    };

    mockGet.mockResolvedValueOnce(lastPage);

    const { result } = renderHook(() => useTaskComments("task-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.comments).toHaveLength(1);
    });

    expect(result.current.hasNextPage).toBe(false);
  });

  it("loads multiple pages when fetchNextPage is called", async () => {
    const page1: CommentsPage = {
      comments: [
        { id: "c1", body: "Page 1", authorId: "u1", authorName: "Alice", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" },
      ],
      nextCursor: "2025-01-01T00:00:00.000Z",
    };
    const page2: CommentsPage = {
      comments: [
        { id: "c2", body: "Page 2", authorId: "u1", authorName: "Alice", createdAt: "2025-01-02T00:00:00.000Z", updatedAt: "2025-01-02T00:00:00.000Z" },
      ],
      nextCursor: null,
    };

    mockGet.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const { result } = renderHook(() => useTaskComments("task-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.comments).toHaveLength(1);
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.comments).toHaveLength(2);
    });

    expect(result.current.comments[0].id).toBe("c1");
    expect(result.current.comments[1].id).toBe("c2");
    expect(result.current.hasNextPage).toBe(false);
  });
});
