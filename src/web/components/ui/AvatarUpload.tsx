import { type ComponentPropsWithRef, forwardRef, useCallback, useRef, useState } from "react";

import {
  ALLOWED_IMAGE_TYPES,
  MAX_AVATAR_SIZE,
} from "@/shared/schemas/upload";
import { useFileUpload } from "@/web/hooks/use-file-upload";
import { AVATAR_PRESET, isAnimatedGif, optimizeImage } from "@/web/util/image-optimization";
import { cn } from "@/web/util/style/style";

import { Avatar } from "./Avatar";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface UploadResult {
  upload: {
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  };
}

type AvatarUploadProps = {
  /** Current avatar image URL. */
  src?: string | null;
  /** User display name (used for initials fallback). */
  name?: string;
  /** Avatar size — defaults to `"xl"`. */
  size?: AvatarSize;
  /** Called after a successful upload with the response data. */
  onUploadComplete?: (data: UploadResult) => void;
} & Omit<ComponentPropsWithRef<"div">, "children">;

/* ------------------------------------------------------------------ */
/*  Size mappings                                                      */
/* ------------------------------------------------------------------ */

const containerSizeMap: Record<AvatarSize, string> = {
  xs: "size-6",
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-16",
};

/* ------------------------------------------------------------------ */
/*  Camera icon SVG                                                    */
/* ------------------------------------------------------------------ */

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const AvatarUpload = forwardRef<HTMLDivElement, AvatarUploadProps>(function AvatarUpload(
  { src, name, size = "xl", onUploadComplete, className, ...props },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, upload, validate, error: uploadError } = useFileUpload<UploadResult>();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const error = validationError ?? uploadError;
  const displaySrc = previewUrl ?? src;

  const handleClick = useCallback(() => {
    if (state !== "uploading") inputRef.current?.click();
  }, [state]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && state !== "uploading") {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    [state],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset input so re-selecting the same file works.
      e.target.value = "";
      if (!file) return;

      setValidationError(null);

      // Validate before uploading.
      const vError = validate(file, {
        accept: ALLOWED_IMAGE_TYPES,
        maxSize: MAX_AVATAR_SIZE,
      });

      if (vError) {
        setValidationError(vError.message);
        return;
      }

      // Optimize before upload: resize + WebP conversion.
      // Animated GIFs pass through unchanged to preserve animation.
      let fileToUpload = file;
      try {
        const animated = await isAnimatedGif(file);
        if (!animated) {
          fileToUpload = await optimizeImage(file, AVATAR_PRESET);
        }
      } catch {
        // Optimization failed — upload original
      }

      // Show optimistic preview (use original for instant display).
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      const result = await upload(fileToUpload, {
        endpoint: "/api/users/me/avatar",
        method: "put",
        fieldName: "file",
      });

      if (result) {
        // Update preview to the permanent URL.
        setPreviewUrl(result.upload.url);
        onUploadComplete?.(result);
      } else {
        // Revert optimistic preview on failure.
        setPreviewUrl(null);
      }

      URL.revokeObjectURL(objectUrl);
    },
    [validate, upload, onUploadComplete],
  );

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label="Change avatar"
      className={cn("group relative inline-flex cursor-pointer", containerSizeMap[size], className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {/* Avatar display */}
      <Avatar src={displaySrc} name={name} size={size} className="size-full" />

      {/* Hover overlay */}
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-full",
          "bg-black/50 text-white opacity-0 transition-opacity duration-fast",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
          state === "uploading" && "opacity-100",
        )}
        aria-hidden="true"
      >
        {state === "uploading" ? (
          <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <CameraIcon />
        )}
      </span>

      {/* Focus ring */}
      <span
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full ring-2 ring-transparent",
          "group-focus-visible:ring-border-focus group-focus-visible:ring-offset-2",
        )}
        aria-hidden="true"
      />

      {/* Error tooltip */}
      {error && (
        <span
          className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-status-error px-2 py-1 text-body-3 text-fg-inverse"
          role="alert"
        >
          {error}
        </span>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        onChange={(e) => void handleFileChange(e)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
});
