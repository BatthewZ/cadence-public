import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

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
import { Stack } from "@/web/components/layout";
import { Alert, Text } from "@/web/components/ui";
import { signUp } from "@/web/lib/auth/auth-client";
import { safeRedirectPath } from "@/web/lib/auth/safe-redirect";

export function Register() {
  const [searchParams] = useSearchParams();
  const redirectPath = safeRedirectPath(searchParams.get("redirect"));
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
      /**
       * Sign-up no longer produces a session.
       *
       * `emailAndPassword.requireEmailVerification` is enabled server-side
       * (see `src/api/lib/auth.ts` — it is what stops a stranger claiming a
       * colleague's workspace invitation by registering their address), and
       * Better Auth responds to that by withholding the session on sign-up:
       * the response carries `token: null` and sets no cookie. So there is
       * nothing to navigate into, and this page ends on a "check your email"
       * state instead.
       *
       * Two consequences worth stating rather than discovering:
       *  - ToS acceptance cannot be recorded here, so this page no longer
       *    asks for it. `POST /api/legal/accept-tos` is `requireAuth`-gated
       *    and would 401 every time. Asking anyway produced the worst of both
       *    outcomes: the user ticked a box that was thrown away, then hit the
       *    `/accept-terms` wall after verifying and accepted a second time.
       *    Acceptance now happens exactly once, on the page that records it
       *    with the version the user actually agreed to. The links below keep
       *    the terms one click away at sign-up, which is where people expect
       *    to find them; they promise nothing this page cannot keep.
       *  - `callbackURL` carries the post-verification destination, so a user
       *    who arrived from an invite link is returned to that invite once
       *    they verify (Better Auth's `autoSignInAfterVerification` gives
       *    them a session at the same moment).
       *
       *    Note `/invite/:token` is mounted without `AuthGuard` or `TosGuard`
       *    (see `App.tsx`), so an invitee returning there accepts the
       *    invitation BEFORE any Terms prompt; the wall appears on their next
       *    hop into a guarded route. That ordering is deliberate — the invite
       *    link has to work for someone who is not yet a member of anything —
       *    but do not read this path as Terms-gated.
       */
      onSubmit={async (_data, { setError }) => {
        const { error: signUpError } = await signUp.email({
          name,
          email,
          password,
          callbackURL: redirectPath,
        });

        if (signUpError) {
          setError(signUpError.message ?? "Failed to register");
          return;
        }

        return {
          success: true as const,
          message: (
            <Stack gap="r4">
              {/*
                One child element, not three text/element siblings: `Alert` is
                a flex row, so bare text either side of a `<strong>` becomes
                three flex items and a long address shreds the message into
                ragged columns. The address also gets its own line — an email
                is one unbreakable token, so leaving it mid-sentence forces an
                ugly mid-word break on anything long.
              */}
              <Alert variant="success">
                <Stack gap="r6">
                  <span>Account created. We've sent a verification link to:</span>
                  <strong className="break-all">{email}</strong>
                  <span>You'll need it before you can sign in.</span>
                </Stack>
              </Alert>
              <Text variant="body-2" color="secondary" className="text-center">
                Already verified?{" "}
                <Link to="/login" className="link">
                  Sign In
                </Link>
              </Text>
            </Stack>
          ),
        };
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

          {/*
            A notice, not a control. The recorded, versioned acceptance lives
            on `/accept-terms`, which is reached on the first authenticated
            page load — see the note on `onSubmit` above.
          */}
          <Text variant="body-3" color="secondary" className="leading-snug">
            Review our{" "}
            <Link to="/terms" target="_blank" rel="noopener noreferrer" className="link">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="link">
              Privacy Policy
            </Link>
            . You&apos;ll be asked to accept them when you first sign in.
          </Text>
        </>
      )}
    </AuthForm>
  );
}

export default Register;
