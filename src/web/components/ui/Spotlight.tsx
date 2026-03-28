import { Children, type ComponentPropsWithRef, createContext, forwardRef, useContext } from "react";

import { Parallax } from "@/web/components/animation/Parallax";
import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Context (passes index + animate flag to items)                     */
/* ------------------------------------------------------------------ */

type SpotlightItemContextValue = {
  index: number;
  animate: boolean;
};

const SpotlightItemContext = createContext<SpotlightItemContextValue | null>(null);

function useSpotlightItemContext() {
  return useContext(SpotlightItemContext);
}

/* ------------------------------------------------------------------ */
/*  Spotlight (root)                                                   */
/* ------------------------------------------------------------------ */

type SpotlightProps = {
  animate?: boolean;
} & ComponentPropsWithRef<"div">;

const SpotlightRoot = forwardRef<HTMLDivElement, SpotlightProps>(function Spotlight(
  { animate = true, className, children, ...props },
  ref
) {
  const items = Children.toArray(children);

  return (
    <div ref={ref} className={cn("spotlight", className)} {...props}>
      {items.map((child, index) => (
        <SpotlightItemContext.Provider key={index} value={{ index, animate }}>
          {child}
        </SpotlightItemContext.Provider>
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Spotlight.Item                                                     */
/* ------------------------------------------------------------------ */

type SpotlightItemProps = {
  reversed?: boolean;
} & ComponentPropsWithRef<"div">;

const SpotlightItem = forwardRef<HTMLDivElement, SpotlightItemProps>(function SpotlightItem(
  { reversed, className, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn("spotlight-item", reversed && "spotlight-item--reversed", className)}
      {...props}
    >
      {children}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Spotlight.Image                                                    */
/* ------------------------------------------------------------------ */

type SpotlightImageProps = {
  src: string;
  alt?: string;
  parallax?: boolean;
  parallaxRate?: number;
} & Omit<ComponentPropsWithRef<"div">, "children">;

const SpotlightImage = forwardRef<HTMLDivElement, SpotlightImageProps>(function SpotlightImage(
  { src, alt, parallax = false, parallaxRate, className, ...props },
  ref
) {
  const image = src ? (
    <img src={src} alt={alt ?? ""} role={alt ? undefined : "presentation"} />
  ) : null;

  const inner = parallax ? (
    <Parallax rate={parallaxRate} className="size-full">
      {image}
    </Parallax>
  ) : (
    image
  );

  return (
    <div ref={ref} className={cn("spotlight-image", className)} {...props}>
      {inner}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Spotlight.Content                                                  */
/* ------------------------------------------------------------------ */

type SpotlightContentProps = ComponentPropsWithRef<"div">;

const SpotlightContent = forwardRef<HTMLDivElement, SpotlightContentProps>(
  function SpotlightContent({ className, children, ...props }, ref) {
    const ctx = useSpotlightItemContext();
    const index = ctx?.index ?? 0;
    const animate = ctx?.animate ?? true;

    const isAlternate = index % 2 === 1;
    const animation = isAlternate ? "fade-left" : "fade-right";

    const inner = (
      <div
        ref={animate ? undefined : ref}
        className={cn("spotlight-content", className)}
        {...props}
      >
        {children}
      </div>
    );

    if (!animate) {
      return inner;
    }

    return (
      <ScrollReveal ref={ref} animation={animation}>
        {inner}
      </ScrollReveal>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const Spotlight = Object.assign(SpotlightRoot, {
  Item: SpotlightItem,
  Image: SpotlightImage,
  Content: SpotlightContent,
});
