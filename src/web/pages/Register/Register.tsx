import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { CURRENT_TOS_VERSION } from "@/shared/constants/legal";
import { registerSchema } from "@/shared/schemas/auth";
import { AuthForm, type AuthFormFieldProps } from "@/web/components/auth";
import {
  Checkbox,
  Field,
  FieldError,
  Input,
  Label,
  PasswordInput,
  PasswordRequirements,
} from "@/web/components/form";
import { Text } from "@/web/components/ui";
import { api } from "@/web/lib/api/client";
import { signUp } from "@/web/lib/auth/auth-client";

export function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);

  return (
    <AuthForm
      title="Create Account"
      schema={registerSchema}
      getFormData={() => ({ name, email, password, confirmPassword, tosAccepted })}
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

        // Record ToS acceptance — if this fails, TosGuard will catch them on next navigation
        try {
          await api.post("/api/legal/accept-tos", { tosVersion: CURRENT_TOS_VERSION });
        } catch {
          // Safety net: TosGuard will prompt them on next authenticated page load
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

          <Field>
            <div className="flex items-start gap-2">
              <Checkbox
                id="tosAccepted"
                checked={tosAccepted}
                onChange={(e) => {
                  setTosAccepted(e.target.checked);
                  clearFieldError("tosAccepted");
                }}
                className="mt-0.5"
              />
              <Label htmlFor="tosAccepted" className="text-sm font-normal leading-snug">
                I agree to the{" "}
                <Link to="/terms" target="_blank" rel="noopener noreferrer" className="link">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="link">
                  Privacy Policy
                </Link>
              </Label>
            </div>
            <FieldError>{fieldErrors.tosAccepted}</FieldError>
          </Field>
        </>
      )}
    </AuthForm>
  );
}

export default Register;
