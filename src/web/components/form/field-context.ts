import { createContext, useContext } from "react";

export type FieldContextValue = { errorId: string };

export const FieldContext = createContext<FieldContextValue | null>(null);

export const useFieldContext = () => useContext(FieldContext);

/** Returns aria-invalid and aria-describedby props for a form control inside a Field. */
export function useFieldErrorProps(error: boolean | undefined) {
  const field = useFieldContext();
  return {
    "aria-invalid": error ? ("true" as const) : undefined,
    "aria-describedby": error && field?.errorId ? field.errorId : undefined,
  };
}
