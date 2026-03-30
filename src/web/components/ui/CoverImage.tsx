import { GripVertical, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { type ComponentPropsWithRef, forwardRef, useCallback, useEffect, useRef, useState } from "react";

import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_SIZE } from "@/shared/schemas/upload";
import { formatBytes } from "@/web/util/format";
import { COVER_PRESET, isAnimatedGif, optimizeImage } from "@/web/util/image-optimization";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CoverImageProps = {
  /** Current cover image URL, or null if no cover is set. */
  coverUrl: string | null;
  /** Called with the selected File when the user picks a new cover. */
  onUpload: (file: File) => void;
  /** Called when the user removes the cover image. */
  onRemove: () => void;
  /** Whether an upload is in progress. Shows a loading overlay. */
  uploading?: boolean;
  /** Whether the user can change the cover. Controls hover interactions. */
  editable?: boolean;
  /** Vertical position of the cover image (0-100). 0=top, 50=center, 100=bottom. */
  position?: number | null;
  /** Called when the user finishes repositioning the cover image. */
  onPositionChange?: (position: number) => void;
  /** Whether to round the top corners. Defaults to true (suited for cards/layouts). */
  roundedTop?: boolean;
} & Omit<ComponentPropsWithRef<"div">, "children">;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const acceptString = ALLOWED_IMAGE_TYPES.join(",");

function validateFile(file: File): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `File type "${file.type || "unknown"}" is not allowed. Accepted types: ${ALLOWED_IMAGE_TYPES.join(", ")}.`;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return `File is too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(MAX_UPLOAD_SIZE)}.`;
  }
  return null;
}

/** Clamp a value between min and max inclusive. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cover image banner with upload, change, remove, and reposition capabilities.
 *
 * Repositioning works like Notion: the user clicks "Reposition", then drags the
 * image vertically to adjust which part is visible. The vertical focal point is
 * stored as a 0-100 percentage (0 = top, 50 = center, 100 = bottom).
 *
 * The drag works by tracking the mouse/touch Y delta relative to the container
 * height, translating pixel movement into percentage change of `object-position`.
 */
