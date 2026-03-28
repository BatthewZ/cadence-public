import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Variant = "success" | "warning" | "error" | "info";

const baseClasses = "flex gap-r5 rounded-md p-r4 text-body-2";

const variantClassMap: Record<Variant, string> = {
  success: "bg-status-success-bg text-status-success border border-status-success/20",
  warning: "bg-status-warning-bg text-status-warning border border-status-warning/20",
  error: "bg-status-error-bg text-status-error border border-status-error/20",
  info: "bg-status-info-bg text-status-info border border-status-info/20",
};

type AlertProps = {
  variant?: Variant;
} & ComponentPropsWithRef<"div">;

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { variant = "info", className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      role="alert"
      aria-live="polite"
      className={cn(baseClasses, variantClassMap[variant], className)}
      {...props}
    />
  );
});
