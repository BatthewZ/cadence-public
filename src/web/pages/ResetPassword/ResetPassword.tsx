import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { resetPasswordSchema } from "@/shared/schemas/auth";
import { AuthForm, type AuthFormFieldProps } from "@/web/components/auth";
import {
  Field,
  FieldError,
  Label,
  PasswordInput,
  PasswordRequirements,
} from "@/web/components/form";
import { Stack } from "@/web/components/layout";
import { AuthLayout } from "@/web/components/layout/AuthLayout";
import { Alert, Card, Text } from "@/web/components/ui";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { resetPassword } from "@/web/lib/auth/auth-client";

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Missing token: render a standalone error view outside AuthForm
  // because there is no form to submit in this state.
  if (!token) {
    return <ResetPasswordMissingToken />;
  }

  return (
    <AuthForm
      title="Reset Password"
      schema={resetPasswordSchema}
      getFormData={() => ({ newPassword, confirmPassword })}
      submitLabel="Reset Password"
      loadingLabel="Resetting..."
      onSubmit={async (_data, { setError }) => {
        const { error: resetError } = await resetPassword({
          newPassword,
          token,
        });

        if (resetError) {
          setError(resetError.message ?? "Failed to reset password");
          return;
        }

        return {
          success: true as const,
          message: (
            <Stack gap="r4">
              <Alert variant="success">
                Your password has been reset successfully.
              </Alert>
              <Text variant="body-2" color="secondary" className="text-center">
                <Link to="/login" className="link">
                  Sign in with your new password
                </Link>
              </Text>
            </Stack>
          ),
        };
      }}
      footer={
        <Text variant="body-2" color="secondary" className="text-center">
          <Link to="/login" className="link">
            Back to Sign In
          </Link>
        </Text>
      }
    >
      {({ fieldErrors, clearFieldError }: AuthFormFieldProps) => (
        <>
          <Field>
            <Label htmlFor="newPassword">New Password</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                clearFieldError("newPassword");
              }}
              error={!!fieldErrors.newPassword}
              required
            />
            <FieldError>{fieldErrors.newPassword}</FieldError>
            {newPassword.length > 0 && (
              <PasswordRequirements password={newPassword} />
            )}
          </Field>

          <Field>
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                clearFieldError("confirmPassword");
              }}
              error={!!fieldErrors.confirmPassword}
              required
            />
            <FieldError>{fieldErrors.confirmPassword}</FieldError>
          </Field>
        </>
      )}
    </AuthForm>
  );
}

/**
 * Standalone view shown when the reset-password URL lacks a token query
 * parameter, indicating an invalid or expired reset link.
 */
function ResetPasswordMissingToken() {
  useDocumentTitle("Reset Password");

  return (
    <AuthLayout>
      <Card className="w-full" padding="r2">
        <Stack gap="r3">
          <Text variant="h4" as="h1" className="text-center">
            Reset Password
          </Text>
          <Alert variant="error">
            Invalid or expired reset link. Please request a new one.
          </Alert>
          <Text variant="body-2" color="secondary" className="text-center">
            <Link to="/forgot-password" className="link">
              Request new reset link
            </Link>
          </Text>
        </Stack>
      </Card>
    </AuthLayout>
  );
}

export default ResetPassword;
