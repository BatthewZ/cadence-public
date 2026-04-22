import { ExternalLink, ImagePlus, Loader2, RefreshCw, UploadCloud, X } from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { buildUnsplashDisplayUrl } from "@/shared/lib/unsplash-display";
import type { UnsplashCoverPayload } from "@/shared/schemas/unsplash";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_SIZE } from "@/shared/schemas/upload";
import { SearchInput } from "@/web/components/form/SearchInput";
import { Select } from "@/web/components/form/Select";
import { useFeatures } from "@/web/hooks/use-features";
import { useFileUpload } from "@/web/hooks/use-file-upload";
import {
  type UnsplashOrientation,
  useUnsplashSearch,
} from "@/web/hooks/use-unsplash-search";
import { formatBytes } from "@/web/util/format";
import { COVER_PRESET, isAnimatedGif, optimizeImage } from "@/web/util/image-optimization";
import { cn } from "@/web/util/style/style";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Skeleton } from "./Skeleton";
import { Tabs } from "./Tabs";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CoverTabValue = "upload" | "unsplash";

interface CoverImagePickerProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user chooses a local file. Parent wires the actual upload. */
  onUploadFile: (file: File) => void;
  /** Called when the user picks an Unsplash photo. Parent wires the apply call. */
  onSelectUnsplash: (payload: UnsplashCoverPayload) => void;
  /**
   * Optional initial tab. When omitted, the picker defaults to the Unsplash tab
   * if the feature flag is enabled, and the Upload tab otherwise.
   */
  initialTab?: CoverTabValue;
}

const ACCEPT_STRING = ALLOWED_IMAGE_TYPES.join(",");

const ORIENTATION_LABELS: Record<"any" | UnsplashOrientation, string> = {
  any: "Any orientation",
  landscape: "Landscape",
  portrait: "Portrait",
  squarish: "Square",
};

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

/**
 * Modal picker that lets the user choose a cover image from either a local
 * upload or the Unsplash library.
 *
 * The component is controlled (`open` / `onClose`) so the parent can coordinate
 * picker state with surrounding flows (e.g. closing alongside a mutation). The
 * Unsplash tab is only rendered when `useFeatures().data?.unsplash` is true —
 * when the integration is disabled server-side, the picker collapses to a
 * single-panel upload dialog without the user ever seeing a broken tab.
 *
 * Why the Unsplash query is lazy: the hook only fires when the picker is open
 * AND the Unsplash tab is active. This matches the plan's "users who never
 * open the picker never hit the API" constraint — important because the
 * Unsplash rate limit is shared across the entire workspace.
 */
