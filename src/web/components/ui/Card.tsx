import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Padding = "r1" | "r2" | "r3" | "r4" | "r5" | "r6";
type Shadow = "sm" | "md" | "lg";

const paddingMap: Record<Padding, string> = {
  r1: "p-r1",
  r2: "p-r2",
  r3: "p-r3",
  r4: "p-r4",
  r5: "p-r5",
  r6: "p-r6",
};

const shadowMap: Record<Shadow, string> = {
  sm: "shadow-sm",
  md: "shadow-md",
  lg: "shadow-lg",
};

type CardProps = {
  padding?: Padding;
  shadow?: Shadow;
} & Omit<ComponentPropsWithRef<"div">, "padding">;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = "r3", shadow = "md", className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        "bg-surface-0 rounded-lg overflow-hidden min-w-0 border border-border-default/50",
        shadowMap[shadow],
        paddingMap[padding],
        className
      )}
      {...props}
    />
  );
});
