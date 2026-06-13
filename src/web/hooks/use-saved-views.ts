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
 * template) with two deliberate divergences — these are not omissions:
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateSavedViewInput,
  SavedView,
  UpdateSavedViewInput,
} from "@/shared/schemas/saved-view";
import { api } from "@/web/lib/api/client";
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

/**
 * Creates a saved view. Deliberately NON-optimistic: the caller does
 * `await mutateAsync(input)` and needs the SERVER-assigned view id to write
 * `?view=<id>` into the URL immediately after creation. An optimistic insert
 * would have to invent a temporary id, and that bogus id would leak into the
 * URL (and into anything that copies it) before the server responds — so we
 * wait for the real row and just invalidate the list on success.
 */
export function useCreateSavedView(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateSavedViewInput) =>
      api.post<{ view: SavedView }>(`/api/projects/${projectId}/views`, input),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.savedViews(projectId),
      });
    },
  });
}

/**
 * Renames a saved view and/or overwrites its state snapshot.
 *
 * Optimistic (mirrors `useUpdateLabel`): the list cache is patched in
 * `onMutate` so the ViewSwitcher reflects the edit instantly, the snapshot is
 * restored in `onError` (e.g. 409 duplicate name), and `onSettled` always
 * re-syncs with the server — including after the success path, where the
 * server may have normalized fields (trimmed name, bumped `updatedAt`).
 */
export function useUpdateSavedView(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ viewId, ...input }: UpdateSavedViewInput & { viewId: string }) =>
      api.patch<{ view: SavedView }>(`/api/projects/${projectId}/views/${viewId}`, input),
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
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.savedViews(projectId),
      });
    },
  });
}

/**
 * Deletes a saved view.
 *
 * Optimistic (mirrors `useDeleteLabel`): the view disappears from the list
 * cache immediately, reappears via the `onError` rollback if the server
 * rejects, and `onSettled` re-syncs either way.
 */
export function useDeleteSavedView(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (viewId: string) =>
      api.delete<{ ok: true; deletedId: string }>(`/api/projects/${projectId}/views/${viewId}`),
    onMutate: async (viewId) => {
      await qc.cancelQueries({ queryKey: queryKeys.projects.savedViews(projectId) });

      const prev = qc.getQueryData<SavedViewsData>(queryKeys.projects.savedViews(projectId));

      qc.setQueryData<SavedViewsData>(queryKeys.projects.savedViews(projectId), (old) => {
        if (!old) return old;
        return { views: old.views.filter((v) => v.id !== viewId) };
      });

      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.projects.savedViews(projectId), ctx.prev);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.savedViews(projectId),
      });
    },
  });
}
