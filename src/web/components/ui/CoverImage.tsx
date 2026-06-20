import { GripVertical, ImagePlus, Pencil, Trash2 } from "lucide-react";
import {
  type ComponentPropsWithRef,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { UnsplashCoverPayload } from "@/shared/schemas/unsplash";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_SIZE } from "@/shared/schemas/upload";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { CoverImagePicker } from "@/web/components/ui/CoverImagePicker";
import { formatBytes } from "@/web/util/format";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Attribution descriptor for the rendered photographer credit. Pre-baked on
 * the server with UTM params — never re-append them client-side.
 */
export interface CoverImageAttribution {
  name: string;
  profileUrl: string;
  photoUrl: string;
}

type CoverImageProps = {
  /** Current cover image URL, or null if no cover is set. Resolved by the
   *  parent hook (e.g. `useProjectCover`) across both R2 and Unsplash sources. */
  coverUrl: string | null;
  /** Multi-width `<img srcSet>` for Unsplash covers — lets the browser pick
   *  the appropriate rendition for the display size / DPR. Null for R2
   *  uploads (single resolution) and for legacy Unsplash rows without
   *  `rawUrl`. When set, pair with `sizes="100vw"` (applied automatically). */
  coverSrcSet?: string | null;
  /** Called with the selected File when the user picks a new cover via upload. */
  onUpload: (file: File) => void;
  /** Called when the user removes the cover image. */
  onRemove: () => void;
  /** Called when the user selects an Unsplash photo from the picker. Optional
   *  — when omitted and the Unsplash flag is on, the Upload tab remains the
   *  only functional entry point. */
  onApplyUnsplash?: (payload: UnsplashCoverPayload) => void;
  /** Photographer attribution to overlay on the bottom-left of the cover.
   *  Render ONLY when a Unsplash cover is active; required by the Unsplash
   *  API guidelines on every displayed photo. */
  coverAttribution?: CoverImageAttribution | null;
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

/**
 * Safety-net validator for the upload path. The `CoverImagePicker` already
 * validates + optimizes files before handing us one, so this should never
 * fire in normal flow — we keep it as defense-in-depth in case a parent wires
 * `onUpload` from somewhere other than the picker (e.g. a future drop-zone).
 */
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

/**
 * Shared layout/motion for the three inline action chips ("Change cover",
 * "Reposition", "Remove"). They sit invisibly on top of the cover at
 * `opacity-0 pointer-events-none` and only become interactive on
 * `group-hover` / `group-focus-within` — critical for touch devices where
 * :hover fires on tap and a pointer-events-auto button would otherwise catch
 * a stray landing click. The individual buttons add their own text color.
 */
const COVER_ACTION_CHIP_CLASS =
  "flex items-center gap-r5 rounded-md bg-surface-1/90 px-r5 py-r6 text-body-3 font-medium opacity-0 pointer-events-none shadow-sm transition-opacity duration-fast hover:bg-surface-1 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cover image banner with upload, Unsplash apply, remove, and reposition
 * capabilities.
 *
 * The "Add cover" and "Change cover" affordances open `CoverImagePicker`,
 * which consolidates both the local upload flow (drag / browse, client-side
 * validation + optimization) and the Unsplash library browser behind a single
 * modal. The picker forwards the selected file through `onUpload` or a full
 * Unsplash payload through `onApplyUnsplash`; the parent hook handles the
 * mutation + optimistic cache update.
 *
 * Attribution: when `coverAttribution` is provided (set by the parent hook
 * whenever a Unsplash cover is active), we render a small "Photo by {name} on
 * Unsplash" chip at the bottom-left — required by the Unsplash API
 * guidelines. The chip is rendered unconditionally in the DOM but fades in
 * on hover/focus-within (group-hover/group-focus-within), matching the
 * Notion/Figma/Trello pattern that keeps the cover clean while still
 * surfacing credit on any interaction. UTM params are baked in server-side;
 * links MUST open in a new tab with noopener/noreferrer hardening. The chip
 * is suppressed entirely during repositioning and uploading so it doesn't
 * clash with the overlay UI.
 *
 * Repositioning works like Notion: the user clicks "Reposition", then drags
 * the image vertically to adjust which part is visible. The vertical focal
 * point is stored as a 0-100 percentage (0 = top, 50 = center, 100 = bottom).
 */
export const CoverImage = forwardRef<HTMLDivElement, CoverImageProps>(function CoverImage(
  {
    coverUrl,
    coverSrcSet,
    onUpload,
    onRemove,
    onApplyUnsplash,
    coverAttribution,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  /**
   * Remove is confirmation-gated because the action row is rendered
   * beneath the cover at opacity-0 until hover; a stray tap (especially
   * on touch devices, where :hover fires simultaneously with the click
   * that lands under your finger) can otherwise nuke the cover instantly.
   */
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  // Repositioning state
  const [repositioning, setRepositioning] = useState(false);
  const [dragPosition, setDragPosition] = useState<number>(positionProp ?? 50);
  const dragStartRef = useRef<{ y: number; startPosition: number } | null>(null);
  const isDraggingRef = useRef(false);

  // The effective position: during reposition mode use dragPosition, otherwise use prop
  const effectivePosition = repositioning ? dragPosition : (positionProp ?? 50);

  const openPicker = useCallback(() => {
    setSafetyError(null);
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const handlePickerUpload = useCallback(
    (file: File) => {
      // Defense-in-depth validation — picker already checks, but if a
      // future caller bypasses it we still block bad files here.
      const error = validateFile(file);
      if (error) {
        setSafetyError(error);
        return;
      }
      setSafetyError(null);
      onUpload(file);
      setPickerOpen(false);
    },
    [onUpload]
  );

  const handlePickerUnsplash = useCallback(
    (payload: UnsplashCoverPayload) => {
      setSafetyError(null);
      onApplyUnsplash?.(payload);
      setPickerOpen(false);
    },
    [onApplyUnsplash]
  );

  const requestRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRemoveConfirmOpen(true);
  }, []);

  const confirmRemove = useCallback(() => {
    setSafetyError(null);
    setRemoveConfirmOpen(false);
    onRemove();
  }, [onRemove]);

  const cancelRemove = useCallback(() => {
    setRemoveConfirmOpen(false);
  }, []);

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

  const displayUrl = coverUrl;
  const showAttribution = !!coverAttribution && !!displayUrl && !repositioning && !uploading;

  return (
    <div ref={ref} className={cn("relative isolate", className)} {...props}>
      <div
        ref={containerRef}
        className={cn(
          "relative overflow-hidden",
          displayUrl ? "h-32 md:h-40" : "h-12 sm:h-24 md:h-32",
          roundedTop && "rounded-t-lg",
          !displayUrl && "bg-linear-to-br from-surface-1 to-surface-2",
          !displayUrl &&
            editable &&
            !repositioning &&
            "border border-dashed border-transparent hover:border-accent/40 hover:bg-accent-subtle/30 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
          !repositioning && "group",
          editable && !repositioning && "cursor-pointer",
          repositioning && "cursor-grab active:cursor-grabbing"
        )}
        // The container is tap-to-open as the primary touch-device
        // affordance (mobile users can't hover to reveal the action row).
        // When a cover exists, keyboard and screen-reader users interact
        // via the inline action buttons instead, so the container is NOT
        // exposed as a button in that case — avoids a duplicate accessible
        // name with the inline "Change cover" button.
        onClick={editable && !repositioning && !uploading ? openPicker : undefined}
        role={editable && !displayUrl && !repositioning ? "button" : undefined}
        tabIndex={editable && !displayUrl && !repositioning ? 0 : undefined}
        aria-label={
          repositioning
            ? "Drag to reposition cover image"
            : editable && !displayUrl
              ? "Add cover image"
              : undefined
        }
        onKeyDown={
          editable && !displayUrl && !repositioning && !uploading
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPicker();
                }
              }
            : undefined
        }
        onMouseDown={repositioning ? handleMouseDown : undefined}
        onTouchStart={repositioning ? handleTouchStart : undefined}
      >
        {/* Image — when coverSrcSet is provided (Unsplash covers with a
              rawUrl), we serve multi-width renditions and let the browser
              pick the right one. sizes="100vw" tells it the image can fill
              the viewport — a safe upper bound; the browser never picks a
              larger rendition than that. For R2 uploads (single resolution),
              coverSrcSet is null and we fall through to plain `src`. */}
        {displayUrl && (
          <img
            src={displayUrl}
            srcSet={coverSrcSet ?? undefined}
            sizes={coverSrcSet ? "100vw" : undefined}
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

            {/* With cover: action overlay.
                  - `pointer-events-none` on each action button until hover/
                    focus-within prevents stray taps from triggering the
                    invisible buttons on touch devices (where :hover fires
                    simultaneously with the landing click). Without this,
                    tapping roughly-centered on the cover could land on the
                    Remove button and nuke the cover instantly.
                  - Each button explicitly stops propagation so it doesn't
                    also trigger the container's tap-to-open-picker. */}
            {displayUrl && (
              <div className="absolute inset-0 flex items-center justify-center gap-r5 bg-black/0 transition-all duration-fast group-hover:bg-black/40 group-focus-within:bg-black/40 z-10">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPicker();
                  }}
                  className={cn(COVER_ACTION_CHIP_CLASS, "text-fg-primary")}
                  aria-label="Change cover image"
                >
                  <Pencil size={14} />
                  Change cover
                </button>
                {onPositionChange && (
                  <button
                    type="button"
                    onClick={enterReposition}
                    className={cn(COVER_ACTION_CHIP_CLASS, "text-fg-primary")}
                    aria-label="Reposition cover image"
                  >
                    <GripVertical size={14} />
                    Reposition
                  </button>
                )}
                <button
                  type="button"
                  onClick={requestRemove}
                  className={cn(COVER_ACTION_CHIP_CLASS, "text-status-error")}
                  aria-label="Remove cover image"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              </div>
            )}
          </>
        )}

        {/* Unsplash photographer attribution.
              - Required by the Unsplash API guidelines on every displayed photo.
              - Hidden during reposition / uploading so action chrome has room.
              - Dims slightly on group-hover so the action buttons remain the
                primary interactive surface without occluding credit.
              - Links already have UTM params appended server-side — never
                re-append here. `noopener noreferrer` prevents window.opener
                leakage. */}
        {showAttribution && (
          <div
            className={cn(
              "absolute top-0 right-0 z-20 max-w-[80%] p-r6",
              "pointer-events-none",
              // Hidden until the cover is hovered/focused. Unsplash's
              // guidelines require attribution on display but don't mandate
              // it be permanently visible — revealing on hover matches
              // Notion/Figma/Trello's pattern and keeps the cover clean.
              // Keyboard users get the chip via :focus-within on the
              // container's links.
              "opacity-0 transition-opacity duration-fast",
              "group-hover:opacity-100 group-focus-within:opacity-100"
            )}
          >
            <div
              className={cn(
                "inline-flex items-center rounded bg-black/50 px-r6 py-[2px]",
                "text-xs leading-tight text-white/90 backdrop-blur-sm pointer-events-auto",
                "max-w-full truncate"
              )}
            >
              <span className="truncate">
                Photo by{" "}
                <a
                  href={coverAttribution.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {coverAttribution.name}
                </a>
                {" on "}
                <a
                  href={coverAttribution.photoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Unsplash
                </a>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Safety-net validation error (picker catches most cases). */}
      {safetyError && <p className="mt-r6 text-body-3 text-status-error">{safetyError}</p>}

      {editable && (
        <CoverImagePicker
          open={pickerOpen}
          onClose={closePicker}
          onUploadFile={handlePickerUpload}
          onSelectUnsplash={handlePickerUnsplash}
        />
      )}

      {editable && (
        <ConfirmDialog
          open={removeConfirmOpen}
          onClose={cancelRemove}
          onConfirm={confirmRemove}
          title="Remove cover image?"
          confirmLabel="Remove"
          confirmingLabel="Removing..."
        >
          This will clear the cover. You can always set a new one later.
        </ConfirmDialog>
      )}
    </div>
  );
});
