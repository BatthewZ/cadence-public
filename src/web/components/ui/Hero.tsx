import { type ComponentPropsWithRef, forwardRef } from "react";

import { Parallax } from "@/web/components/animation/Parallax";
import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { Stagger } from "@/web/components/animation/Stagger";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Size / alignment maps                                              */
/* ------------------------------------------------------------------ */

type HeroSize = "sm" | "md" | "lg" | "full";
type HeroAlign = "start" | "center" | "end";

const sizeClass: Record<HeroSize, string> = {
  sm: "hero--sm",
  md: "hero--md",
  lg: "hero--lg",
  full: "hero--full",
};

const alignClass: Record<HeroAlign, string> = {
  start: "hero--align-start",
  center: "hero--align-center",
  end: "hero--align-end",
};

/* ------------------------------------------------------------------ */
/*  Hero (root)                                                        */
/* ------------------------------------------------------------------ */

type HeroProps = {
  size?: HeroSize;
  overlay?: boolean;
  align?: HeroAlign;
} & Omit<ComponentPropsWithRef<"section">, "size">;

const HeroRoot = forwardRef<HTMLElement, HeroProps>(function Hero(
  { size = "md", overlay = true, align = "end", className, children, ...props },
  ref
) {
  return (
    <section
      ref={ref}
      className={cn("hero", sizeClass[size], alignClass[align], className)}
      {...props}
    >
      {children}
      {overlay && <div aria-hidden="true" className="hero__overlay" />}
    </section>
  );
});

/* ------------------------------------------------------------------ */
/*  Hero.Background                                                    */
/* ------------------------------------------------------------------ */

type HeroBackgroundProps = {
  src?: string;
  alt?: string;
  parallax?: boolean;
  parallaxRate?: number;
} & Omit<ComponentPropsWithRef<"div">, "children">;

const HeroBackground = forwardRef<HTMLDivElement, HeroBackgroundProps>(function HeroBackground(
  { src, alt, parallax = false, parallaxRate, className, ...props },
  ref
) {
  const image = src ? (
    <img
      src={src}
      alt={alt ?? ""}
      role={alt ? undefined : "presentation"}
      className="size-full object-cover"
    />
  ) : null;

  const inner = parallax ? (
    <Parallax rate={parallaxRate} className="size-full">
      {image}
    </Parallax>
  ) : (
    image
  );

  return (
    <div
      ref={ref}
      className={cn("hero__background", parallax && "hero__background--parallax", className)}
      {...props}
    >
      {inner}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Hero.Content                                                       */
/* ------------------------------------------------------------------ */

type HeroContentAnimation = "fade-up" | "fade-in" | "scale";

type HeroContentProps = {
  animate?: boolean;
  animation?: HeroContentAnimation;
} & Omit<ComponentPropsWithRef<"div">, "animation">;

const HeroContent = forwardRef<HTMLDivElement, HeroContentProps>(function HeroContent(
  { animate = false, animation = "fade-up", className, children, ...props },
  ref
) {
  return (
    <div ref={ref} className={cn("hero__content", className)} {...props}>
      {animate ? (
        <ScrollReveal animation={animation}>
          <Stagger>{children}</Stagger>
        </ScrollReveal>
      ) : (
        children
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const Hero = Object.assign(HeroRoot, {
  Background: HeroBackground,
  Content: HeroContent,
});
