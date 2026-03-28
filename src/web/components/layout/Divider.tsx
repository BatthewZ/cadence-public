import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Orientation = "horizontal" | "vertical";

type DividerProps = {
  orientation?: Orientation;
} & Omit<ComponentPropsWithRef<"hr">, "orientation">;

export const Divider = forwardRef<HTMLElement, DividerProps>(function Divider(
  { orientation = "horizontal", className, ...props },
  ref
) {
  if (orientation === "horizontal") {
    return (
      <hr
        ref={ref as React.Ref<HTMLHRElement>}
        className={cn("border-t border-border-default", className)}
        {...props}
      />
    );
  }

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      role="separator"
      aria-orientation="vertical"
      className={cn("border-l border-border-default self-stretch", className)}
      {...(props as React.ComponentPropsWithRef<"div">)}
    />
  );
});
