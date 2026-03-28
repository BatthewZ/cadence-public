import {
  type ComponentPropsWithRef,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";
import { mergeRefs } from "@/web/util/merge-refs";
import { cn } from "@/web/util/style/style";

const defaultFormat = new Intl.NumberFormat();

/* ------------------------------------------------------------------ */
/*  StatCard (root)                                                    */
/* ------------------------------------------------------------------ */

type StatCardRootProps = ComponentPropsWithRef<"div">;

const StatCardRoot = forwardRef<HTMLDivElement, StatCardRootProps>(function StatCard(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn("stat-card", className)} {...props} />;
});

/* ------------------------------------------------------------------ */
/*  StatCard.Value                                                     */
/* ------------------------------------------------------------------ */

type StatCardValueProps = {
  animateValue?: boolean;
  from?: number;
  to?: number;
  format?: (value: number) => string;
  duration?: number;
} & ComponentPropsWithRef<"span">;

const StatCardValue = forwardRef<HTMLSpanElement, StatCardValueProps>(function StatCardValue(
  { animateValue = false, from = 0, to, format, duration, className, children, ...props },
  ref
) {
  const reducedMotion = usePrefersReducedMotion();
  const innerRef = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);
  const [displayValue, setDisplayValue] = useState<string | null>(null);

  const formatValue = useCallback(
    (v: number) => (format ? format(v) : defaultFormat.format(v)),
    [format]
  );

  // Reduced motion: derive final value directly without effect
  const reducedMotionValue =
    animateValue && to !== undefined && reducedMotion ? formatValue(to) : null;

  useEffect(() => {
    if (!animateValue || to === undefined || reducedMotion) return;

    const target = to;
    const el = innerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || hasAnimated.current) return;
        hasAnimated.current = true;
        observer.disconnect();

        // Read duration from CSS custom property or use prop
        const ms =
          duration ??
          (parseFloat(getComputedStyle(el).getPropertyValue("--MOTION-DURATION-SHIFT")) || 400);

        const startTime = performance.now();
        const range = target - from;

        function tick(now: number) {
          const elapsed = now - startTime;
          const t = Math.min(elapsed / ms, 1);
          // Cubic ease-out: 1 - (1 - t)^3
          const eased = 1 - Math.pow(1 - t, 3);
          const current = from + range * eased;

          setDisplayValue(formatValue(Math.round(current)));

          if (t < 1) {
            requestAnimationFrame(tick);
          } else {
            setDisplayValue(formatValue(target));
          }
        }

        requestAnimationFrame(tick);
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [animateValue, from, to, duration, reducedMotion, formatValue]);

  return (
    <span ref={mergeRefs(ref, innerRef)} className={cn("stat-card__value", className)} {...props}>
      {animateValue && to !== undefined
        ? (reducedMotionValue ?? displayValue ?? formatValue(from))
        : children}
    </span>
  );
});

/* ------------------------------------------------------------------ */
/*  StatCard.Label                                                     */
/* ------------------------------------------------------------------ */

type StatCardLabelProps = ComponentPropsWithRef<"span">;

const StatCardLabel = forwardRef<HTMLSpanElement, StatCardLabelProps>(function StatCardLabel(
  { className, ...props },
  ref
) {
  return <span ref={ref} className={cn("stat-card__label", className)} {...props} />;
});

/* ------------------------------------------------------------------ */
/*  StatCard.Trend                                                     */
/* ------------------------------------------------------------------ */

type StatCardTrendProps = {
  value: number;
  direction: "up" | "down" | "neutral";
} & Omit<ComponentPropsWithRef<"span">, "children">;

const directionClass: Record<string, string> = {
  up: "stat-card__trend--up",
  down: "stat-card__trend--down",
  neutral: "stat-card__trend--neutral",
};

const TrendArrow = () => (
  <svg className="stat-card__trend-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M8 3.5v9M8 3.5L4 7.5M8 3.5l4 4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const StatCardTrend = forwardRef<HTMLSpanElement, StatCardTrendProps>(function StatCardTrend(
  { value, direction, className, ...props },
  ref
) {
  const sign = direction === "down" ? "-" : direction === "up" ? "+" : "";

  return (
    <span
      ref={ref}
      className={cn("stat-card__trend", directionClass[direction], className)}
      {...props}
    >
      {direction !== "neutral" && <TrendArrow />}
      {sign}
      {Math.abs(value)}%
    </span>
  );
});

/* ------------------------------------------------------------------ */
/*  StatCard.Icon                                                      */
/* ------------------------------------------------------------------ */

type StatCardIconProps = ComponentPropsWithRef<"div">;

const StatCardIcon = forwardRef<HTMLDivElement, StatCardIconProps>(function StatCardIcon(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn("stat-card__icon", className)} {...props} />;
});

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const StatCard = Object.assign(StatCardRoot, {
  Value: StatCardValue,
  Label: StatCardLabel,
  Trend: StatCardTrend,
  Icon: StatCardIcon,
});
