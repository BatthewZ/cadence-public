import { type ComponentPropsWithRef, forwardRef, type ReactNode } from "react";

import { cn } from "@/web/util/style/style";

import { useFieldContext } from "./Field";

type FieldErrorProps = {
  children?: ReactNode;
} & Omit<ComponentPropsWithRef<"p">, "children">;

export const FieldError = forwardRef<HTMLParagraphElement, FieldErrorProps>(function FieldError(
  { children, className, id: idProp, ...props },
  ref
) {
  const field = useFieldContext();
  if (!children) return null;

  return (
    <p
      ref={ref}
      id={idProp ?? field?.errorId}
      role="alert"
      className={cn("text-body-3 text-status-error", className)}
      {...props}
    >
      {children}
    </p>
  );
});
