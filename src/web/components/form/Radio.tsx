import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type RadioProps = Omit<ComponentPropsWithRef<"input">, "type">;

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type="radio"
      className={cn(
        "size-4 accent-accent focus:outline-none",
        className
      )}
      {...props}
    />
  );
});
