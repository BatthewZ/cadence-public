import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedView } from "@/shared/schemas/saved-view";
import { sendWrite, type WriteResult } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";

import type { SavedViewsData } from "./use-saved-views";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "./use-saved-views";

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
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

vi.mock("@/web/lib/offline/send-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/web/lib/offline/send-write")>();
  return { ...actual, sendWrite: vi.fn(actual.sendWrite) };
});

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

import { api } from "@/web/lib/api/client";
const mockSendWrite = vi.mocked(sendWrite);
const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;
const mockPatch = api.patch as ReturnType<typeof vi.fn>;
const mockDelete = api.delete as ReturnType<typeof vi.fn>;

/**
 * Tests for the saved-views data hooks. The UI consumer (ViewSwitcher) lands
 * in the NEXT wave of the Saved Views plan, so this suite is the only thing
 * pinning the hooks' contract in this wave — it locks down:
 *
 * - the cache key/URL pairing (a mismatch would strand data where no
 *   invalidation can reach it),
 * - that create inserts optimistically under the caller's client id (the id
 *   callers write into `?view=<id>` URLs), and undoes that only on refusal,
 * - the optimistic update/delete + rollback + settled-invalidation shape
 *   (mirroring use-labels.ts, minus task fan-out and freshness tracking —
 *   saved views are private per-user data touching no task caches), and that
 *   a queued write keeps its optimistic state without a refetch.
 */

const PROJECT_ID = "proj-1";
const LIST_KEY = queryKeys.projects.savedViews(PROJECT_ID);

function makeView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: "view-1",
    projectId: PROJECT_ID,
    creatorId: "user-1",
    name: "My bugs",
    state: { tab: "board", params: { assignee: "me", priority: "urgent" } },
    position: "a0",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function createClientAndWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // gcTime must be Infinity here (unlike hook tests that only ever read
      // through an active useQuery observer): the mutation tests seed the
      // list cache with setQueryData and have NO observer on it, so the
      // default/zero gcTime would garbage-collect the seeded entry before the
      // optimistic write or rollback could be asserted.
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

function getCachedViews(queryClient: QueryClient): SavedViewsData | undefined {
  return queryClient.getQueryData<SavedViewsData>(LIST_KEY);
}

