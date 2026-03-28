import {
  type ComponentPropsWithRef,
  type DragEvent,
  forwardRef,
  useCallback,
  useRef,
  useState,
} from "react";

import { formatBytes } from "@/web/util/format";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FileUploadProps = {
  /** Accepted MIME types (e.g. `["image/png", "image/jpeg"]`). */
  accept?: string[];
  /** Maximum file size in bytes. */
  maxSize?: number;
  /** Allow selecting multiple files. */
  multiple?: boolean;
  /** Called when files are selected (via drop or browse). */
  onFilesSelected?: (files: File[]) => void;
  /** Disable the dropzone. */
  disabled?: boolean;
  /** Hint text shown below the main prompt. */
  hint?: string;
  /** Error message to display (overrides internal state). */
  error?: string | null;
  /** Success message to display. */
  success?: string | null;
  /** Whether the component is in an uploading state. */
  uploading?: boolean;
} & Omit<ComponentPropsWithRef<"div">, "onDrop">;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildAcceptString(accept?: string[]): string | undefined {
  return accept && accept.length > 0 ? accept.join(",") : undefined;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const FileUpload = forwardRef<HTMLDivElement, FileUploadProps>(function FileUpload(
  {
    accept,
    maxSize,
    multiple = false,
    onFilesSelected,
    disabled = false,
    hint,
    error,
    success,
    uploading = false,
    className,
    ...props
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  /* ---- Validation ---- */

  const validateFiles = useCallback(
    (files: File[]): File[] => {
      return files.filter((file) => {
        if (accept && accept.length > 0 && !accept.includes(file.type)) {
          return false;
        }
        if (maxSize != null && file.size > maxSize) {
          return false;
        }
        return true;
      });
    },
    [accept, maxSize],
  );

  /* ---- Handlers ---- */

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      const valid = validateFiles(files);
      if (valid.length > 0) {
        onFilesSelected?.(multiple ? valid : [valid[0]]);
      }
    },
    [validateFiles, onFilesSelected, multiple],
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !uploading) setDragOver(true);
    },
    [disabled, uploading],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (disabled || uploading) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, uploading, handleFiles],
  );

  const handleClick = useCallback(() => {
    if (!disabled && !uploading) inputRef.current?.click();
  }, [disabled, uploading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && !disabled && !uploading) {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    [disabled, uploading],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset input so the same file can be re-selected.
      e.target.value = "";
    },
    [handleFiles],
  );

  /* ---- Hint text ---- */

  const computedHint = hint ?? (maxSize ? `Max file size: ${formatBytes(maxSize)}` : undefined);

  /* ---- Render ---- */

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload file"
      aria-disabled={disabled || undefined}
      className={cn(
        "file-upload",
        dragOver && "file-upload--drag-over",
        uploading && "file-upload--uploading",
        success && "file-upload--success",
        error && "file-upload--error",
        disabled && "file-upload--disabled",
        className,
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      {...props}
    >
      {/* Icon */}
      <span className="file-upload__icon" aria-hidden="true">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </span>

      {/* Main text */}
      {uploading ? (
        <p className="file-upload__text">Uploading...</p>
      ) : (
        <p className="file-upload__text">
          Drag & drop or{" "}
          <span className="file-upload__text-emphasis">browse</span>
        </p>
      )}

      {/* Hint / constraints */}
      {computedHint && !error && !success && (
        <p className="file-upload__hint">{computedHint}</p>
      )}

      {/* Error message */}
      {error && <p className="file-upload__error">{error}</p>}

      {/* Success message */}
      {success && <p className="file-upload__success">{success}</p>}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={buildAcceptString(accept)}
        multiple={multiple}
        disabled={disabled || uploading}
        onChange={handleInputChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
});
