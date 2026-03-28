import { type ComponentPropsWithRef, forwardRef, type ReactNode } from "react";

import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { cn } from "@/web/util/style/style";

type Animation = "fade-up" | "fade-in" | "fade-left" | "fade-right" | "scale";

type SwimlaneProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  viewAllHref?: string;
  animation?: Animation;
  once?: boolean;
} & Omit<ComponentPropsWithRef<"section">, "title">;

export const Swimlane = forwardRef<HTMLElement, SwimlaneProps>(function Swimlane(
  {
    title,
    subtitle,
    viewAllHref,
    animation = "fade-up",
    once = true,
    className,
    children,
    ...rest
  },
  ref
) {
  return (
    <ScrollReveal
      as="section"
      ref={ref}
      animation={animation}
      once={once}
      className={cn("swimlane", className)}
      {...rest}
    >
      <div className="swimlane__header">
        <div className="swimlane__titles">
          <h2 className="swimlane__title">{title}</h2>
          {subtitle && <p className="swimlane__subtitle">{subtitle}</p>}
        </div>
        {viewAllHref && (
          <a href={viewAllHref} className="swimlane__view-all">
            View all
          </a>
        )}
      </div>
      <div className="swimlane__body">{children}</div>
    </ScrollReveal>
  );
});
