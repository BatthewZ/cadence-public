import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { loginSchema } from "@/shared/schemas/auth";
import { AuthForm, type AuthFormFieldProps } from "@/web/components/auth";
import { Field, FieldError, Input, Label, PasswordInput } from "@/web/components/form";
import { Text } from "@/web/components/ui";
import { signIn } from "@/web/lib/auth/auth-client";

export function Login() {
  const navigate = useNavigate();
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
          setError(signInError.message ?? "Failed to sign in");
          return;
        }

        void navigate("/");
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