export const CoverImage = forwardRef<HTMLDivElement, CoverImageProps>(
  function CoverImage(
    {
      coverUrl,
      onUpload,
      onRemove,
      uploading = false,
      editable = false,
      position: positionProp,
      onPositionChange,
      roundedTop = true,
      className,
      ...props
    },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const previewUrlRef = useRef<string | null>(null);

    // Repositioning state
    const [repositioning, setRepositioning] = useState(false);
    const [dragPosition, setDragPosition] = useState<number>(positionProp ?? 50);
    const dragStartRef = useRef<{ y: number; startPosition: number } | null>(null);
    const isDraggingRef = useRef(false);

    // The effective position: during reposition mode use dragPosition, otherwise use prop
    const effectivePosition = repositioning ? dragPosition : (positionProp ?? 50);

    // Revoke the object URL on unmount or when previewUrl changes to prevent memory leaks
    useEffect(() => {
      return () => {
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
      };
    }, []);

    const displayUrl = previewUrl ?? coverUrl;

    const triggerFilePicker = useCallback(() => {
      inputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset input so the same file can be re-selected
        e.target.value = "";

        const error = validateFile(file);
        if (error) {
          setValidationError(error);
          return;
        }

        setValidationError(null);

        // Revoke previous preview URL to prevent memory leaks
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }

        // Show optimistic preview (use original for instant display)
        const objectUrl = URL.createObjectURL(file);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);

        // Optimize before upload: resize + WebP conversion.
        // Animated GIFs pass through unchanged to preserve animation.
        let fileToUpload = file;
        try {
          const animated = await isAnimatedGif(file);
          if (!animated) {
            fileToUpload = await optimizeImage(file, COVER_PRESET);
          }
        } catch {
          // Optimization failed — upload original
        }

        onUpload(fileToUpload);
      },
      [onUpload]
    );

    const handleRemove = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        setPreviewUrl(null);
        setValidationError(null);
        onRemove();
      },
      [onRemove]
    );

    // ---- Repositioning handlers ----

    const enterReposition = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        setRepositioning(true);
        setDragPosition(positionProp ?? 50);
      },
      [positionProp]
    );

    const saveReposition = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        setRepositioning(false);
        onPositionChange?.(Math.round(dragPosition));
      },
      [dragPosition, onPositionChange]
    );

    const cancelReposition = useCallback(() => {
      setRepositioning(false);
      setDragPosition(positionProp ?? 50);
    }, [positionProp]);

    // Calculate new position from a Y delta in pixels
    const computePositionFromDelta = useCallback((deltaY: number) => {
      const container = containerRef.current;
      if (!container || !dragStartRef.current) return;

      const containerHeight = container.getBoundingClientRect().height;
      // Moving mouse down should decrease the position value (show higher part of image),
      // moving mouse up should increase it (show lower part).
      // A full container-height drag maps to ~100% range.
      const percentDelta = (deltaY / containerHeight) * -100;
      const newPosition = clamp(dragStartRef.current.startPosition + percentDelta, 0, 100);
      setDragPosition(newPosition);
    }, []);

    // Mouse events for repositioning
    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (!repositioning) return;
        e.preventDefault();
        e.stopPropagation();
        isDraggingRef.current = true;
        dragStartRef.current = { y: e.clientY, startPosition: dragPosition };
      },
      [repositioning, dragPosition]
    );

    useEffect(() => {
      if (!repositioning) return;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDraggingRef.current || !dragStartRef.current) return;
        e.preventDefault();
        const deltaY = e.clientY - dragStartRef.current.y;
        computePositionFromDelta(deltaY);
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        dragStartRef.current = null;
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          cancelReposition();
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("keydown", handleKeyDown);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [repositioning, computePositionFromDelta, cancelReposition]);

    // Touch events for repositioning
    const handleTouchStart = useCallback(
      (e: React.TouchEvent) => {
        if (!repositioning) return;
        e.stopPropagation();
        const touch = e.touches[0];
        isDraggingRef.current = true;
        dragStartRef.current = { y: touch.clientY, startPosition: dragPosition };
      },
      [repositioning, dragPosition]
    );

    useEffect(() => {
      if (!repositioning) return;

      const handleTouchMove = (e: TouchEvent) => {
        if (!isDraggingRef.current || !dragStartRef.current) return;
        e.preventDefault();
        const touch = e.touches[0];
        const deltaY = touch.clientY - dragStartRef.current.y;
        computePositionFromDelta(deltaY);
      };

      const handleTouchEnd = () => {
        isDraggingRef.current = false;
        dragStartRef.current = null;
      };

      document.addEventListener("touchmove", handleTouchMove, { passive: false });
      document.addEventListener("touchend", handleTouchEnd);

      return () => {
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
      };
    }, [repositioning, computePositionFromDelta]);

    return (
      <div ref={ref} className={cn("relative", className)} {...props}>
        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          accept={acceptString}
          onChange={(e) => void handleFileChange(e)}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        <div
          ref={containerRef}
          className={cn(
            "relative overflow-hidden",
            displayUrl ? "h-32 md:h-40" : "h-12 sm:h-24 md:h-32",
            roundedTop && "rounded-t-lg",
            !displayUrl && "bg-gradient-to-br from-surface-1 to-surface-2",
            !displayUrl &&
              editable &&
              !repositioning &&
              "border border-dashed border-transparent hover:border-accent/40 hover:bg-accent-subtle/30 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
            editable && !repositioning && "group cursor-pointer",
            repositioning && "cursor-grab active:cursor-grabbing"
          )}
          onClick={editable && !displayUrl && !repositioning ? triggerFilePicker : undefined}
          role={editable && !displayUrl ? "button" : undefined}
          tabIndex={editable && !displayUrl ? 0 : undefined}
          aria-label={
            repositioning
              ? "Drag to reposition cover image"
              : editable && !displayUrl
                ? "Add cover image"
                : undefined
          }
          onKeyDown={
            editable && !displayUrl && !repositioning
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    triggerFilePicker();
                  }
                }
              : undefined
          }
          onMouseDown={repositioning ? handleMouseDown : undefined}
          onTouchStart={repositioning ? handleTouchStart : undefined}
        >
          {/* Image */}
          {displayUrl && (
            <img
              src={displayUrl}
              alt="Cover"
              className="h-full w-full object-cover select-none"
              style={{ objectPosition: `center ${effectivePosition}%` }}
              draggable={false}
            />
          )}

          {displayUrl && !repositioning && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface-1 to-transparent pointer-events-none" />
          )}

          {/* Upload loading overlay */}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
          )}

          {/* Repositioning overlay */}
          {repositioning && displayUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-between bg-black/30 py-r5">
              <p className="rounded-md bg-black/60 px-r4 py-r6 text-body-3 font-medium text-white select-none">
                Drag image to reposition
              </p>
              <div className="flex gap-r5">
                <button
                  type="button"
                  onClick={saveReposition}
                  className="flex items-center gap-r6 rounded-md bg-surface-1/90 px-r5 py-r6 text-body-3 font-medium text-fg-primary shadow-sm hover:bg-surface-1"
                  aria-label="Save cover position"
                >
                  Save position
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelReposition();
                  }}
                  className="flex items-center gap-r6 rounded-md bg-surface-1/90 px-r5 py-r6 text-body-3 font-medium text-fg-secondary shadow-sm hover:bg-surface-1"
                  aria-label="Cancel repositioning"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Editable hover overlays (hidden during reposition mode) */}
          {editable && !uploading && !repositioning && (
            <>
              {/* No cover: "Add cover" prompt */}
              {!displayUrl && (
                <div className="absolute inset-0 flex items-center justify-center opacity-40 transition-all duration-fast group-hover:opacity-100">
                  <div className="flex items-center gap-r5 text-body-2 text-fg-secondary transition-colors duration-fast group-hover:text-fg-primary">
                    <ImagePlus size={20} />
                    <span>Add cover</span>
                  </div>
                </div>
              )}

              {/* With cover: action overlay */}
              {displayUrl && (
                <div className="absolute inset-0 flex items-center justify-center gap-r5 bg-black/0 transition-all duration-fast group-hover:bg-black/40">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerFilePicker();
                    }}
                    className="flex items-center gap-r5 rounded-md bg-surface-1/90 px-r5 py-r6 text-body-3 font-medium text-fg-primary opacity-0 shadow-sm transition-opacity duration-fast hover:bg-surface-1 group-hover:opacity-100"
                    aria-label="Change cover image"
                  >
                    <Pencil size={14} />
                    Change cover
                  </button>
                  {onPositionChange && (
                    <button
                      type="button"
                      onClick={enterReposition}
                      className="flex items-center gap-r5 rounded-md bg-surface-1/90 px-r5 py-r6 text-body-3 font-medium text-fg-primary opacity-0 shadow-sm transition-opacity duration-fast hover:bg-surface-1 group-hover:opacity-100"
                      aria-label="Reposition cover image"
                    >
                      <GripVertical size={14} />
                      Reposition
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="flex items-center gap-r5 rounded-md bg-surface-1/90 px-r5 py-r6 text-body-3 font-medium text-status-error opacity-0 shadow-sm transition-opacity duration-fast hover:bg-surface-1 group-hover:opacity-100"
                    aria-label="Remove cover image"
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Validation error message */}
        {validationError && (
          <p className="mt-r6 text-body-3 text-status-error">{validationError}</p>
        )}
      </div>
    );
  }
);
