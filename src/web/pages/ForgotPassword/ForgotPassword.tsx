import { useState } from "react";
import { Link } from "react-router-dom";

import { forgotPasswordSchema } from "@/shared/schemas/auth";
import { AuthForm, type AuthFormFieldProps } from "@/web/components/auth";
import { Field, FieldError, Input, Label } from "@/web/components/form";
import { Stack } from "@/web/components/layout";
import { Alert, Text } from "@/web/components/ui";
import { requestPasswordReset } from "@/web/lib/auth/auth-client";

export function ForgotPassword() {
  const [email, setEmail] = useState("");

  return (
    <AuthForm
      title="Forgot Password"
      schema={forgotPasswordSchema}
      getFormData={() => ({ email })}
      submitLabel="Send Reset Link"
      loadingLabel="Sending..."
      onSubmit={async (_data, { setError }) => {
        const { error: resetError } = await requestPasswordReset({
          email,
          redirectTo: "/reset-password",
        });

        if (resetError) {
          setError(resetError.message ?? "Failed to send reset link");
          return;
        }

        return {
          success: true as const,
          message: (
            <Stack gap="r4">
              <Alert variant="success">
                If an account exists with that email, we've sent a password reset link.
              </Alert>
              <Text variant="body-2" color="secondary" className="text-center">
                <Link to="/login" className="link">
                  Back to Sign In
                </Link>
              </Text>
            </Stack>
          ),
        };
      }}
      description={
        <Text variant="body-2" color="secondary" className="text-center">
          Enter your email address and we'll send you a link to reset your password.
        </Text>
      }
      footer={
        <Text variant="body-2" color="secondary" className="text-center">
          <Link to="/login" className="link">
            Back to Sign In
          </Link>
        </Text>
      }
    >
      {({ fieldErrors, clearFieldError }: AuthFormFieldProps) => (
        <Field>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearFieldError("email");
            }}
            error={!!fieldErrors.email}
            required
          />
          <FieldError>{fieldErrors.email}</FieldError>
        </Field>
      )}
    </AuthForm>
  );
}

export default ForgotPassword;