export function CoverImagePicker({
  open,
  onClose,
  onUploadFile,
  onSelectUnsplash,
  initialTab,
}: CoverImagePickerProps) {
  const features = useFeatures();
  const unsplashEnabled = features.data?.unsplash === true;

  const resolvedInitial: CoverTabValue =
    initialTab ?? (unsplashEnabled ? "unsplash" : "upload");

  const [activeTab, setActiveTab] = useState<CoverTabValue>(resolvedInitial);
  // Track previous `open` so we can reset the tab to the computed default on
  // close→open transitions without running a `setState-in-effect` — see the
  // Tabs.tsx primitive for the same pattern. `setState` during render is
  // allowed as long as it's guarded by an equality check that eventually
  // settles.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      // Reset for next open.
      setActiveTab(resolvedInitial);
    }
  }
  // Secondary guard: if the feature flag loads late AND the user is stuck on
  // a now-unavailable Unsplash tab, fall back to Upload.
  if (!unsplashEnabled && activeTab === "unsplash") {
    setActiveTab("upload");
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className={cn(
        // Widen the default 40rem dialog so the 3-column photo grid has room.
        // Why no `flex` on the <dialog> itself: `display: flex` overrides the
        // native `display: none` that the browser applies to a closed <dialog>,
        // causing the element to render on page load even when `open` is false.
        // The layout flexbox lives on the inner wrapper instead.
        "max-w-[64rem] h-[min(80vh,40rem)] p-0"
      )}
      aria-labelledby="cover-image-picker-title"
    >
      <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-r4 px-r3 py-r4 border-b border-border-default shrink-0">
        <h2
          id="cover-image-picker-title"
          className="text-body-1 font-semibold text-fg-primary"
        >
          Set cover image
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn(
            "inline-flex items-center justify-center rounded-md p-r6 duration-fast cursor-pointer",
            "text-fg-secondary hover:bg-surface-2 active:bg-surface-3",
            "ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-0",
          )}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as CoverTabValue)}
        defaultValue={resolvedInitial}
        variant="underline"
        className="flex-1 min-h-0 flex flex-col"
      >
        {/* Only render the tab list when the Unsplash tab is available — when
            the feature is off there's only one panel and a bare list would be
            visual noise. */}
        {unsplashEnabled ? (
          <div className="px-r3 pt-r5 shrink-0">
            <Tabs.List>
              <Tabs.Tab value="upload">Upload</Tabs.Tab>
              <Tabs.Tab value="unsplash">Unsplash</Tabs.Tab>
            </Tabs.List>
          </div>
        ) : null}

        <Tabs.Panel
          value="upload"
          className="flex-1 min-h-0 overflow-hidden px-r3 py-r4"
        >
          <UploadPanel
            onUploaded={(file) => {
              onUploadFile(file);
              onClose();
            }}
          />
        </Tabs.Panel>

        {unsplashEnabled ? (
          <Tabs.Panel
            value="unsplash"
            className="flex-1 min-h-0 overflow-hidden flex flex-col"
          >
            <UnsplashPanel
              active={open && activeTab === "unsplash"}
              onSelect={(payload) => {
                onSelectUnsplash(payload);
                onClose();
              }}
            />
          </Tabs.Panel>
        ) : null}
      </Tabs>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Upload panel                                                       */
/* ------------------------------------------------------------------ */

interface UploadPanelProps {
  onUploaded: (file: File) => void;
}

/**
 * Drop-zone / browse panel. Validates the file client-side before running it
 * through the shared image optimizer — animated GIFs bypass optimization so
 * we don't lose the animation (Canvas flattens to a single frame).
 */
