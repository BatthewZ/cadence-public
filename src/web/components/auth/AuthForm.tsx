import { type FormEvent, type ReactNode, useState } from "react";
import type { z } from "zod";

import { Stack } from "@/web/components/layout";
import { AuthLayout } from "@/web/components/layout/AuthLayout";
import { Alert, Button, Card, Text } from "@/web/components/ui";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useFieldErrors } from "@/web/hooks/use-field-errors";

/* ─── Types ─── */

/**
 * Props passed to the render-prop children so each page can build its
 * own form fields while AuthForm manages validation state centrally.
 */
export type AuthFormFieldProps = {
  fieldErrors: Record<string, string>;
  clearFieldError: (field: string) => void;
};

/**
 * The result an `onSubmit` callback can return to signal success with an
 * optional replacement view (e.g. "Check your email" or "Password reset
 * successfully").  Returning `void`/`undefined` means the form stays
 * visible (useful when the page navigates away on success).
 */
export type AuthSubmitResult =
  | { success: true; message?: ReactNode }
  | void;

type AuthFormProps<TSchema extends z.ZodType> = {
  /** Page / document title shown in the browser tab. */
  title: string;

  /** Zod schema used for client-side validation before `onSubmit`. */
  schema: TSchema;

  /**
   * Called with the parsed data after Zod validation succeeds.
   * - Throw or return nothing for standard navigate-on-success flows.
   * - Return `{ success: true, message: <ReactNode> }` to replace the
   *   form with a success view.
   * - To show an error, throw a string or Error, or use the `setError`
   *   function passed as the second argument.
   */
  onSubmit: (
    data: z.infer<TSchema>,
    helpers: { setError: (msg: string) => void },
  ) => Promise<AuthSubmitResult>;

  /** Label shown on the submit button in its idle state. */
  submitLabel: string;

  /** Label shown on the submit button while the request is in flight. */
  loadingLabel: string;

  /**
   * Render-prop that receives field-error state so each page can wire up
   * its own inputs while AuthForm owns the validation lifecycle.
   */
  children: (props: AuthFormFieldProps) => ReactNode;

  /**
   * Optional description text rendered between the title and the form
   * (e.g. the instructional copy on the Forgot Password page).
   */
  description?: ReactNode;

  /**
   * Navigation links rendered below the form (e.g. "Don't have an
   * account? Register").
   */
  footer?: ReactNode;

  /**
   * Build the raw form-data record from component state so AuthForm can
   * run Zod validation without knowing which fields exist.
   */
  getFormData: () => Record<string, unknown>;
};

/* ─── Component ─── */

/**
 * Shared wrapper for every authentication page (Login, Register,
 * ForgotPassword, ResetPassword).
 *
 * Centralises the boilerplate that was previously duplicated across all
 * four pages:
 * - `AuthLayout > Card > Stack > form > Stack` DOM hierarchy
 * - `useDocumentTitle` call
 * - `useFieldErrors` hook setup
 * - `useState` for loading and error
 * - Form-submit pipeline: preventDefault -> validate -> call API ->
 *   handle errors / success
 * - Error alert rendering
 * - Full-width primary submit button with loading text
 */
export function AuthForm<TSchema extends z.ZodType>({
  title,
  schema,
  onSubmit,
  submitLabel,
  loadingLabel,
  children,
  description,
  footer,
  getFormData,
}: AuthFormProps<TSchema>) {
  useDocumentTitle(title);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successView, setSuccessView] = useState<ReactNode | null>(null);
  const { fieldErrors, clearFieldError, setFromZodError, resetFieldErrors } =
    useFieldErrors();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    resetFieldErrors();

    const result = schema.safeParse(getFormData());
    if (!result.success) {
      setFromZodError(result.error);
      return;
    }

    setLoading(true);
    try {
      const submitResult = await onSubmit(result.data as z.infer<TSchema>, {
        setError,
      });

      if (submitResult?.success && submitResult.message) {
        setSuccessView(submitResult.message);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full" padding="r2">
        <Stack gap="r3">
          <Text variant="h4" as="h1" className="text-center">
            {title}
          </Text>

          {successView ? (
            successView
          ) : (
            <>
              {description}

              <form noValidate onSubmit={(e) => void handleSubmit(e)}>
                <Stack gap="r4">
                  {children({ fieldErrors, clearFieldError })}

                  {error && <Alert variant="error">{error}</Alert>}

                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    className="w-full"
                    disabled={loading}
                  >
                    {loading ? loadingLabel : submitLabel}
                  </Button>
                </Stack>
              </form>

              {footer}
            </>
          )}
        </Stack>
      </Card>
    </AuthLayout>
  );
}
