import { Download, Loader2, Trash2 } from "lucide-react";

import { Avatar } from "@/web/components/ui/Avatar";
import { Text } from "@/web/components/ui/Text";
import type { Attachment } from "@/web/hooks/use-task-attachments";
import { formatRelativeTime } from "@/web/util/activity";
import { formatBytes } from "@/web/util/format";

import { FileTypeIcon, isImageType } from "./FileTypeIcon";

export function AttachmentRow({
  attachment,
  readOnly,
  onDelete,
  onImageClick,
}: {
  attachment: Attachment;
  readOnly: boolean;
  onDelete: (attachment: Attachment) => void;
  onImageClick: (attachment: Attachment) => void;
}) {
  const isImage = isImageType(attachment.mimeType);
  const isOptimistic = attachment.id.startsWith("optimistic-");

  return (
    <div
      className={`group flex items-center gap-r5 rounded-md border border-border-default px-r4 py-r5 transition-colors hover:bg-surface-1${isOptimistic ? " opacity-60" : ""}`}
    >
      {/* Icon / Thumbnail */}
      {isImage ? (
        <button
          type="button"
          className="shrink-0 overflow-hidden rounded"
          onClick={() => onImageClick(attachment)}
          aria-label={`Preview ${attachment.filename}`}
        >
          <img
            src={attachment.url}
            alt={attachment.filename}
            className="size-10 rounded object-cover"
            loading="lazy"
          />
        </button>
      ) : (
        <FileTypeIcon mimeType={attachment.mimeType} />
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <Text variant="body-3" weight="semibold" className="truncate block">
          {attachment.filename}
        </Text>
        <Text variant="body-3" color="secondary" className="flex items-center gap-1">
          {formatBytes(attachment.size)} &middot; {formatRelativeTime(attachment.createdAt)}
          {attachment.uploaderName && (
            <>
              <span>&middot;</span>
              <span className="inline-flex items-center gap-1">
                <Avatar
                  size="xs"
                  name={attachment.uploaderName}
                  src={attachment.uploaderImage ?? undefined}
                />
                <span className="truncate max-w-[7.5rem]">{attachment.uploaderName}</span>
              </span>
            </>
          )}
        </Text>
      </div>

      {/* Actions (hover) */}
      {!isOptimistic && (
        <div className="flex shrink-0 items-center gap-r6 opacity-0 transition-opacity group-hover:opacity-100">
          <a
            href={attachment.url}
            download={attachment.filename}
            className="inline-flex items-center justify-center rounded p-1 text-fg-muted hover:text-fg-default hover:bg-surface-2 transition-colors"
            aria-label={`Download ${attachment.filename}`}
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={16} />
          </a>
          {!readOnly && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded p-1 text-fg-muted hover:text-danger hover:bg-surface-2 transition-colors"
              onClick={() => onDelete(attachment)}
              aria-label={`Delete ${attachment.filename}`}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}

      {isOptimistic && (
        <Loader2 size={16} className="shrink-0 animate-spin text-fg-muted" />
      )}
    </div>
  );
}
