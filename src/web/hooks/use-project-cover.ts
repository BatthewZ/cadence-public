import { useCallback } from "react";

import {
  buildUnsplashDisplaySrcSet,
  buildUnsplashDisplayUrl,
} from "@/shared/lib/unsplash-display";
import type {
  StoredUnsplashCoverPayload,
  UnsplashCoverPayload,
} from "@/shared/schemas/unsplash";
import { useFileUpload } from "@/web/hooks/use-file-upload";
import { api } from "@/web/lib/api/client";

/**
 * Attribution bundle derived from a Unsplash cover payload. Shaped so the
 * caller can render a compliant "Photo by {name} on Unsplash" credit without
 * re-deriving URLs per render.
 */
export interface CoverAttribution {
  name: string;
  username: string;
  profileUrl: string;
  photoUrl: string;
}

/**
 * Derive the display URL and photographer attribution for a cover image from
 * the XOR-disciplined source columns (`coverImageKey` + `coverUnsplash`).
 *
 * Unsplash takes precedence when both are transiently set — the XOR invariant
 * normally guarantees at most one is populated, but optimistic flips can
 * briefly show both. Shared by `useProjectCover` and `useTaskCover` so a
 * single resolution rule governs every `<CoverImage/>` consumer.
 */
export function resolveCoverDisplay(
  coverImageKey: string | null | undefined,
  // The STORED (lenient) shape: this resolves covers read back from the
  // server, where `rawUrl` may be absent on legacy rows — the display
  // builders below fall back to the pre-baked URLs for exactly that case.
  coverUnsplash: StoredUnsplashCoverPayload | null | undefined,
): {
  coverUrl: string | null;
  /** Multi-width `<img srcSet>` for Unsplash covers — lets the browser pick
   *  the appropriate rendition for the display. `null` for R2 uploads
   *  (single resolution) and for legacy Unsplash rows without `rawUrl`. */
  coverSrcSet: string | null;
  coverAttribution: CoverAttribution | null;
} {
  if (coverUnsplash) {
    return {
      // Compose a cover-sized imgix URL from the payload's rawUrl when
      // available. Falls back to the pre-baked 1080px `regular` URL for
      // legacy rows; see buildUnsplashDisplayUrl for details.
      coverUrl: buildUnsplashDisplayUrl(coverUnsplash, "cover"),
      coverSrcSet: buildUnsplashDisplaySrcSet(coverUnsplash),
      coverAttribution: {
        name: coverUnsplash.user.name,
        username: coverUnsplash.user.username,
        profileUrl: coverUnsplash.user.profileUrl,
        photoUrl: coverUnsplash.photoUrl,
      },
    };
  }
  return {
    coverUrl: coverImageKey ? `/api/uploads/${coverImageKey}` : null,
    coverSrcSet: null,
    coverAttribution: null,
  };
}

/**
 * XOR invariant: a project has at most one cover source active at any time —
 * either an uploaded R2 key (`coverImageKey`) or an Unsplash payload
 * (`coverUnsplash`), never both. The backend enforces this atomically; this
 * hook mirrors the invariant in every optimistic update path (upload, apply
 * Unsplash, remove) so consumers never see a transient "both set" state.
 *
 * Encapsulates project cover upload, Unsplash apply, removal, and URL/
 * attribution derivation. Both `ProjectLayout` and `ProjectSettings` need
 * identical cover logic — keeping it in one place avoids divergent
 * optimistic contracts.
 *
 * @param projectId Project id for the backend endpoints.
 * @param coverImageKey Current R2 key (from server state), or null/undefined.
 * @param coverUnsplash Current Unsplash payload (from server state), or null.
 * @param updateProject Optimistic cache writer. Must accept both cover fields
 *   so XOR clears can be applied in a single call.
 * @param onRemoveError Fires when DELETE fails. Callers typically refetch or
 *   show a toast.
 * @param onApplyError Fires when applying an Unsplash cover fails. Callers
 *   should refetch to re-sync from the server; the hook itself does not know
 *   the previous state to roll back to.
 */
export function useProjectCover(
  projectId: string,
  coverImageKey: string | null | undefined,
  // Stored (lenient) shape — server state; see resolveCoverDisplay.
  coverUnsplash: StoredUnsplashCoverPayload | null | undefined,
  updateProject: (updates: {
    coverImageKey?: string | null;
    coverUnsplash?: StoredUnsplashCoverPayload | null;
  }) => void,
  onRemoveError?: () => void,
  onApplyError?: () => void,
) {
  const { state: uploadState, upload } = useFileUpload<{ coverImageKey: string }>();

  const { coverUrl, coverSrcSet, coverAttribution } = resolveCoverDisplay(
    coverImageKey,
    coverUnsplash,
  );

  const uploading = uploadState === "uploading";

  const handleUpload = useCallback(
    (file: File) => {
      void upload(file, {
        endpoint: `/api/projects/${projectId}/cover`,
        method: "put",
      }).then((result) => {
        if (result) {
          // XOR: applying an upload clears any existing Unsplash payload so
          // the optimistic state matches the backend's post-write state.
          updateProject({
            coverImageKey: result.coverImageKey,
            coverUnsplash: null,
          });
        }
      });
    },
    [upload, projectId, updateProject],
  );

  const handleRemove = useCallback(async () => {
    // XOR: clear both columns optimistically — the backend clears both too.
    updateProject({ coverImageKey: null, coverUnsplash: null });
    try {
      await api.delete(`/api/projects/${projectId}/cover`);
    } catch {
      onRemoveError?.();
    }
  }, [projectId, updateProject, onRemoveError]);

  const handleApplyUnsplash = useCallback(
    async (payload: UnsplashCoverPayload) => {
      // XOR: applying Unsplash clears any uploaded image key.
      updateProject({ coverImageKey: null, coverUnsplash: payload });
      try {
        await api.put<{ coverUnsplash: UnsplashCoverPayload }>(
          `/api/projects/${projectId}/cover/unsplash`,
          payload,
        );
      } catch {
        onApplyError?.();
      }
    },
    [projectId, updateProject, onApplyError],
  );

  return {
    coverUrl,
    coverSrcSet,
    coverAttribution,
    uploading,
    handleUpload,
    handleRemove,
    handleApplyUnsplash,
  };
}
