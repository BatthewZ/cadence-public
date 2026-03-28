import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type LabelProps = ComponentPropsWithRef<"label">;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  ref
) {
  return (
    <label
      ref={ref}
      className={cn("text-body-2 font-semibold text-fg-primary", className)}
      {...props}
    />
  );
});