function UploadPanel({ onUploaded }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { validate } = useFileUpload();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      const validationError = validate(file, {
        accept: ALLOWED_IMAGE_TYPES,
        maxSize: MAX_UPLOAD_SIZE,
      });
      if (validationError) {
        setError(validationError.message);
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const animated = await isAnimatedGif(file).catch(() => false);
        const toUpload = animated
          ? file
          : await optimizeImage(file, COVER_PRESET).catch(() => file);
        onUploaded(toUpload);
      } finally {
        setBusy(false);
      }
    },
    [validate, onUploaded],
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so selecting the same file again re-triggers onChange.
      e.target.value = "";
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const openFilePicker = useCallback(() => {
    if (busy) return;
    inputRef.current?.click();
  }, [busy]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (busy) return;
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [busy, handleFile],
  );

  return (
    <div className="h-full flex flex-col gap-r4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload cover image"
        aria-disabled={busy || undefined}
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-drag-over={dragOver || undefined}
        data-busy={busy || undefined}
        className={cn(
          "flex-1 flex flex-col items-center justify-center gap-r5 min-h-0",
          "rounded-lg border-2 border-dashed border-border-strong",
          "bg-surface-1 text-fg-secondary cursor-pointer duration-fast",
          "hover:bg-surface-2 hover:border-fg-muted",
          "data-[drag-over]:bg-accent-subtle data-[drag-over]:border-accent data-[drag-over]:text-accent",
          "data-[busy]:opacity-60 data-[busy]:cursor-progress",
          "ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2 focus:outline-none",
        )}
      >
        {busy ? (
          <Loader2 size={36} className="animate-spin" aria-hidden="true" />
        ) : (
          <UploadCloud size={36} aria-hidden="true" />
        )}
        <div className="text-center">
          <p className="text-body-1 font-semibold text-fg-primary">
            {busy ? "Preparing image..." : "Drop an image or click to browse"}
          </p>
          <p className="text-body-3 text-fg-muted mt-r6">
            JPEG, PNG, GIF, or WebP. Up to {formatBytes(MAX_UPLOAD_SIZE)}.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_STRING}
          onChange={handleInputChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      <div aria-live="polite" className="min-h-[1.5rem]">
        {error ? (
          <Alert variant="error" role="alert">
            {error}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Unsplash panel                                                     */
/* ------------------------------------------------------------------ */

interface UnsplashPanelProps {
  active: boolean;
  onSelect: (payload: UnsplashCoverPayload) => void;
}

type OrientationValue = "any" | UnsplashOrientation;

/**
 * Search + infinite-scroll grid of Unsplash photos.
 *
 * The hook is gated on `active` — see the picker docstring for the rationale
 * (no background Unsplash traffic on mount). The orientation filter defaults
 * to "landscape" because covers render wider-than-tall everywhere in the app;
 * users who want a portrait shot can switch.
 */
function UnsplashPanel({ active, onSelect }: UnsplashPanelProps) {
  const [query, setQuery] = useState("");
  const [orientation, setOrientation] = useState<OrientationValue>("landscape");

  const search = useUnsplashSearch({
    query,
    orientation: orientation === "any" ? undefined : orientation,
    enabled: active,
  });

  const {
    results,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isCurated,
    debouncedQuery,
  } = search;

  /* -- Infinite scroll sentinel -------------------------------------- */

  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    if (!active) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }
      },
      { root, rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [active, hasNextPage, isFetchingNextPage, fetchNextPage]);

  /* -- Derived state ------------------------------------------------- */

  const showEmpty =
    !isLoading && !isError && results.length === 0 && debouncedQuery.length > 0;
  const showCuratedEmpty =
    !isLoading && !isError && results.length === 0 && isCurated;

  return (
    <>
      {/* Sticky search row */}
      <div
        className={cn(
          "sticky top-0 z-10 flex flex-col gap-r5 px-r3 py-r4",
          "border-b border-border-default bg-surface-0 shrink-0",
          "sm:flex-row sm:items-center",
        )}
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search Unsplash (e.g. mountains, focus, workspace)"
          className="flex-1"
        />
        <Select
          value={orientation}
          onChange={(e) => setOrientation(e.target.value as OrientationValue)}
          aria-label="Orientation filter"
          className="sm:w-[14rem]"
        >
          {(["landscape", "portrait", "squarish", "any"] as const).map((v) => (
            <option key={v} value={v}>
              {ORIENTATION_LABELS[v]}
            </option>
          ))}
        </Select>
      </div>

      {/* Scrollable grid */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-r3 py-r4"
        aria-live="polite"
      >
        {isError ? (
          <Alert variant="error" className="flex-col items-start gap-r5">
            <div>
              {error?.message ??
                "Unsplash is unavailable right now. Please try again."}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => refetch()}
            >
              <RefreshCw size={14} className="mr-r6" aria-hidden="true" />
              Retry
            </Button>
          </Alert>
        ) : isLoading ? (
          <PhotoGridSkeleton />
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-r5 py-r1 text-center">
            <ImagePlus size={32} className="text-fg-muted" aria-hidden="true" />
            <p className="text-body-2 text-fg-secondary">
              No photos match that search.
            </p>
            <p className="text-body-3 text-fg-muted">
              Try a broader term, or clear the search to see curated picks.
            </p>
          </div>
        ) : showCuratedEmpty ? (
          <div className="flex flex-col items-center justify-center gap-r5 py-r1 text-center">
            <ImagePlus size={32} className="text-fg-muted" aria-hidden="true" />
            <p className="text-body-2 text-fg-secondary">
              No curated photos available right now.
            </p>
          </div>
        ) : (
          <>
            <PhotoGrid photos={results} onSelect={onSelect} />
            <div
              ref={sentinelRef}
              aria-hidden="true"
              data-testid="unsplash-picker-sentinel"
              className="h-r1 w-full"
            />
            {isFetchingNextPage ? (
              <div className="flex items-center justify-center py-r3 text-body-3 text-fg-muted">
                <Loader2 size={16} className="animate-spin mr-r6" aria-hidden="true" />
                Loading more photos...
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Attribution footer — required by the Unsplash API guidelines. */}
      <div className="px-r3 py-r5 border-t border-border-default bg-surface-1 text-body-3 text-fg-muted shrink-0">
        Photos provided by{" "}
        <a
          href="https://unsplash.com/?utm_source=cadence&utm_medium=referral"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Unsplash
        </a>
        .
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Photo grid                                                         */
/* ------------------------------------------------------------------ */

interface PhotoGridProps {
  photos: UnsplashCoverPayload[];
  onSelect: (payload: UnsplashCoverPayload) => void;
}

function PhotoGrid({ photos, onSelect }: PhotoGridProps) {
  return (
    <ul
      role="listbox"
      aria-label="Unsplash photos"
      className="grid gap-r4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    >
      {photos.map((photo) => (
        <li key={photo.id} className="list-none">
          <PhotoCard photo={photo} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Photo card                                                         */
/* ------------------------------------------------------------------ */

interface PhotoCardProps {
  photo: UnsplashCoverPayload;
  onSelect: (payload: UnsplashCoverPayload) => void;
}

/**
 * Single Unsplash photo card.
 *
 * Attribution rules (why we do this and why it's non-negotiable):
 * - Unsplash's API guidelines mandate a visible photographer credit on every
 *   displayed photo, with a link to the photographer's profile. Breaking this
 *   can get the integration's API key revoked.
 * - Links must use target="_blank" + rel="noopener noreferrer" to prevent the
 *   tab from getting window.opener access (standard security hardening).
 * - The utm_source / utm_medium params are already appended server-side in
 *   `toCoverPayload` — do NOT duplicate them here.
 *
 * The outer element is a <button> for clean keyboard activation (Space/Enter);
 * the photographer credit is a separate anchor nested inside. Clicking the
 * credit doesn't select the photo — stopPropagation on the anchor ensures the
 * user can open the profile without triggering selection.
 */
function PhotoCard({ photo, onSelect }: PhotoCardProps) {
  const description = photo.description ?? `Photo by ${photo.user.name}`;

  return (
    <div
      className={cn(
        "group relative rounded-lg overflow-hidden",
        "bg-surface-2 border border-border-default",
        "ring-2 ring-transparent duration-fast",
        "focus-within:ring-border-focus focus-within:ring-offset-2",
        "hover:border-fg-muted",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(photo)}
        aria-label={`Use photo by ${photo.user.name}`}
        className={cn(
          "block w-full cursor-pointer text-left",
          "focus:outline-none",
        )}
        style={{ aspectRatio: "3 / 2" }}
      >
        <img
          src={buildUnsplashDisplayUrl(photo, "card")}
          alt={description}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="w-full h-full object-cover duration-fast group-hover:scale-[1.02]"
          style={{ backgroundColor: photo.color ?? undefined }}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0",
            "opacity-80 group-hover:opacity-100 duration-fast",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 top-0 flex justify-end p-r5",
            "opacity-0 group-hover:opacity-100 duration-fast",
          )}
        >
          <span className="inline-flex items-center gap-r6 rounded-md bg-black/60 px-r5 py-r6 text-body-3 font-medium text-white">
            Use this photo
          </span>
        </span>
      </button>

      {/* Photographer credit — required attribution. Sits above the button
          visually but is a separate interactive element so the user can open
          the profile without selecting the photo. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center justify-between gap-r5",
          "px-r4 py-r5 text-body-3",
        )}
      >
        <a
          href={photo.user.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-r6 max-w-full truncate",
            "text-white/90 hover:text-white hover:underline",
            "pointer-events-auto",
          )}
        >
          <span className="truncate font-medium">{photo.user.name}</span>
        </a>
        <a
          href={photo.photoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`View photo by ${photo.user.name} on Unsplash`}
          className={cn(
            "inline-flex items-center gap-r6 text-white/80 hover:text-white",
            "pointer-events-auto",
          )}
        >
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton grid                                                      */
/* ------------------------------------------------------------------ */

const SKELETON_KEYS = Array.from({ length: 9 }, (_, i) => `sk-${i}`);

function PhotoGridSkeleton() {
  return (
    <div
      className="grid gap-r4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Loading photos"
    >
      {SKELETON_KEYS.map((key) => (
        <Skeleton
          key={key}
          variant="rounded"
          className="w-full"
          style={{ aspectRatio: "3 / 2", height: "auto" }}
        />
      ))}
    </div>
  );
}
