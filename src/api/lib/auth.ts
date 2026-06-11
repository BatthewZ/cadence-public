import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, inArray } from "drizzle-orm";

import { createDb } from "../../db";
import * as schema from "../../db/schema";
import type { AppBindings } from "../env";
import { createEmailService } from "./email";
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
  const fromAddress = env.EMAIL_FROM ?? "noreply@example.com";

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
