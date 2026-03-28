import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { registerSchema } from "@/shared/schemas/auth";
import { AuthForm, type AuthFormFieldProps } from "@/web/components/auth";
import {
  Field,
  FieldError,
  Input,
  Label,
  PasswordInput,
  PasswordRequirements,
} from "@/web/components/form";
import { Text } from "@/web/components/ui";
import { signUp } from "@/web/lib/auth/auth-client";

export function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  return (
    <AuthForm
      title="Create Account"
      schema={registerSchema}
      getFormData={() => ({ name, email, password, confirmPassword })}
      submitLabel="Create Account"
      loadingLabel="Creating account..."
      onSubmit={async (_data, { setError }) => {
        const { error: signUpError } = await signUp.email({
          name,
          email,
          password,
        });

        if (signUpError) {
          setError(signUpError.message ?? "Failed to register");
          return;
        }

        void navigate("/");
      }}
      footer={
        <Text variant="body-2" color="secondary" className="text-center">
          Already have an account?{" "}
          <Link to="/login" className="link">
            Sign In
          </Link>
        </Text>
      }
    >
      {({ fieldErrors, clearFieldError }: AuthFormFieldProps) => (
        <>
          <Field>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearFieldError("name");
              }}
              error={!!fieldErrors.name}
              required
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>

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
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError("password");
              }}
              error={!!fieldErrors.password}
              required
            />
            <FieldError>{fieldErrors.password}</FieldError>
            {password.length > 0 && <PasswordRequirements password={password} />}
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

export default Register;
