import { CloudUpload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ALLOWED_ATTACHMENT_TYPES } from "@/shared/schemas/attachment";
import { Text } from "@/web/components/ui/Text";

export function CompactDropZone({
  onFilesSelected,
  disabled,
  isEmpty,
}: {
  onFilesSelected: (files: File[]) => void;
  disabled: boolean;
  isEmpty: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFilesSelected(files);
    },
    [disabled, onFilesSelected],
  );

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload files"
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed transition-colors ${
        dragOver
          ? "border-accent bg-accent/5"
          : "border-border-default hover:border-fg-muted hover:bg-surface-1"
      } ${isEmpty ? "py-r2" : "py-r5"}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <CloudUpload size={isEmpty ? 20 : 14} className="text-fg-muted" />
      <Text variant="body-3" color="secondary">
        {isEmpty ? "Drop files here or click to browse" : "Add more files"}
      </Text>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
        multiple
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files) {
            onFilesSelected(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
