# Auth Configuration

## Better Auth Setup and Configuration

The auth configuration lives in `src/api/lib/auth.ts`. It uses a **factory function** rather than a singleton because of the Cloudflare Workers execution model (see below).

```ts
// src/api/lib/auth.ts
export function createAuth(env: AppBindings) {
  // Cached per isolate, keyed on BETTER_AUTH_SECRET — see "Per-Request Auth Factory".
  if (cachedAuth && cachedSecret === env.BETTER_AUTH_SECRET) return cachedAuth;

  const db = createDb(env.DB);
  const emailService = createEmailService(env);
  // One resolver shared with every other outbound mail path, so auth mail and
  // invitation mail cannot disagree about the sender — see docs/api/email.md.
  const fromAddress = resolveEmailFrom(env);

  const options: BetterAuthOptions = {
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      // Sign-in is refused with 403 EMAIL_NOT_VERIFIED until the account has
      // proved it controls the address it registered. Ships together with
      // migrations/0035_backfill_email_verified.sql, which grandfathers every
      // account created before the flag — neither is safe alone.
      requireEmailVerification: true,
      password: {
        hash: hashPassword,
        // Verifies against the current hash, and rewrites legacy hashes in
        // place on a successful sign-in.
        verify: createMigratingVerify(async (oldHash, newHash) => { /* … */ }),
      },
      sendResetPassword: async ({ user, url }) => {
        if (await isResetCooldownActive(db, user.id)) {
          console.warn("Password reset cooldown active, skipping email:", { userId: user.id });
          return;
        }
        try {
          const { subject, html, text } = passwordResetEmail({ url });
          await emailService.send({ to: user.email, from: fromAddress, subject, html, text });
        } catch (error) {
          console.error("Failed to send password reset email:", error);
        }
      },
    },
    emailVerification: {
      // Re-issue the link when an unverified account tries to sign in —
      // without it, requireEmailVerification has no self-service recovery.
      sendOnSignIn: true,
      // Verifying the address also creates the session and lands the user on
      // the callbackURL captured at sign-up.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        try {
          const { subject, html, text } = emailVerificationEmail({ url });
          await emailService.send({ to: user.email, from: fromAddress, subject, html, text });
        } catch (error) {
          console.error("Failed to send verification email:", error);
        }
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (deletedUser) => {
          // task_activity.apiTokenId is "SET NULL" by ORM intent but NO ACTION
          // on disk (added via SQLite ALTER TABLE ADD COLUMN), so the chain
          // user → api_token → task_activity must be broken by hand first.
          const userTokenIds = db
            .select({ id: schema.apiToken.id })
            .from(schema.apiToken)
            .where(eq(schema.apiToken.userId, deletedUser.id));
          await db
            .update(schema.taskActivity)
            .set({ apiTokenId: null })
            .where(inArray(schema.taskActivity.apiTokenId, userTokenIds));

          // Must delete tasks before the user cascade reaches task_group,
          // because task.taskGroupId has onDelete:"restrict" which blocks
          // the cascade path: user → workspace → project → task_group.
          const workspaceIds = db
            .select({ id: schema.workspace.id })
            .from(schema.workspace)
            .where(eq(schema.workspace.ownerId, deletedUser.id));
          const projectIds = db
            .select({ id: schema.project.id })
            .from(schema.project)
            .where(inArray(schema.project.workspaceId, workspaceIds));
          await db
            .delete(schema.task)
            .where(inArray(schema.task.projectId, projectIds));
        },
      },
    },
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      ...parseTrustedOrigins(env.TRUSTED_ORIGINS),
    ],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 300, // 5 min
      },
      updateAge: 3600, // 1 hour
    },
  };

  const auth = betterAuth(options);
  cachedAuth = auth;
  cachedSecret = env.BETTER_AUTH_SECRET;
  return auth;
}
```

### Configuration Details

