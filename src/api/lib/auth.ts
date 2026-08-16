import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, inArray } from "drizzle-orm";

import { createDb } from "../../db";
import * as schema from "../../db/schema";
import type { AppBindings } from "../env";
import { createEmailService } from "./email";
// Imported from the leaf module rather than the `./email` barrel on purpose:
// `auth.test.ts` replaces the barrel wholesale with a `createEmailService`-only
// stub, so pulling the sender resolver through it would hand this module an
// `undefined` at test time and silently reinstate the very bug it fixes.
import { resolveEmailFrom } from "./email/from";
import { emailVerificationEmail } from "./email/templates/email-verification";
import { passwordResetEmail } from "./email/templates/password-reset";
import { createMigratingVerify, hashPassword } from "./password";
import { isResetCooldownActive } from "./password-reset-cooldown";

/**
 * Module-scoped cache for the Better Auth instance.
 *
 * In Cloudflare Workers, env bindings are stable within an isolate's lifetime —
 * every request in the same isolate receives the same D1 proxy, secrets, etc.
 * Caching avoids re-running betterAuth(), drizzleAdapter(), createEmailService(),
 * and parseTrustedOrigins() on every single request, saving significant CPU time.
 *
 * The cache is keyed on BETTER_AUTH_SECRET so that if an isolate is somehow
 * reused across deployments with different config (shouldn't happen in practice),
 * the instance is recreated.
 */
let cachedAuth: ReturnType<typeof betterAuth> | null = null;
let cachedSecret: string | null = null;

export function createAuth(env: AppBindings) {
  if (cachedAuth && cachedSecret === env.BETTER_AUTH_SECRET) {
    return cachedAuth;
  }

  const db = createDb(env.DB);
  const emailService = createEmailService(env);
  // Shared with the invitation mailer — see `./email/from.ts` for why the
  // fallback had to stop being a per-call-site expression.
  const fromAddress = resolveEmailFrom(env);

  const options: BetterAuthOptions = {
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.BETTER_AUTH_URL, ...parseTrustedOrigins(env.TRUSTED_ORIGINS)],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 300, // 5 min — skip DB session lookups while cookie is fresh
      },
      updateAge: 3600, // Refresh session expiry once per hour instead of default ~24 min
    },
    emailAndPassword: {
      enabled: true,
      /**
       * Sign-in is refused (403 `EMAIL_NOT_VERIFIED`) until an account has
       * proved it controls the address it registered.
       *
       * Why this is load-bearing rather than hygiene: workspace invitations
       * are authorised by comparing the invited address with the session's
       * account email (`acceptInvitation`). With verification off, that check
       * only asks "did you type this address into a signup form?" — so anyone
       * who guessed that a colleague had been invited could register their
       * address and join the workspace (audit finding 04, reproduced live).
       * Enabling verification is what turns the email match into evidence of
       * mailbox control, and it closes the same hole for any future feature
       * that treats an email address as an identity.
       *
       * Existing accounts: every user created before this flag has
       * `emailVerified = 0`, so switching it on alone would lock out the
       * entire user base — including workspace owners, who have no
       * self-service route back in. Migration
       * `migrations/0035_backfill_email_verified.sql` grandfathers those rows
       * to verified in the same change. The flag and the migration must ship
       * together; neither is safe alone.
       *
       * Two intentional side effects of this flag in Better Auth 1.5.6:
       *  - `POST /sign-up/email` no longer returns a session (`token: null`),
       *    so the Register page shows a "check your email" state instead of
       *    navigating into the app.
       *  - Signing up with an already-registered address returns a synthetic
       *    success instead of 422, removing an email-enumeration oracle.
       */
      requireEmailVerification: true,
      password: {
        hash: hashPassword,
        verify: createMigratingVerify(async (oldHash, newHash) => {
          await db
            .update(schema.account)
            .set({ password: newHash, updatedAt: new Date() })
            .where(eq(schema.account.password, oldHash));
        }),
      },
      sendResetPassword: async ({ user, url }) => {
        if (await isResetCooldownActive(db, user.id)) {
          console.warn("Password reset cooldown active, skipping email:", { userId: user.id });
          return;
        }
        try {
          const { subject, html, text } = passwordResetEmail({ url });
          await emailService.send({
            to: user.email,
            from: fromAddress,
            subject,
            html,
            text,
          });
        } catch (error) {
          console.error("Failed to send password reset email:", { email: user.email, error });
        }
      },
    },
    emailVerification: {
      /**
       * Re-send the verification link when an unverified account attempts to
       * sign in.
       *
       * Without this, `requireEmailVerification` is a trap: the signup email
       * is the only link ever issued, so a user who lost it, whose link
       * expired (1 hour by default), or who signed up while the mail provider
       * was down has no way whatsoever to get another one — the account is
       * permanently unreachable with no self-service recovery. Better Auth
       * still returns the same 403 either way, so this only adds the recovery
       * path and leaks nothing extra: the mail goes to the registered
       * address, which is by definition the person entitled to it.
       */
      sendOnSignIn: true,
      /**
       * Clicking the verification link signs the user in and drops them at
       * `callbackURL`.
       *
       * This is what makes the invitation journey land: invite email →
       * register → verify → signed in and returned to `/invite/:token`, which
       * then has a session and can accept. Without it the user verifies, sees
       * a bare redirect, and has to sign in again before the invite link does
       * anything — the drop-off point the invite flow can least afford.
       */
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        try {
          const { subject, html, text } = emailVerificationEmail({ url });
          await emailService.send({
            to: user.email,
            from: fromAddress,
            subject,
            html,
            text,
          });
        } catch (error) {
          console.error("Failed to send verification email:", { email: user.email, error });
        }
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (deletedUser) => {
          // task_activity.apiTokenId references api_token with ORM intent
          // "ON DELETE SET NULL", but because the column was added via
          // SQLite `ALTER TABLE ADD COLUMN` (which cannot encode that
          // behaviour at the SQL level) the actual on-disk cascade is
          // NO ACTION. Without this step the user-delete cascade chain
          //   user → api_token (cascade) → task_activity (NO ACTION)
          // raises a foreign-key violation and aborts user deletion.
          // Explicitly NULL the column for any activity rows that point
          // at tokens the user owns before letting the cascade run.
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
  };

  const auth = betterAuth(options);

  cachedAuth = auth;
  cachedSecret = env.BETTER_AUTH_SECRET;
  return auth;
}

/**
 * Reset the cached auth instance. Exposed for testing so each test gets a
 * fresh instance and module-level state doesn't leak between test cases.
 */
export function resetAuthCache() {
  cachedAuth = null;
  cachedSecret = null;
}

export type Auth = ReturnType<typeof createAuth>;

export function parseTrustedOrigins(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Module-scoped cache for the resolved allowed-origins set.
 * Avoids re-parsing the TRUSTED_ORIGINS string on every request.
 */
let cachedAllowedSet: Set<string> | null = null;
let cachedAllowedKey: string | null = null;

export function resolveAllowedOrigin(
  origin: string,
  baseUrl: string,
  trustedOrigins?: string
): string | null {
  const key = `${baseUrl}\0${trustedOrigins ?? ""}`;
  if (!cachedAllowedSet || cachedAllowedKey !== key) {
    cachedAllowedSet = new Set([baseUrl, ...parseTrustedOrigins(trustedOrigins)]);
    cachedAllowedKey = key;
  }
  return cachedAllowedSet.has(origin) ? origin : null;
}

/**
 * Reset the cached allowed-origins. Exposed for testing.
 */
export function resetAllowedOriginCache() {
  cachedAllowedSet = null;
  cachedAllowedKey = null;
}
