import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

import { IconButton } from "./IconButton";

export type ToastVariant = "success" | "warning" | "error" | "info";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

const baseClasses =
  "flex items-start gap-r5 rounded-md p-r4 text-body-2 shadow-lg border w-80 pointer-events-auto";

const variantClassMap: Record<ToastVariant, string> = {
  success: "bg-status-success-bg text-status-success border-status-success/20",
  warning: "bg-status-warning-bg text-status-warning border-status-warning/20",
  error: "bg-status-error-bg text-status-error border-status-error/20",
  info: "bg-status-info-bg text-status-info border-status-info/20",
};

const ariaMap: Record<
  ToastVariant,
  { role: "status" | "alert"; "aria-live": "polite" | "assertive" }
> = {
  success: { role: "status", "aria-live": "polite" },
  warning: { role: "status", "aria-live": "polite" },
  info: { role: "status", "aria-live": "polite" },
  error: { role: "alert", "aria-live": "assertive" },
};

type ToastProps = {
  variant?: ToastVariant;
  title?: string;
  action?: ToastAction;
  onDismiss: () => void;
  dismissing?: boolean;
} & Omit<ComponentPropsWithRef<"div">, "title">;

export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  { variant = "info", title, action, onDismiss, dismissing = false, className, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        baseClasses,
        variantClassMap[variant],
        dismissing ? "animate-slide-out-right" : "animate-slide-in-right",
        className
      )}
      {...ariaMap[variant]}
      {...props}
    >
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <p>{children}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            onDismiss();
          }}
          className="shrink-0 self-center rounded px-r4 py-r6 text-label-2 font-semibold underline underline-offset-2 opacity-90 transition-opacity hover:opacity-100"
        >
          {action.label}
        </button>
      )}
      <IconButton aria-label="Dismiss" onClick={onDismiss} className="shrink-0 -mr-r6 -mt-r6">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </IconButton>
    </div>
  );
});
