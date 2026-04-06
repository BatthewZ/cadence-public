# Auth Flows

### Sign Up

1. User submits name, email, password, and accepts the Terms of Service checkbox on `/register`.
2. The `registerSchema` validates all fields, including that `tosAccepted` is `true`.
3. Frontend calls `signUp.email({ name, email, password })` from the auth client.
4. Better Auth creates a `user` record and an `account` record (with `providerId: "credential"` and a hashed password).
5. A `session` record is created and a session cookie is set.
6. The frontend records ToS acceptance by calling `POST /api/legal/accept-tos` with the current ToS version. If this call fails, the `TosGuard` will prompt the user on the next authenticated page load.
7. The user is redirected to `/`.

### ToS Acceptance (existing users)

When the ToS version is bumped, existing users who haven't accepted the new version are redirected to `/accept-terms` by the `TosGuard`. On that page, the user reviews the Terms of Service and Privacy Policy, checks the agreement box, and clicks "Accept and Continue". The acceptance is recorded via `POST /api/legal/accept-tos` and the `legal.tosStatus` query cache is invalidated.

### Sign In

1. User submits email and password on `/login`.
2. Frontend calls `signIn.email({ email, password })` from the auth client.
3. Better Auth verifies the credentials against the `account` table.
4. A new `session` record is created and a session cookie is set.
5. The user is redirected to `/dashboard`.

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

### Email Verification

1. User signs up with an email address.
2. Better Auth calls the `sendVerificationEmail` callback with a verification URL.
3. The [email service](../api/email.md) sends a verification email with the confirmation link (via Resend in production, or logged to console in development).
4. User clicks the link, which verifies their email address in the database.

### Session Management

- **List sessions**: `listSessions()` returns all active sessions for the current user, including IP address and user agent.
- **Revoke a session**: `revokeSession({ id })` deletes a specific session by its ID.
- **Revoke other sessions**: `revokeOtherSessions()` deletes all sessions for the current user except the current one.

### Account Deletion

- `deleteUser()` permanently deletes the user's account and all associated data (sessions, accounts, workspaces, projects, etc.).
- A `beforeDelete` hook pre-deletes tasks owned by the user's workspaces to avoid a foreign-key restrict violation on `task.taskGroupId` (which uses `onDelete: "restrict"`, blocking the cascade path `user → workspace → project → task_group`).
- Uploads are preserved after account deletion — `upload.userId` is set to `null` instead of cascading.
