# Auth Flows

> **Email verification is mandatory.** `emailAndPassword.requireEmailVerification` is enabled in `src/api/lib/auth.ts`, so registration does **not** produce a session and sign-in is refused until the address has been verified. Everything below follows from that. See [Email Verification](#email-verification).

### Sign Up

1. User submits name, email, password, and password confirmation on `/register`. There is no Terms of Service checkbox — see [Terms of Service Acceptance](#terms-of-service-acceptance).
2. The `registerSchema` validates the four fields and that the two passwords match.
3. Frontend calls `signUp.email({ name, email, password, callbackURL })` from the auth client. `callbackURL` is the sanitised `?redirect=` value (see [Post-Authentication Redirects](#post-authentication-redirects)), defaulting to `/`.
4. Better Auth creates a `user` record (with `emailVerified` false) and an `account` record (with `providerId: "credential"` and a hashed password).
5. **No `session` record is created and no session cookie is set** — under `requireEmailVerification` the sign-up response carries `token: null`.
6. `emailVerification.sendVerificationEmail` fires and the [email service](../api/email.md) delivers a verification link (via Resend in production, or logged to the console in development).
7. The register page stays put and switches to a success state: "Account created. We've sent a verification link to *&lt;address&gt;*. You'll need it before you can sign in.", with an "Already verified? Sign In" link.
8. Signing up with an address that is already registered returns a **synthetic success** rather than an error, so the page shows the same state either way and registration does not report whether an address already has an account.

Because there is no session at any point in this flow, the registration page cannot call the `requireAuth`-gated `POST /api/legal/accept-tos`. It therefore does not ask for ToS acceptance; it links to the Terms and the Privacy Policy and states that the user will be asked to accept them on first sign-in.

### Email Verification

1. The verification email contains a link to Better Auth's verify endpoint under `/api/auth`. Links expire after 1 hour (Better Auth's default).
2. Following the link marks `user.emailVerified` true. Because `emailVerification.autoSignInAfterVerification` is enabled, Better Auth **creates the session at the same moment** and redirects to the `callbackURL` recorded at sign-up.
3. That is what makes the invitation journey land in one pass: invite email → register → verify → signed in and returned to `/invite/:token`, which now has a session and can accept.
4. If the link was lost or has expired, attempting to sign in issues a new one: `emailVerification.sendOnSignIn` re-sends the verification email on every refused sign-in, so the refusal is self-service recoverable. The mail goes to the registered address only. A link issued this way carries the default `callbackURL` of `/`, not the sign-up destination — the invite-preserving round trip in step 3 is the sign-up link's property.

**Accounts created before verification was required** were grandfathered to verified by `migrations/0035_backfill_email_verified.sql`, which ships alongside the flag. Every account predating the flag has `emailVerified = 0`, so enabling verification on its own would have refused sign-in for the entire existing user base, workspace owners included, with no self-service way back in. The migration is data-only and idempotent, and re-running it cannot un-verify anyone.

**In development**, no `RESEND_API_KEY` means the console transport is used: the recipient, sender, subject, and a text preview are printed to the Wrangler console instead of being sent. Copy the verification URL out of that log to complete the flow locally. Verification is *not* bypassed in development — there is no dev-only auto-verify — so a locally registered account must still follow a link from the log before it can sign in.

### Terms of Service Acceptance

Acceptance is collected **once, on first sign-in** — never at registration, because registration has no session to record it against.

1. `/accept-terms` is reached whenever `TosGuard` finds the user has not accepted the current ToS version: on a brand-new account's first hop into a guarded route, and again for existing users when `CURRENT_TOS_VERSION` is bumped. Both cases use the same page.
2. The user reviews the Terms of Service and the Privacy Policy, checks the agreement box, and clicks "Accept and Continue".
3. The "Accept and Continue" button stays disabled until the box is checked. On click the page calls `POST /api/legal/accept-tos` with `CURRENT_TOS_VERSION`, invalidates the `legal.tosStatus` query cache, and navigates to `/`. A "Sign Out" action is offered for a user who does not want to accept.
4. `/accept-terms` is mounted under `AuthGuard` **without** `TosGuard` (see `src/web/App.tsx`), which is what stops the guard redirecting the acceptance page to itself.
5. `/invite/:token` is mounted under **neither** guard, so an invitee returning from verification accepts their invitation before any Terms prompt; the prompt appears on their next hop into a guarded route. That ordering is deliberate — the invite link has to work for someone who is not yet a member of anything — so this path should not be read as Terms-gated.

### Sign In

1. User submits email and password on `/login`.
2. Frontend calls `signIn.email({ email, password })` from the auth client.
3. Better Auth verifies the credentials against the `account` table.
4. **If the address is not verified**, Better Auth refuses with `403` and the error code `EMAIL_NOT_VERIFIED`, and (via `sendOnSignIn`) sends a fresh verification email. The login page replaces the server's bare "Email not verified" with wording that names the recovery: "Verify your email address before signing in. We've just sent a new verification link to your inbox."
5. Otherwise a new `session` record is created and a session cookie is set.
6. The user is navigated to the sanitised `?redirect=` path, defaulting to `/` — see [Post-Authentication Redirects](#post-authentication-redirects). `/` is handled by `HomeRedirect`, which forwards to the last-visited workspace dashboard or to `/workspaces`.
7. On the first guarded route after that, `TosGuard` sends a user who has not yet accepted the current Terms to `/accept-terms`.

### Post-Authentication Redirects

Both `/login` and `/register` honour a `?redirect=` query parameter so that an emailed `/invite/:token` link survives a detour through authentication instead of dropping the user on the dashboard. `/invite/:token` is what produces those links, sending an unauthenticated visitor to `/login?redirect=…` or `/register?redirect=…`.

The value arrives in the URL, so it is normalised by `safeRedirectPath()` in `src/web/lib/auth/safe-redirect.ts` before anything navigates to it. Only same-origin **paths** are accepted; the fallback (`/`) is used for anything else, including an absent value. A candidate must:

- start with a single `/` — which rejects absolute (`https://…`) and scheme-relative (`//host`) URLs;
- contain no backslash, since some parsers normalise `\` to `/`;
- contain no C0 control character, space, or DEL, because the WHATWG URL parser strips or trims those and would then parse a different string than the checks inspected;
- still resolve to the same origin when re-parsed with the real URL parser.

The final parser cross-check is deliberately redundant with the character checks: it enforces the rule with the same machinery the browser will use, so the validator cannot disagree with the parser it is protecting. `safeRedirectPath` is pure and takes the raw value plus an optional fallback, so it is equally usable outside a browser.

### Sign Out

1. User clicks sign out.
2. Frontend calls `signOut()` from the auth client.
3. Better Auth deletes the session record and clears the session cookie.
4. The user is redirected to `/login`.

### Password Reset

1. User submits their email on `/forgot-password`.
2. Frontend calls `requestPasswordReset({ email })`. The endpoint is rate-limited to 3 requests per 60 seconds per IP.
3. Better Auth creates a `verification` record and calls the `sendResetPassword` callback with the reset URL.
4. A **D1-backed cooldown check** (`isResetCooldownActive`) queries the `verification` table for recent reset tokens belonging to this user. If a reset email was already sent within the last 5 minutes, the send is suppressed and a warning is logged. This prevents email spam even across Worker isolates (unlike in-memory rate limiting which is per-isolate).
5. The [email service](../api/email.md) sends a password reset email with the reset link (via Resend in production, or logged to console in development).
6. User clicks the link, which opens `/reset-password?token=...`.
7. User submits a new password.
8. Frontend calls `resetPassword({ newPassword, token })`.
9. Better Auth verifies the token, updates the password in the `account` table, and deletes the verification record.

### Session Management

- **List sessions**: `listSessions()` returns all active sessions for the current user, including IP address and user agent.
- **Revoke a session**: `revokeSession({ id })` deletes a specific session by its ID.
- **Revoke other sessions**: `revokeOtherSessions()` deletes all sessions for the current user except the current one.

### Account Deletion

- `deleteUser()` permanently deletes the user's account and all associated data (sessions, accounts, workspaces, projects, etc.).
- A `beforeDelete` hook clears `task_activity.apiTokenId` for every activity row that points at one of the user's API tokens. The ORM intent for that column is `ON DELETE SET NULL`, but it was added via SQLite `ALTER TABLE ADD COLUMN`, which cannot encode that behaviour, so the on-disk cascade is `NO ACTION` and the chain `user → api_token → task_activity` would otherwise abort the delete.
- The same hook pre-deletes tasks owned by the user's workspaces to avoid a foreign-key restrict violation on `task.taskGroupId` (which uses `onDelete: "restrict"`, blocking the cascade path `user → workspace → project → task_group`).
- Uploads are preserved after account deletion — `upload.userId` is set to `null` instead of cascading.
