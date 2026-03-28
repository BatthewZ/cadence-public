import {
  Children,
  type ComponentPropsWithRef,
  forwardRef,
  type ReactElement,
  useState,
} from "react";

import { cn } from "@/web/util/style/style";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
type AvatarStatus = "online" | "offline" | "away";

const sizeClassMap: Record<AvatarSize, string> = {
  xs: "size-6",
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-16",
};

const initialsTextMap: Record<AvatarSize, string> = {
  xs: "text-[10px]",
  sm: "text-body-3",
  md: "text-body-2",
  lg: "text-body-1",
  xl: "text-h3",
};

const statusDotSizeMap: Record<AvatarSize, string> = {
  xs: "size-2",
  sm: "size-2",
  md: "size-2.5",
  lg: "size-3",
  xl: "size-3",
};

const statusColorMap: Record<AvatarStatus, string> = {
  online: "bg-status-success",
  offline: "bg-surface-3",
  away: "bg-status-warning",
};

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/);
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

type AvatarProps = {
  src?: string | null;
  alt?: string;
  name?: string;
  size?: AvatarSize;
  status?: AvatarStatus;
} & ComponentPropsWithRef<"span">;

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { src, alt, name, size = "md", status, className, ...props },
  ref
) {
  const [imgError, setImgError] = useState(false);
  const showImage = src && !imgError;
  const initials = name ? getInitials(name) : "";
  const label = alt ?? name;

  return (
    <span
      ref={ref}
      role="img"
      aria-label={label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        sizeClassMap[size],
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-flex size-full items-center justify-center overflow-hidden rounded-full",
          !showImage && "bg-surface-2 text-fg-secondary font-semibold",
          !showImage && initialsTextMap[size]
        )}
      >
        {showImage ? (
          <img
            src={src}
            alt={label ?? ""}
            onError={() => setImgError(true)}
            className="size-full object-cover"
          />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
      </span>
      {status && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-2 ring-surface-0",
            statusDotSizeMap[size],
            statusColorMap[status]
          )}
        />
      )}
    </span>
  );
});

// --- AvatarGroup ---

const groupOverlapMap: Record<AvatarSize, string> = {
  xs: "-space-x-1.5",
  sm: "-space-x-2",
  md: "-space-x-2.5",
  lg: "-space-x-3",
  xl: "-space-x-3.5",
};

type AvatarGroupProps = {
  max?: number;
  size?: AvatarSize;
} & ComponentPropsWithRef<"div">;

export const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(function AvatarGroup(
  { max, size = "md", className, children, ...props },
  ref
) {
  const childArray = Children.toArray(children) as ReactElement[];
  const visibleCount = max != null && childArray.length > max ? max : childArray.length;
  const overflowCount = childArray.length - visibleCount;

  return (
    <div ref={ref} className={cn("flex items-center", groupOverlapMap[size], className)} {...props}>
      {childArray.slice(0, visibleCount).map((child) => (
        <span key={child.key} className="ring-2 ring-surface-0 rounded-full">
          {child}
        </span>
      ))}
      {overflowCount > 0 && (
        <span
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-secondary font-semibold ring-2 ring-surface-0",
            sizeClassMap[size],
            initialsTextMap[size]
          )}
        >
          +{overflowCount}
        </span>
      )}
    </div>
  );
});
