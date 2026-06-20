import { type ComponentPropsWithRef, forwardRef, useId } from "react";

import { cn } from "@/web/util/style/style";

import { FieldContext } from "./field-context";

type FieldProps = ComponentPropsWithRef<"div">;

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { className, ...props },
  ref
) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldContext value={{ errorId }}>
      <div ref={ref} className={cn("flex flex-col gap-r6", className)} {...props} />
    </FieldContext>
  );
});
