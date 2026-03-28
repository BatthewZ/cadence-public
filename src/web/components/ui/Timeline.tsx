import {
  Children,
  type ComponentPropsWithRef,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
} from "react";

import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Context (passes index + animate flag to items)                     */
/* ------------------------------------------------------------------ */

type TimelineItemContextValue = {
  index: number;
  animate: boolean;
};

const TimelineItemContext = createContext<TimelineItemContextValue | null>(null);

function useTimelineItemContext() {
  return useContext(TimelineItemContext);
}

/* ------------------------------------------------------------------ */
/*  Timeline (root)                                                    */
/* ------------------------------------------------------------------ */

type TimelineProps = {
  animate?: boolean;
} & ComponentPropsWithRef<"div">;

const TimelineRoot = forwardRef<HTMLDivElement, TimelineProps>(function Timeline(
  { animate = true, className, children, ...props },
  ref
) {
  const items = Children.toArray(children);

  return (
    <div ref={ref} className={cn("timeline", className)} {...props}>
      {items.map((child, index) => (
        <TimelineItemContext.Provider key={index} value={{ index, animate }}>
          {child}
        </TimelineItemContext.Provider>
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Timeline.Item                                                      */
/* ------------------------------------------------------------------ */

type TimelineItemProps = {
  date?: string;
  title: string;
  icon?: ReactNode;
} & Omit<ComponentPropsWithRef<"div">, "title">;

const TimelineItem = forwardRef<HTMLDivElement, TimelineItemProps>(function TimelineItem(
  { date, title, icon, className, children, ...props },
  ref
) {
  const ctx = useTimelineItemContext();
  const index = ctx?.index ?? 0;
  const animate = ctx?.animate ?? true;

  const isLeftSide = index % 2 === 0; // 0-based even → CSS nth-child(odd) → left card
  const animation = isLeftSide ? "fade-right" : "fade-left";

  const inner = (
    <>
      <div className="timeline-node">{icon ?? <div className="timeline-dot" />}</div>
      <div className="timeline-card">
        {date && <span className="timeline-date">{date}</span>}
        <h3 className="timeline-title">{title}</h3>
        {children && <div className="timeline-body">{children}</div>}
      </div>
    </>
  );

  if (!animate) {
    return (
      <div ref={ref} className={cn("timeline-item", className)} {...props}>
        {inner}
      </div>
    );
  }

  return (
    <ScrollReveal
      ref={ref}
      animation={animation}
      className={cn("timeline-item", className)}
      {...props}
    >
      {inner}
    </ScrollReveal>
  );
});

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const Timeline = Object.assign(TimelineRoot, {
  Item: TimelineItem,
});