describe("useSavedViews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the list from the views endpoint and stores it under the savedViews key", async () => {
    const data: SavedViewsData = { views: [makeView()] };
    mockGet.mockResolvedValueOnce(data);
    const { queryClient, Wrapper } = createClientAndWrapper();

    const { result } = renderHook(() => useSavedViews(PROJECT_ID), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(data);
    });

    expect(mockGet).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/views`);
    // The data must live under the registry key — a drift between queryKey
    // and the key mutations edit/invalidate would silently break optimism.
    expect(getCachedViews(queryClient)).toEqual(data);
  });

  it("defers fetching when enabled is false", () => {
    const { Wrapper } = createClientAndWrapper();

    renderHook(() => useSavedViews(PROJECT_ID, { enabled: false }), {
      wrapper: Wrapper,
    });

    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useCreateSavedView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const NEW_ID = "00000000-0000-4000-8000-000000000001";
  const input = {
    id: NEW_ID,
    name: "New view",
    state: { tab: "board", params: { assignee: "me" } },
  };

  it("posts the input body, client id included, and resolves with the sent result", async () => {
    const created = makeView({ id: NEW_ID, name: "New view" });
    mockPost.mockResolvedValueOnce({ view: created });
    const { Wrapper } = createClientAndWrapper();

    const { result } = renderHook(() => useCreateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    let response: WriteResult<{ view: SavedView }> | undefined;
    await act(async () => {
      response = await result.current.mutateAsync(input);
    });

    expect(mockPost).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/views`, input);
    expect(response).toEqual({ status: "sent", data: { view: created } });
  });

  it("appends the view under its client id while the request is in flight, then takes the server copy", async () => {
    const existing: SavedViewsData = { views: [makeView()] };
    let resolvePost!: (value: { view: SavedView }) => void;
    mockPost.mockReturnValueOnce(
      new Promise<{ view: SavedView }>((resolve) => {
        resolvePost = resolve;
      }),
    );
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, existing);

    const { result } = renderHook(() => useCreateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate(input);
    });

    await waitFor(() => {
      expect(getCachedViews(queryClient)?.views.map((v) => v.id)).toEqual(["view-1", NEW_ID]);
    });
    const optimistic = getCachedViews(queryClient)?.views[1];
    expect(optimistic).toMatchObject({ name: "New view", creatorId: "user-1", state: input.state });
    // Appended after the last view, as the server does.
    expect(optimistic && optimistic.position > "a0").toBe(true);

    const serverRow = makeView({ id: NEW_ID, name: "New view", position: "a1" });
    await act(async () => {
      resolvePost({ view: serverRow });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(getCachedViews(queryClient)?.views[1]).toEqual(serverRow);
  });

  it("removes the optimistic view when the server refuses", async () => {
    const existing: SavedViewsData = { views: [makeView()] };
    mockPost.mockRejectedValueOnce(new Error("409 duplicate name"));
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, existing);

    const { result } = renderHook(() => useCreateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate(input);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(getCachedViews(queryClient)).toEqual(existing);
  });

  it("invalidates the saved-views list on success", async () => {
    mockPost.mockResolvedValueOnce({ view: makeView({ id: NEW_ID }) });
    const { queryClient, Wrapper } = createClientAndWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LIST_KEY });
  });

  it("keeps the optimistic view and skips the refetch when the write is queued", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, { views: [makeView()] });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(getCachedViews(queryClient)?.views.map((v) => v.id)).toEqual(["view-1", NEW_ID]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useUpdateSavedView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const viewA = makeView({ id: "view-a", name: "Alpha" });
  const viewB = makeView({ id: "view-b", name: "Beta" });
  const seeded: SavedViewsData = { views: [viewA, viewB] };

  it("patches the view endpoint with only the changed fields", async () => {
    mockPatch.mockResolvedValueOnce({ view: { ...viewA, name: "Renamed" } });
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);

    const { result } = renderHook(() => useUpdateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ viewId: "view-a", name: "Renamed" });
    });

    // viewId must be peeled off the body — the server schema rejects unknown
    // keys, and the id belongs in the path.
    expect(mockPatch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/views/view-a`,
      { name: "Renamed" },
    );
  });

  it("applies the change to the cached list immediately (optimistic)", async () => {
    let resolvePatch!: (value: { view: SavedView }) => void;
    mockPatch.mockReturnValueOnce(
      new Promise<{ view: SavedView }>((resolve) => {
        resolvePatch = resolve;
      }),
    );
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);

    const { result } = renderHook(() => useUpdateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate({ viewId: "view-a", name: "Renamed" });
    });

    // The optimistic write happens in onMutate, before the request settles.
    await waitFor(() => {
      expect(getCachedViews(queryClient)?.views.map((v) => v.name)).toEqual([
        "Renamed",
        "Beta",
      ]);
    });
    // Untouched views keep their identity — only the target row is replaced.
    expect(getCachedViews(queryClient)?.views[1]).toBe(viewB);

    await act(async () => {
      resolvePatch({ view: { ...viewA, name: "Renamed" } });
      // Yield so the promise's resolution handlers run inside act.
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it("rolls the cache back to the pre-mutation snapshot on error", async () => {
    mockPatch.mockRejectedValueOnce(new Error("409 duplicate name"));
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);

    const { result } = renderHook(() => useUpdateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate({ viewId: "view-a", name: "Beta" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    // Rollback restores the exact snapshot taken in onMutate.
    expect(getCachedViews(queryClient)).toEqual(seeded);
  });

  it("invalidates the saved-views list on settle (success and error)", async () => {
    mockPatch
      .mockResolvedValueOnce({ view: { ...viewA, name: "Renamed" } })
      .mockRejectedValueOnce(new Error("boom"));
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ viewId: "view-a", name: "Renamed" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LIST_KEY });

    invalidateSpy.mockClear();
    act(() => {
      result.current.mutate({ viewId: "view-a", name: "Nope" });
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    // onSettled fires after the onError rollback, so the server re-sync
    // happens even when the optimistic write was reverted.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LIST_KEY });
  });
});

describe("useDeleteSavedView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const viewA = makeView({ id: "view-a", name: "Alpha" });
  const viewB = makeView({ id: "view-b", name: "Beta" });
  const seeded: SavedViewsData = { views: [viewA, viewB] };

  it("calls the delete endpoint for the given view id", async () => {
    mockDelete.mockResolvedValueOnce({ ok: true, deletedId: "view-a" });
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);

    const { result } = renderHook(() => useDeleteSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync("view-a");
    });

    expect(mockDelete).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/views/view-a`);
  });

  it("removes the view from the cached list immediately (optimistic)", async () => {
    let resolveDelete!: (value: { ok: true; deletedId: string }) => void;
    mockDelete.mockReturnValueOnce(
      new Promise<{ ok: true; deletedId: string }>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);

    const { result } = renderHook(() => useDeleteSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate("view-a");
    });

    await waitFor(() => {
      expect(getCachedViews(queryClient)?.views).toEqual([viewB]);
    });

    await act(async () => {
      resolveDelete({ ok: true, deletedId: "view-a" });
      // Yield so the promise's resolution handlers run inside act.
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it("restores the removed view on error", async () => {
    mockDelete.mockRejectedValueOnce(new Error("500"));
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);

    const { result } = renderHook(() => useDeleteSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate("view-a");
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(getCachedViews(queryClient)).toEqual(seeded);
  });

  it("invalidates the saved-views list on settle", async () => {
    mockDelete.mockResolvedValueOnce({ ok: true, deletedId: "view-a" });
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteSavedView(PROJECT_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync("view-a");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LIST_KEY });
  });
});

describe("queued update and delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const viewA = makeView({ id: "view-a", name: "Alpha" });
  const viewB = makeView({ id: "view-b", name: "Beta" });
  const seeded: SavedViewsData = { views: [viewA, viewB] };

  it("keeps a queued rename in the cache without refetching", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateSavedView(PROJECT_ID), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ viewId: "view-a", name: "Renamed" });
    });

    expect(getCachedViews(queryClient)?.views.map((v) => v.name)).toEqual(["Renamed", "Beta"]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("names a delete by the view before it leaves the cache, and keeps it removed when queued", async () => {
    mockSendWrite.mockResolvedValueOnce({ status: "queued" });
    const { queryClient, Wrapper } = createClientAndWrapper();
    queryClient.setQueryData(LIST_KEY, seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteSavedView(PROJECT_ID), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync("view-a");
    });

    expect(mockSendWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", label: "Delete view “Alpha”" }),
    );
    expect(getCachedViews(queryClient)?.views).toEqual([viewB]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
