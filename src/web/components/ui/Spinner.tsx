import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Size = "sm" | "md" | "lg";

const baseClasses = "animate-spin rounded-full border-2 border-current border-t-transparent";

const sizeClassMap: Record<Size, string> = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

type SpinnerProps = {
  size?: Size;
} & Omit<ComponentPropsWithRef<"div">, "size" | "children">;

export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(function Spinner(
  { size = "md", className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      role="status"
      className={cn(baseClasses, sizeClassMap[size], className)}
      {...props}
    >
      <span className="sr-only">Loading</span>
    </div>
  );
});
