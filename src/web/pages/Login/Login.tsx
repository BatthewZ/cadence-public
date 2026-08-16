import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { loginSchema } from "@/shared/schemas/auth";
import { AuthForm, type AuthFormFieldProps } from "@/web/components/auth";
import { Field, FieldError, Input, Label, PasswordInput } from "@/web/components/form";
import { Text } from "@/web/components/ui";
import { signIn } from "@/web/lib/auth/auth-client";
import { safeRedirectPath } from "@/web/lib/auth/safe-redirect";

/**
 * Better Auth's error code for an account that has not proved control of its
 * address. Sign-in is refused with a 403 carrying this code now that
 * `requireEmailVerification` is enabled in `src/api/lib/auth.ts`.
 */
const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Honour `?redirect=` so the emailed `/invite/:token` link survives a
  // detour through sign-in instead of dumping the user on the dashboard.
  const redirectPath = safeRedirectPath(searchParams.get("redirect"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <AuthForm
      title="Sign In"
      schema={loginSchema}
      getFormData={() => ({ email, password })}
      submitLabel="Sign In"
      loadingLabel="Signing in..."
      onSubmit={async (_data, { setError }) => {
        const { error: signInError } = await signIn.email({
          email,
          password,
        });

        if (signInError) {
          // The server's own wording for this case is the bare "Email not
          // verified", which tells the user what went wrong but not what to
          // do. Better Auth re-sends the verification link on every refused
          // sign-in (`sendOnSignIn`), so say so — otherwise a user whose
          // original link expired has no reason to think checking their inbox
          // again would help.
          setError(
            signInError.code === EMAIL_NOT_VERIFIED
              ? "Verify your email address before signing in. We've just sent a new verification link to your inbox."
              : (signInError.message ?? "Failed to sign in"),
          );
          return;
        }

        void navigate(redirectPath);
      }}
      footer={
        <Text variant="body-2" color="secondary" className="text-center">
          Don't have an account?{" "}
          <Link to="/register" className="link">
            Register
          </Link>
        </Text>
      }
    >
      {({ fieldErrors, clearFieldError }: AuthFormFieldProps) => (
        <>
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

          <Field>
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError("password");
              }}
              error={!!fieldErrors.password}
              required
            />
            <FieldError>{fieldErrors.password}</FieldError>
          </Field>

          <Text variant="body-2" color="secondary" className="text-right">
            <Link to="/forgot-password" className="link">
              Forgot password?
            </Link>
          </Text>
        </>
      )}
    </AuthForm>
  );
}

export default Login;
