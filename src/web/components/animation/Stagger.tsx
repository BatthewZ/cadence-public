import { Children, type ElementType, forwardRef, type ReactNode } from "react";

import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";

type StaggerProps = {
  staggerDelay?: string;
  className?: string;
  children?: ReactNode;
  as?: ElementType;
};

export const Stagger = forwardRef<HTMLElement, StaggerProps>(function Stagger(
  { staggerDelay, className, children, as: Tag = "div" },
  ref
) {
  const reducedMotion = usePrefersReducedMotion();

  const items = Children.toArray(children);

  return (
    <Tag
      ref={ref}
      className={className}
      style={
        staggerDelay ? ({ "--stagger-delay": staggerDelay } as React.CSSProperties) : undefined
      }
    >
      {items.map((child, index) => (
        <div
          key={index}
          className="stagger-item"
          style={
            {
              "--stagger-index": reducedMotion ? 0 : index,
            } as React.CSSProperties
          }
        >
          {child}
        </div>
      ))}
    </Tag>
  );
}) as <T extends ElementType = "div">(
  props: StaggerProps & { as?: T } & Omit<React.ComponentPropsWithRef<T>, keyof StaggerProps | "as">
) => React.JSX.Element;
