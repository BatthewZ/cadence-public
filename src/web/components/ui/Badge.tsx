import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Variant = "default" | "success" | "warning" | "error" | "info";

const baseClasses = "inline-flex items-center rounded-sm px-r5 py-r6 text-body-3 font-semibold";

const variantClassMap: Record<Variant, string> = {
  default: "bg-surface-2 text-fg-secondary",
  success: "bg-status-success-bg text-status-success",
  warning: "bg-status-warning-bg text-status-warning",
  error: "bg-status-error-bg text-status-error",
  info: "bg-status-info-bg text-status-info",
};

type BadgeProps = {
  variant?: Variant;
} & ComponentPropsWithRef<"span">;

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = "default", className, ...props },
  ref
) {
  return (
    <span ref={ref} className={cn(baseClasses, variantClassMap[variant], className)} {...props} />
  );
});
