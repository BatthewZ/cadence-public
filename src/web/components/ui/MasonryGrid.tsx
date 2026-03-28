import {
  Children,
  type ComponentPropsWithRef,
  createContext,
  type CSSProperties,
  forwardRef,
  useContext,
} from "react";

import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ColumnBreakpoints = {
  base?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
};

type Animation = "fade-up" | "fade-in" | "fade-left" | "fade-right" | "scale";

/* ------------------------------------------------------------------ */
/*  Context (passes animate + animation to items)                      */
/* ------------------------------------------------------------------ */

type MasonryContextValue = {
  animate: boolean;
  animation: Animation;
  index: number;
};

const MasonryContext = createContext<MasonryContextValue | null>(null);

function useMasonryContext() {
  return useContext(MasonryContext);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildResponsiveClasses(columns: ColumnBreakpoints): string[] {
  const classes: string[] = [];
  for (const [bp, count] of Object.entries(columns)) {
    if (count == null || count === 1) continue;
    classes.push(`masonry-grid--${bp}-${count}`);
  }
  return classes;
}

/* ------------------------------------------------------------------ */
/*  MasonryGrid (root)                                                 */
/* ------------------------------------------------------------------ */

type MasonryGridProps = {
  columns?: ColumnBreakpoints | number;
  gap?: string;
  animate?: boolean;
  animation?: Animation;
} & ComponentPropsWithRef<"div">;

const MasonryGridRoot = forwardRef<HTMLDivElement, MasonryGridProps>(function MasonryGrid(
  { columns = 1, gap, animate = true, animation = "fade-up", className, style, children, ...props },
  ref
) {
  const resolved: ColumnBreakpoints = typeof columns === "number" ? { base: columns } : columns;

  const responsiveClasses = buildResponsiveClasses(resolved);

  const vars: CSSProperties & Record<string, string | number> = {};
  if (gap) {
    vars["--masonry-gap"] = gap;
  }

  const items = Children.toArray(children);

  return (
    <div
      ref={ref}
      className={cn("masonry-grid", ...responsiveClasses, className)}
      style={{ ...vars, ...style } as CSSProperties}
      {...props}
    >
      {items.map((child, index) => (
        <MasonryContext.Provider key={index} value={{ animate, animation, index }}>
          {child}
        </MasonryContext.Provider>
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  MasonryGrid.Item                                                   */
/* ------------------------------------------------------------------ */

type MasonryGridItemProps = ComponentPropsWithRef<"div">;

const MasonryGridItem = forwardRef<HTMLDivElement, MasonryGridItemProps>(function MasonryGridItem(
  { className, children, ...props },
  ref
) {
  const ctx = useMasonryContext();
  const animate = ctx?.animate ?? true;
  const animation = ctx?.animation ?? "fade-up";
  const index = ctx?.index ?? 0;

  if (!animate) {
    return (
      <div ref={ref} className={cn("masonry-grid__item", className)} {...props}>
        {children}
      </div>
    );
  }

  return (
    <ScrollReveal
      ref={ref}
      animation={animation}
      delay={index * 50}
      className={cn("masonry-grid__item", className)}
      {...props}
    >
      {children}
    </ScrollReveal>
  );
});

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const MasonryGrid = Object.assign(MasonryGridRoot, {
  Item: MasonryGridItem,
});
