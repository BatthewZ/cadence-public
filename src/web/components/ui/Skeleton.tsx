import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Variant = "text" | "circular" | "rectangular" | "rounded";

const variantClassMap: Record<Variant, string> = {
  text: "skeleton--text",
  circular: "skeleton--circular",
  rectangular: "",
  rounded: "skeleton--rounded",
};

type SkeletonProps = {
  variant?: Variant;
  width?: string | number;
  height?: string | number;
} & Omit<ComponentPropsWithRef<"span">, "children">;

export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  { variant = "text", width = "100%", height, className, style, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      role="status"
      aria-label="Loading"
      className={cn("skeleton", variantClassMap[variant], className)}
      style={{ width, height, ...style }}
      {...props}
    >
      <span className="sr-only">Loading</span>
    </span>
  );
});

const SKELETON_COUNT = [1, 2, 3] as const;

/** Placeholder skeleton for a list of comment cards while loading. */
export function CommentSkeletonList() {
  return (
    <>
      {SKELETON_COUNT.map((i) => (
        <div key={i} className="rounded-md border border-border-default p-r4">
          <div className="flex items-center gap-r5 mb-r6">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16 ml-auto" />
          </div>
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </>
  );
}
