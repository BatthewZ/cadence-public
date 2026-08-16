# Frontend Auth Client

The frontend auth client is defined in `src/web/lib/auth/auth-client.ts`. It wraps Better Auth's React client and exports individual functions:

```ts
import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient({
  baseURL: window.location.origin,
});

export const {
  useSession,
  signIn,
  signUp,
  signOut,
  updateUser,
  changePassword,
  deleteUser,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  requestPasswordReset,
  resetPassword,
} = authClient;
```

### Exported Functions

| Export | Type | Purpose |
|---|---|---|
| `useSession` | React hook | Returns `{ data: session, isPending, error }`. Used by guards and components to check auth state. |
| `signIn` | Function | `signIn.email({ email, password })` -- authenticates with credentials. |
| `signUp` | Function | `signUp.email({ name, email, password, callbackURL })` -- creates a new account. Under `requireEmailVerification` it returns **no session** (`token: null`, no cookie); `callbackURL` is where the user lands once they follow the verification link. See [Sign Up](./flows.md#sign-up). |
| `signOut` | Function | `signOut()` -- ends the current session. |
| `updateUser` | Function | `updateUser({ name, image })` -- updates user profile fields. |
| `changePassword` | Function | `changePassword({ currentPassword, newPassword })` -- changes the password for the current user. |
| `deleteUser` | Function | `deleteUser()` -- permanently deletes the user's account. |
| `listSessions` | Function | `listSessions()` -- returns all active sessions for the current user. |
| `revokeSession` | Function | `revokeSession({ id })` -- deletes a specific session. |
| `revokeOtherSessions` | Function | `revokeOtherSessions()` -- deletes all sessions except the current one. |
| `requestPasswordReset` | Function | `requestPasswordReset({ email })` -- sends a password reset email. |
| `resetPassword` | Function | `resetPassword({ newPassword, token })` -- sets a new password using a reset token. |

### Error Codes

`signIn.email` resolves with an `error` object rather than throwing. The one code the UI branches on is **`EMAIL_NOT_VERIFIED`** (HTTP 403), returned when the account has not verified its address. The login page replaces the server's bare "Email not verified" message with wording that names the recovery, because `sendOnSignIn` has just issued a fresh verification link. See [Sign In](./flows.md#sign-in).

### Sibling Modules

`src/web/lib/auth/` also holds two modules that are not part of the Better Auth client but are used by every auth surface:

| Module | Export | Purpose |
|---|---|---|
| `safe-redirect.ts` | `safeRedirectPath(raw, fallback = "/")` | Normalises a caller-supplied `?redirect=` value to a same-origin path before anything navigates to it. Used by `Login` and `Register`. See [Post-Authentication Redirects](./flows.md#post-authentication-redirects). |
| `use-guest-session.ts` | `useGuestSession()` | `{ session, showInitialLoader }` for logged-out surfaces, so a background session refetch cannot remount a guest page and discard its state. Used by `GuestGuard` and `HomeRedirect`. See [Route Guards](./guards.md#useguestsession). |
