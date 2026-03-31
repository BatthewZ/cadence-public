import { type QueryClient, useQuery } from "@tanstack/react-query";

import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";

export interface Attachment {
  id: string;
  uploadId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  uploaderName: string | null;
  uploaderImage: string | null;
  createdAt: string;
}

interface AttachmentsResponse {
  attachments: Attachment[];
}

// ---------------------------------------------------------------------------
// Optimistic cache helpers for task attachments.
// ---------------------------------------------------------------------------

/** Optimistically appends an attachment to the cache. */
export function optimisticAddAttachment(
  qc: QueryClient,
  taskId: string,
  attachment: Attachment,
): void {
  freshnessTracker.recordMutation("tasks");
  qc.setQueryData<AttachmentsResponse>(
    queryKeys.tasks.attachments(taskId),
    (old) => {
      if (!old) return { attachments: [attachment] };
      return { attachments: [...old.attachments, attachment] };
    },
  );
}

/** Removes a previously-added optimistic attachment from the cache (rollback). */
export function rollbackAddAttachment(
  qc: QueryClient,
  taskId: string,
  optimisticId: string,
): void {
  qc.setQueryData<AttachmentsResponse>(
    queryKeys.tasks.attachments(taskId),
    (old) => {
      if (!old) return old;
      return {
        attachments: old.attachments.filter((a) => a.id !== optimisticId),
      };
    },
  );
}

/**
 * Optimistically removes an attachment from the cache.
 * Returns the removed attachment for rollback purposes.
 */
export function optimisticRemoveAttachment(
  qc: QueryClient,
  taskId: string,
  attachmentId: string,
): Attachment | undefined {
  freshnessTracker.recordMutation("tasks");
  let removed: Attachment | undefined;
  qc.setQueryData<AttachmentsResponse>(
    queryKeys.tasks.attachments(taskId),
    (old) => {
      if (!old) return old;
      removed = old.attachments.find((a) => a.id === attachmentId);
      return {
        attachments: old.attachments.filter((a) => a.id !== attachmentId),
      };
    },
  );
  return removed;
}

/** Re-inserts a previously removed attachment into the cache (rollback). */
export function rollbackRemoveAttachment(
  qc: QueryClient,
  taskId: string,
  attachment: Attachment,
): void {
  qc.setQueryData<AttachmentsResponse>(
    queryKeys.tasks.attachments(taskId),
    (old) => {
      if (!old) return { attachments: [attachment] };
      // Re-insert in chronological order
      const attachments = [...old.attachments, attachment].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      return { attachments };
    },
  );
}

/**
 * Fetches attachments for a task.
 */
export function useTaskAttachments(taskId: string, options?: { enabled?: boolean }) {
  const query = useQuery<AttachmentsResponse>({
    queryKey: queryKeys.tasks.attachments(taskId),
    queryFn: () => api.get<AttachmentsResponse>(`/api/tasks/${taskId}/attachments`),
    enabled: options?.enabled,
  });

  return {
    attachments: query.data?.attachments ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
