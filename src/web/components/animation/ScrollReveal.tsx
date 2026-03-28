import {
  type AnimationEvent,
  type ElementType,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";
import { mergeRefs } from "@/web/util/merge-refs";
import { cn } from "@/web/util/style/style";

type Animation = "fade-up" | "fade-in" | "fade-left" | "fade-right" | "scale";

const animationClassMap: Record<Animation, string> = {
  "fade-up": "fade-up",
  "fade-in": "fade-in",
  "fade-left": "fade-left",
  "fade-right": "fade-right",
  scale: "scale-in",
};

type ScrollRevealProps = {
  animation?: Animation;
  threshold?: number;
  delay?: number;
  once?: boolean;
  rootMargin?: string;
  className?: string;
  children?: ReactNode;
  as?: ElementType;
};

export const ScrollReveal = forwardRef<HTMLElement, ScrollRevealProps>(function ScrollReveal(
  {
    animation = "fade-up",
    threshold = 0.1,
    delay = 0,
    once = true,
    rootMargin = "0px",
    className,
    children,
    as: Tag = "div",
  },
  forwardedRef
) {
  const innerRef = useRef<HTMLElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [animating, setAnimating] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const setRefs = mergeRefs(innerRef, forwardedRef);

  useEffect(() => {
    const node = innerRef.current;
    if (!node || reducedMotion || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          setAnimating(true);
          if (once) {
            observer.unobserve(node);
          }
        } else if (!once) {
          setRevealed(false);
          setAnimating(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once, reducedMotion]);

  const handleAnimationEnd = useCallback((e: AnimationEvent) => {
    // Only handle our own animation, not bubbled events from children
    if (e.target === e.currentTarget) {
      setAnimating(false);
    }
  }, []);

  const isHidden = !reducedMotion && !revealed;

  return (
    <Tag
      ref={setRefs}
      className={cn(
        isHidden && "scroll-reveal-hidden",
        animating && animationClassMap[animation],
        className
      )}
      style={animating && delay > 0 && !reducedMotion ? { animationDelay: `${delay}ms`, animationFillMode: "backwards" } : undefined}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </Tag>
  );
}) as <T extends ElementType = "div">(
  props: ScrollRevealProps & { as?: T } & Omit<
      React.ComponentPropsWithRef<T>,
      keyof ScrollRevealProps | "as"
    >
) => React.JSX.Element;
