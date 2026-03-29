import { useCallback } from "react";

import { useFileUpload } from "@/web/hooks/use-file-upload";
import { api } from "@/web/lib/api/client";

/**
 * Encapsulates project cover-image upload, removal, and URL derivation.
 *
 * Both ProjectLayout and ProjectSettings need identical cover-image logic —
 * keeping it in one place avoids divergent upload/remove implementations and
 * makes the optimistic-update contract easier to audit.
 *
 * @param onRemoveError - Called when the DELETE request fails.
 *   ProjectLayout passes `refetch` to re-sync from server.
 *   ProjectSettings reverts `coverImageKey` and shows a toast.
 */
export function useProjectCover(
  projectId: string,
  coverImageKey: string | null | undefined,
  updateProject: (updates: { coverImageKey: string | null }) => void,
  onRemoveError?: () => void,
) {
  const { state: uploadState, upload } = useFileUpload<{ coverImageKey: string }>();

  const coverUrl = coverImageKey ? `/api/uploads/${coverImageKey}` : null;
  const uploading = uploadState === "uploading";

  const handleUpload = useCallback(
    (file: File) => {
      void upload(file, {
        endpoint: `/api/projects/${projectId}/cover`,
        method: "put",
      }).then((result) => {
        if (result) {
          updateProject({ coverImageKey: result.coverImageKey });
        }
      });
    },
    [upload, projectId, updateProject],
  );

  const handleRemove = useCallback(async () => {
    updateProject({ coverImageKey: null });
    try {
      await api.delete(`/api/projects/${projectId}/cover`);
    } catch {
      onRemoveError?.();
    }
  }, [projectId, updateProject, onRemoveError]);

  return { coverUrl, uploading, handleUpload, handleRemove };
}
