import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "size-4 rounded-sm border border-border-strong accent-accent",
        "focus:ring-2 focus:ring-border-focus focus:ring-offset-2",
        className
      )}
      {...props}
    />
  );
});
