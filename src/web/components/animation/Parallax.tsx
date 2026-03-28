import {
  type ComponentPropsWithRef,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";
import { mergeRefs } from "@/web/util/merge-refs";

type ParallaxProps = {
  rate?: number;
  clamp?: number;
  children: ReactNode;
} & ComponentPropsWithRef<"div">;

export const Parallax = forwardRef<HTMLDivElement, ParallaxProps>(function Parallax(
  { rate, clamp, className, children, style, ...rest },
  ref
) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const rafId = useRef<number>(0);
  const currentOffset = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  const update = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    // Subtract current transform so we compute from the layout position,
    // not the visually-shifted position (getBoundingClientRect includes transforms).
    const layoutTop = rect.top - currentOffset.current;
    const viewportCenter = window.innerHeight / 2;
    const elCenter = layoutTop + rect.height / 2;
    const distance = elCenter - viewportCenter;

    const effectiveRate = rate ?? 0.3;
    let offset = distance * effectiveRate;

    if (clamp != null) {
      offset = Math.max(-clamp, Math.min(clamp, offset));
    }

    currentOffset.current = offset;
    el.style.transform = `translateY(${offset}px)`;
  }, [rate, clamp]);

  useEffect(() => {
    if (reducedMotion || typeof window === "undefined") return;

    function onScroll() {
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId.current);
    };
  }, [update, reducedMotion]);

  return (
    <div
      ref={mergeRefs(innerRef, ref)}
      className={className}
      style={{
        ...style,
        willChange: reducedMotion ? undefined : "transform",
      }}
      {...rest}
    >
      {children}
    </div>
  );
});
