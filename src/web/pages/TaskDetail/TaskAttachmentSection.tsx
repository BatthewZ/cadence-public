import { useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
} from "@/shared/schemas/attachment";
import { Stack } from "@/web/components/layout";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import type { Task } from "@/web/contexts/ProjectContext";
import {
  type Attachment,
  optimisticAddAttachment,
  optimisticRemoveAttachment,
  rollbackAddAttachment,
  rollbackRemoveAttachment,
  useTaskAttachments,
} from "@/web/hooks/use-task-attachments";
import { api, ApiError } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { AttachmentRow } from "./components/AttachmentRow";
import { AttachmentSkeletonList } from "./components/AttachmentSkeleton";
import { CompactDropZone } from "./components/CompactDropZone";
import { isImageType } from "./components/FileTypeIcon";
import { ImageLightbox } from "./components/ImageLightbox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskAttachmentSectionProps = {
  taskId: string;
  projectId: string;
  readOnly?: boolean;
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TaskAttachmentSection({ taskId, projectId, readOnly = false }: TaskAttachmentSectionProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { attachments, isLoading, isError } = useTaskAttachments(taskId);

  // Update attachment count in projects.tasks cache for board card.
  // Uses direct setQueryData instead of useProject() because this component
  // is also rendered in TaskDetailDialog outside a ProjectProvider.
  const updateAttachmentCount = useCallback(
    (count: number) => {
      qc.setQueryData<{ tasks: Task[] }>(
        queryKeys.projects.tasks(projectId),
        (old) => {
          if (!old) return old;
          return {
            tasks: old.tasks.map((t) =>
              t.id === taskId ? { ...t, attachmentCount: count } : t,
            ),
          };
        },
      );
    },
    [qc, projectId, taskId],
  );

  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const imageAttachments = useMemo(
    () => attachments.filter((a) => isImageType(a.mimeType) && !a.id.startsWith("optimistic-")),
    [attachments],
  );

  // ----- Upload flow -----

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        // Client-side validation
        if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
          toast(`"${file.name}" has an unsupported file type`, { variant: "error" });
          continue;
        }
        if (file.size > MAX_ATTACHMENT_SIZE) {
          toast(`"${file.name}" exceeds the 10MB limit`, { variant: "error" });
          continue;
        }
        if (attachments.length >= MAX_ATTACHMENTS_PER_TASK) {
          toast(`Maximum of ${MAX_ATTACHMENTS_PER_TASK} attachments reached`, { variant: "error" });
          break;
        }

        // Optimistic add
        const optimisticId = `optimistic-${crypto.randomUUID()}`;
        const optimisticAttachment: Attachment = {
          id: optimisticId,
          uploadId: "",
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          url: URL.createObjectURL(file),
          uploaderName: null,
          uploaderImage: null,
          createdAt: new Date().toISOString(),
        };
        optimisticAddAttachment(qc, taskId, optimisticAttachment);
        updateAttachmentCount(attachments.length + 1);

        try {
          const formData = new FormData();
          formData.append("file", file);
          const result = await api.post<{ attachment: Attachment }>(
            `/api/tasks/${taskId}/attachments`,
            formData,
          );

          // Replace optimistic with server data
          rollbackAddAttachment(qc, taskId, optimisticId);
          optimisticAddAttachment(qc, taskId, result.attachment);
          void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
        } catch (err) {
          rollbackAddAttachment(qc, taskId, optimisticId);
          updateAttachmentCount(Math.max(0, attachments.length - 1));
          const message = err instanceof ApiError ? err.message : "Upload failed";
          toast(`Failed to upload "${file.name}": ${message}`, { variant: "error" });
        } finally {
          URL.revokeObjectURL(optimisticAttachment.url);
        }
      }
    },
    [attachments.length, taskId, qc, toast, updateAttachmentCount],
  );

  // ----- Delete flow -----

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);

    const removed = optimisticRemoveAttachment(qc, taskId, deleteTarget.id);
    setDeleteTarget(null);
    updateAttachmentCount(Math.max(0, attachments.length - 1));

    try {
      await api.delete(`/api/tasks/${taskId}/attachments/${deleteTarget.id}`);
      void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
    } catch (err) {
      if (removed) rollbackRemoveAttachment(qc, taskId, removed);
      updateAttachmentCount(attachments.length);
      const message = err instanceof ApiError ? err.message : "Delete failed";
      toast(`Failed to delete "${deleteTarget.filename}": ${message}`, { variant: "error" });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, taskId, qc, toast, attachments.length, updateAttachmentCount]);

  // ----- Image lightbox -----

  const handleImageClick = useCallback(
    (attachment: Attachment) => {
      const idx = imageAttachments.findIndex((a) => a.id === attachment.id);
      if (idx >= 0) setLightboxIndex(idx);
    },
    [imageAttachments],
  );

  // ----- Render -----

  // Hide section entirely for read-only with no attachments and not loading
  if (readOnly && !isLoading && attachments.length === 0) return null;

  return (
    <>
      <div className="px-r3 py-r4">
        <Text variant="body-3" weight="semibold" color="secondary" className="mb-r5">
          <span className="inline-flex items-center gap-1">
            <Paperclip size={14} />
            Attachments ({attachments.filter((a) => !a.id.startsWith("optimistic-")).length})
          </span>
        </Text>

        {isLoading && <AttachmentSkeletonList />}

        {isError && (
          <Text variant="body-2" color="secondary" className="mb-r4">
            Failed to load attachments.
          </Text>
        )}

        {!isLoading && (
          <Stack gap="r5">
            {attachments.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                readOnly={readOnly}
                onDelete={setDeleteTarget}
                onImageClick={handleImageClick}
              />
            ))}

            {!readOnly && (
              <CompactDropZone
                onFilesSelected={(files) => void handleFilesSelected(files)}
                disabled={false}
                isEmpty={attachments.filter((a) => !a.id.startsWith("optimistic-")).length === 0}
              />
            )}
          </Stack>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteConfirm()}
        title="Delete attachment?"
        confirming={isDeleting}
      >
        This will permanently remove {deleteTarget?.filename}.
      </ConfirmDialog>

      {/* Image lightbox */}
      {lightboxIndex !== null && (
        <ImageLightbox
          images={imageAttachments}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