| Option | Value | Purpose |
|---|---|---|
| `database` | Drizzle adapter with D1 + SQLite provider | Stores users, sessions, accounts, and verification tokens in D1. |
| `emailAndPassword.enabled` | `true` | Enables email/password sign-up and sign-in. |
| `emailAndPassword.requireEmailVerification` | `true` | Refuses sign-in with `403 EMAIL_NOT_VERIFIED` until the account has verified its address. Invitation acceptance authorises by comparing the invited address with the session's account email, so verification is what turns that match into evidence of mailbox control rather than evidence that someone typed the address into a form. Two intentional side effects: sign-up returns no session (`token: null`), and signing up with an already-registered address returns a synthetic success instead of an error. Must ship with `migrations/0035_backfill_email_verified.sql`. See [Auth Flows](./flows.md#email-verification). |
| `emailAndPassword.password.hash` / `.verify` | `hashPassword` / `createMigratingVerify(...)` | Project-supplied hashing (`src/api/lib/password.ts`): PBKDF2 via Web Crypto, because Better Auth's default scrypt parameters exceed the Workers CPU limit. `createMigratingVerify` recognises legacy scrypt hashes by key length, verifies them, and rewrites the stored hash to PBKDF2 in the same request, so a user hits the slow path at most once and no separate migration pass is needed. |
| `emailAndPassword.sendResetPassword` | Email service (Resend or console fallback) | Checks a D1-backed cooldown (`isResetCooldownActive`) to suppress duplicate reset emails within 5 minutes, then sends a password reset email via the configured email service. Failures are caught and logged so they do not crash the auth flow. See [Email Service](../api/email.md) and [Password Reset Cooldown](../../src/api/lib/password-reset-cooldown.ts). |
| `emailVerification.sendOnSignIn` | `true` | Re-sends the verification link whenever an unverified account attempts to sign in. Without it `requireEmailVerification` has no recovery path at all: the sign-up email would be the only link ever issued, so a lost or expired link (1 hour by default) would strand the account permanently. The mail goes only to the registered address. |
| `emailVerification.autoSignInAfterVerification` | `true` | Following the verification link signs the user in and lands them on the `callbackURL` recorded at sign-up. This is what lets the invite journey complete in one pass — register → verify → back at `/invite/:token` with a session — instead of requiring a separate sign-in first. |
| `emailVerification.sendVerificationEmail` | Email service (Resend or console fallback) | Sends an email verification link after sign-up and on every refused sign-in. Failures are caught and logged so they do not crash the auth flow. See [Email Service](../api/email.md). |
| `user.deleteUser.enabled` | `true` | Enables the account deletion endpoint. |
| `user.deleteUser.beforeDelete` | async hook | Runs two pre-cascade cleanups. It nulls `task_activity.apiTokenId` for activity rows pointing at the user's API tokens (the column's on-disk behaviour is `NO ACTION`, not the ORM's declared `SET NULL`, because it was added with SQLite `ALTER TABLE ADD COLUMN`), then pre-deletes all tasks belonging to the user's workspaces to avoid a foreign-key restrict violation on `task.taskGroupId`. Both use subqueries to resolve ownership. |
| `basePath` | `/api/auth` | All Better Auth endpoints are mounted under this path. |
| `secret` | `env.BETTER_AUTH_SECRET` | Secret key for signing session tokens. |
| `baseURL` | `env.BETTER_AUTH_URL` | The application's base URL (used for CORS, redirects, etc.). |
| `trustedOrigins` | Base URL + parsed `TRUSTED_ORIGINS` | Origins allowed to make authenticated requests. |
| `session.cookieCache.enabled` | `true` | Enables client-side cookie caching of session data, skipping DB session lookups while the cookie is fresh. |
| `session.cookieCache.maxAge` | `300` (5 minutes) | How long the cached cookie is considered fresh before a DB lookup is required. |
| `session.updateAge` | `3600` (1 hour) | How often Better Auth refreshes the session expiry in the database. Default is ~24 min; set to 1 hour to reduce write frequency. |

### Sender Address

Both mail callbacks above pass `from: fromAddress`, and `fromAddress` comes from `resolveEmailFrom(env)` in `src/api/lib/email/from.ts` — the single place any outbound email in the project resolves its sender. It returns `EMAIL_FROM` when that holds a non-blank value and `noreply@example.com` otherwise, so an `EMAIL_FROM` that is unset, empty, or whitespace-only all behave identically. Auth mail used to apply that fallback inline while other senders passed the raw binding through, and the copies drifted; one resolver is what keeps auth mail and invitation mail from disagreeing about the sender.

`resolveEmailFrom` is imported from the leaf module rather than the `./email` barrel on purpose — `auth.test.ts` replaces the barrel with a `createEmailService`-only stub, so pulling the resolver through it would hand this module an `undefined` at test time.

See [Email Service § Sender Address](../api/email.md#sender-address) and [Environment Variables](./environment.md).

---

## Per-Request Auth Factory

### Why a Factory?

In Cloudflare Workers, bindings like `D1Database` are only available inside request handlers -- they do not exist at module scope. This means you cannot create a Better Auth instance at import time:

```ts
// DOES NOT WORK in Workers:
const auth = betterAuth({ database: drizzleAdapter(someDb, ...) });
```

Instead, the project calls `createAuth(c.env)` inside every request handler and middleware that needs auth functionality. The factory caches the Better Auth instance at module scope (keyed on `BETTER_AUTH_SECRET`) so that only the first call per isolate pays the construction cost. Subsequent calls within the same isolate return the cached instance. See `docs/architecture/auth-factory.md` for details.

### Where It Is Called

1. **`src/api/middleware/auth.ts`** (session middleware) -- creates auth to extract the user session from cookies on every `/api/*` request.
2. **`src/api/routes/auth/auth.routes.ts`** (auth routes) -- creates auth to delegate sign-in, sign-up, password reset, and other auth operations to Better Auth's built-in handler.
