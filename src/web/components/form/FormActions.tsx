import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type FormActionsProps = ComponentPropsWithRef<"div">;

export const FormActions = forwardRef<HTMLDivElement, FormActionsProps>(function FormActions(
  { className, ...props },
  ref
) {
  return (
    <div ref={ref} className={cn("flex flex-row justify-end gap-r5 pt-r4", className)} {...props} />
  );
});
