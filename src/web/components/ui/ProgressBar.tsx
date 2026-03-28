import { type ComponentPropsWithRef, forwardRef } from "react";

import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  ProgressBar (root)                                                 */
/* ------------------------------------------------------------------ */

type ProgressBarRootProps = {
  value: number;
  max?: number;
  variant?: "default" | "gradient" | "striped";
  color?: "accent" | "success" | "warning" | "error";
  size?: "sm" | "md" | "lg";
  animate?: boolean;
} & Omit<ComponentPropsWithRef<"div">, "children">;

type ProgressBarSize = NonNullable<ProgressBarRootProps["size"]>;
type ProgressBarColor = NonNullable<ProgressBarRootProps["color"]>;
type ProgressBarVariant = NonNullable<ProgressBarRootProps["variant"]>;

const sizeClass: Record<ProgressBarSize, string> = {
  sm: "progress-bar--sm",
  md: "progress-bar--md",
  lg: "progress-bar--lg",
};

const colorClass: Record<ProgressBarColor, string> = {
  accent: "progress-bar__fill--accent",
  success: "progress-bar__fill--success",
  warning: "progress-bar__fill--warning",
  error: "progress-bar__fill--error",
};

const variantFillClass: Record<ProgressBarVariant, string | undefined> = {
  default: undefined,
  gradient: "progress-bar__fill--gradient",
  striped: "progress-bar__fill--striped",
};

const ProgressBarRoot = forwardRef<HTMLDivElement, ProgressBarRootProps>(function ProgressBar(
  {
    value,
    max = 100,
    variant = "default",
    color = "accent",
    size = "md",
    animate = true,
    className,
    ...props
  },
  ref
) {
  const reducedMotion = usePrefersReducedMotion();
  const percentage = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const shouldAnimate = animate && !reducedMotion;

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("progress-bar", sizeClass[size], className)}
      {...props}
    >
      <div
        className={cn(
          "progress-bar__fill",
          colorClass[color],
          variantFillClass[variant],
          !shouldAnimate && "progress-bar__fill--no-animate"
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  ProgressBar.Label                                                  */
/* ------------------------------------------------------------------ */

type ProgressBarLabelProps = ComponentPropsWithRef<"span">;

const ProgressBarLabel = forwardRef<HTMLSpanElement, ProgressBarLabelProps>(
  function ProgressBarLabel({ className, ...props }, ref) {
    return <span ref={ref} className={cn("progress-bar__label", className)} {...props} />;
  }
);

/* ------------------------------------------------------------------ */
/*  ProgressBar.Value                                                  */
/* ------------------------------------------------------------------ */

type ProgressBarValueProps = ComponentPropsWithRef<"span">;

const ProgressBarValue = forwardRef<HTMLSpanElement, ProgressBarValueProps>(
  function ProgressBarValue({ className, ...props }, ref) {
    return <span ref={ref} className={cn("progress-bar__value", className)} {...props} />;
  }
);

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const ProgressBar = Object.assign(ProgressBarRoot, {
  Label: ProgressBarLabel,
  Value: ProgressBarValue,
});
