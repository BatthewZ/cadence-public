/**
 * Data hooks for per-user Saved Views — bookmarked snapshots of a project's
 * task-board tab + filter URL params (see `@/shared/schemas/saved-view`).
 *
 * CONSUMER NOTE: the UI consumer (the ViewSwitcher) lands in the next wave of
 * the Saved Views plan. These hooks ship ahead of it, with their behavior
 * pinned by `use-saved-views.test.tsx`, so the cache contract is fixed before
 * the UI is built — the tests, not a consumer, are what keep this file honest
 * in this wave.
 *
 * The mutation shapes mirror `use-labels.ts` (the established optimistic
 * template, written through `sendWrite` so they also work offline) with two
 * deliberate divergences — these are not omissions:
 *
 * - NO task-cache fan-out. Label data is embedded in task payloads, so label
 *   mutations must also patch the project task list and task detail caches.
 *   Saved views reference no task data; the only cache they touch is their
 *   own list under `queryKeys.projects.savedViews(projectId)`.
 *
 * - NO `freshnessTracker` calls. The freshness banner tracks SHARED project
 *   data that collaborators can change underneath you. Saved views are
 *   private per-user-per-project, so cross-client staleness signaling is
 *   meaningless for them — recording these mutations would only produce
 *   spurious "data changed" prompts for data nobody else can see.
 */
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import type {
  CreateSavedViewInput,
  SavedView,
  UpdateSavedViewInput,
} from "@/shared/schemas/saved-view";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { sendWrite, type WriteResult } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";

/** Response envelope of `GET /api/projects/:projectId/views` (position-ordered). */
export interface SavedViewsData {
  views: SavedView[];
}

/**
 * Lists the current user's saved views for a project, ordered by position.
 *
 * `enabled` is forwarded (same as `useLabels`) so list consumers that render
 * lazily — e.g. a closed ViewSwitcher dropdown — can defer the fetch.
 */
export function useSavedViews(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.projects.savedViews(projectId),
    queryFn: () => api.get<SavedViewsData>(`/api/projects/${projectId}/views`),
    enabled: options?.enabled,
  });
}

function viewName(qc: QueryClient, projectId: string, viewId: string): string {
  const view = qc
    .getQueryData<SavedViewsData>(queryKeys.projects.savedViews(projectId))
    ?.views.find((v) => v.id === viewId);
  return view ? `“${view.name}”` : "a view";
}

/** A queued write's reply comes with the refresh after the queue drains, so it skips this one. */
function invalidateViews(
  qc: QueryClient,
  projectId: string,
  result: WriteResult<unknown> | undefined
) {
  if (result?.status === "queued") return;
  void qc.invalidateQueries({ queryKey: queryKeys.projects.savedViews(projectId) });
}

/**
 * Creates a saved view under the caller's client `id`, so the caller can write
 * `?view=<id>` into the URL at once — online or offline. Optimistic: the row
 * is appended (the server also appends), replaced by the server's copy when
 * sent, and removed again if the server refuses (e.g. 409 duplicate name).
 */
export function useCreateSavedView(projectId: string) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const listKey = queryKeys.projects.savedViews(projectId);

  return useMutation({
    networkMode: "always",
    mutationFn: (input: CreateSavedViewInput & { id: string }) =>
      sendWrite<{ view: SavedView }>({
        method: "POST",
        path: `/api/projects/${projectId}/views`,
        body: input,
        label: `Save view “${input.name}”`,
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<SavedViewsData>(listKey);
      qc.setQueryData<SavedViewsData>(listKey, (old) => {
        if (!old) return old;
        const now = new Date().toISOString();
        const optimistic: SavedView = {
          id: input.id,
          projectId,
          creatorId: session?.user.id ?? "",
          name: input.name.trim(),
          state: input.state,
          position: generateKeyBetween(old.views.at(-1)?.position ?? null, null),
          createdAt: now,
          updatedAt: now,
        };
        return { views: [...old.views, optimistic] };
      });
      return { prev };
    },
    onSuccess: (result) => {
      if (result.status !== "sent") return;
      const { view } = result.data;
      qc.setQueryData<SavedViewsData>(listKey, (old) =>
        old ? { views: old.views.map((v) => (v.id === view.id ? view : v)) } : old
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
    },
    onSettled: (result) => invalidateViews(qc, projectId, result),
  });
}

/**
 * Renames a saved view and/or overwrites its state snapshot.
 *
 * Optimistic (mirrors `useUpdateLabel`): the list cache is patched in
 * `onMutate` so the ViewSwitcher reflects the edit instantly, the snapshot is
 * restored in `onError` (e.g. 409 duplicate name), and `onSettled` re-syncs
 * with the server unless the write was queued — including after the success
 * path, where the server may have normalized fields (trimmed name, bumped
 * `updatedAt`).
 */
export function useUpdateSavedView(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    networkMode: "always",
    mutationFn: ({ viewId, ...input }: UpdateSavedViewInput & { viewId: string }) =>
      sendWrite<{ view: SavedView }>({
        method: "PATCH",
        path: `/api/projects/${projectId}/views/${viewId}`,
        body: input,
        // Runs after onMutate has applied the new name, so a rename is named by it.
        label: input.name
          ? `Rename view to “${input.name}”`
          : `Update view ${viewName(qc, projectId, viewId)}`,
      }),
    onMutate: async ({ viewId, ...input }) => {
      await qc.cancelQueries({ queryKey: queryKeys.projects.savedViews(projectId) });

      const prev = qc.getQueryData<SavedViewsData>(queryKeys.projects.savedViews(projectId));

      qc.setQueryData<SavedViewsData>(queryKeys.projects.savedViews(projectId), (old) => {
        if (!old) return old;
        return {
          views: old.views.map((v) => (v.id === viewId ? { ...v, ...input } : v)),
        };
      });

      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.projects.savedViews(projectId), ctx.prev);
      }
    },
    onSettled: (result) => invalidateViews(qc, projectId, result),
  });
}

/**
 * Deletes a saved view.
 *
 * Optimistic (mirrors `useDeleteLabel`): the view disappears from the list
 * cache immediately, reappears via the `onError` rollback if the server
 * rejects, and `onSettled` re-syncs unless the write was queued.
 */
export function useDeleteSavedView(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    networkMode: "always",
    // The removal lives here, not in onMutate, so the write is named before the view leaves the cache.
    mutationFn: (viewId: string) => {
      const label = `Delete view ${viewName(qc, projectId, viewId)}`;
      qc.setQueryData<SavedViewsData>(queryKeys.projects.savedViews(projectId), (old) => {
        if (!old) return old;
        return { views: old.views.filter((v) => v.id !== viewId) };
      });
      return sendWrite<{ ok: true; deletedId: string }>({
        method: "DELETE",
        path: `/api/projects/${projectId}/views/${viewId}`,
        label,
      });
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: queryKeys.projects.savedViews(projectId) });
      return { prev: qc.getQueryData<SavedViewsData>(queryKeys.projects.savedViews(projectId)) };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.projects.savedViews(projectId), ctx.prev);
      }
    },
    onSettled: (result) => invalidateViews(qc, projectId, result),
  });
}
