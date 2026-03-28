import { type ComponentPropsWithRef, createContext, forwardRef, useContext, useId } from "react";

import { cn } from "@/web/util/style/style";

type FieldContextValue = { errorId: string };
const FieldContext = createContext<FieldContextValue | null>(null);
export const useFieldContext = () => useContext(FieldContext);

/** Returns aria-invalid and aria-describedby props for a form control inside a Field. */
export function useFieldErrorProps(error: boolean | undefined) {
  const field = useFieldContext();
  return {
    "aria-invalid": error ? ("true" as const) : undefined,
    "aria-describedby": error && field?.errorId ? field.errorId : undefined,
  };
}

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
