import { useCallback, useState } from "react";
import type { ZodError } from "zod";

/**
 * Manages per-field validation errors for forms that use Zod schemas.
 * Extracts the duplicated fieldErrors state, clearFieldError, and
 * Zod-error-to-record mapping that was previously copy-pasted across
 * every form component.
 */
export function useFieldErrors() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const setFromZodError = useCallback((zodError: ZodError) => {
    const errors: Record<string, string> = {};
    for (const issue of zodError.errors) {
      const key = issue.path[0]?.toString();
      if (key) errors[key] = issue.message;
    }
    setFieldErrors(errors);
  }, []);

  const resetFieldErrors = useCallback(() => {
    setFieldErrors({});
  }, []);

  return { fieldErrors, clearFieldError, setFromZodError, resetFieldErrors };
}
