import type { Context, MiddlewareHandler } from "hono";

import { createDb } from "../../db";
import type { ApiToken } from "../../db/schema";
import type { AppEnv } from "../env";

// ---------------------------------------------------------------------------
// Fake user / auth helpers
// ---------------------------------------------------------------------------

/**
 * Structural shape of a seedable/authenticatable test user.
 *
 * `TEST_USER` and `TEST_USER_2` are `as const`, so their inferred types are
 * literal-valued and a third fixture (an attacker account, a second invitee)
 * cannot be assigned to a `typeof TEST_USER | typeof TEST_USER_2` parameter.
 * Helpers take this widened type instead so tests can define whatever extra
 * identities the scenario needs — an authorization test that can only ever
 * use two accounts cannot express "a stranger".
 */
export type TestUserFixture = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const TEST_USER = {
  id: "test-user-id",
  name: "Test User",
  email: "test@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

export const TEST_USER_2 = {
  id: "test-user-2-id",
  name: "Test User 2",
  email: "test2@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

/**
 * Mint an extra identity beyond the two canonical fixtures.
 *
 * Authorization tests routinely need a cast of four or five — an outsider, a
 * bystander, someone about to be offboarded, a second tenant's owner — and
 * `TEST_USER` / `TEST_USER_2` cannot express any of them. Four test files had
 * each written this same six-field factory privately, under three different
 * names (`principal`, `makeUser`, inline literals), which is why it lives here
 * now: an identity fixture that differs between files makes two tests that look
 * alike behave differently for reasons nobody writes down.
 *
 * `emailVerified: false` matches the canonical fixtures. Tests that depend on
 * verification — the invitation-accept path is the one that does — must set it
 * explicitly rather than inherit it, so the dependency is visible at the test.
 */
export function makeTestUser(id: string, name: string): TestUserFixture {
  return {
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: false,
    image: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  };
}

/**
 * A `api_token` row shaped exactly as `middleware/auth.ts` hands it downstream
 * after a successful verification.
 *
 * ## Why this is shared rather than written per file
 *
 * Five PAT test files each declared their own 15-column literal, and every one
 * of them closed with `as ApiToken` — an assertion that would silently absorb a
 * new column on `api_token` instead of failing to compile. That is the wrong
 * direction for a fixture whose entire job is to stand in for the real row: a
 * token missing a field the middleware reads is a test that passes for a reason
 * unrelated to the policy under test. Returning a fully-typed `ApiToken` with no
 * assertion makes a schema change a compile error here, once, instead of five
 * silent divergences.
 *
 * Defaults are the widest scope set (`read:*`, `write:*`, plus both delete
 * scopes) and `projectScope: "all"`. That is deliberate for authorization
 * tests: a capability-scope failure and a project-binding failure both answer
 * 403, so a fixture that is narrow by default lets a test assert 403 while the
 * guard it means to exercise has been removed entirely. Callers narrow exactly
 * the axis they are testing and leave the rest wide open.
 */
export function fakePat(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: "test-api-token-id",
    userId: TEST_USER.id,
    workspaceId: "test-workspace-id",
    name: "test-token",
    tokenHash: "hash",
    tokenPrefix: "cdn_pat_test",
    scopes: JSON.stringify(["read:*", "write:*", "project:delete", "task:delete"]),
    projectScope: "all",
    projectIds: null,
    lastUsedAt: null,
    expiresAt: null,
    revokeAt: null,
    revokedAt: null,
    rotatedToId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Middleware that sets the auth context (user + session) and injects the
 * D1 binding into `c.env.DB`. Place before handlers in test apps.
 */
export function fakeAuth(
  d1: D1Database,
  user: TestUserFixture = TEST_USER,
  opts?: {
    workspaceMembership?: { id: string; workspaceId?: string; role: "owner" | "admin" | "member" };
    projectAccess?: { role: "admin" | "member" | "viewer"; source: "workspace" | "project" };
    currentProject?: { id: string; workspaceId: string };
    /**
     * The verified PAT to hand downstream, or `null` for a cookie session.
     *
     * `null` is not the same as omitting the option, and the difference is the
     * whole point of passing it: `middleware/auth.ts` writes `apiToken: null`
     * on the session branch, so a test that wants to prove "a human is
     * unaffected by this policy" must reproduce that write rather than leave
     * the key unset. Omitting the option leaves it unset, which is what most
     * handler tests want.
     */
    apiToken?: ApiToken | null;
    /**
     * Extra `c.env` bindings (`STORAGE`, …) the route under test needs. Merged
     * after `DB`, so a test can supply an R2 stub without hand-rolling the
     * `c.env` widening that this helper already owns.
     */
    env?: Record<string, unknown>;
    /** Overrides the `requestId` written into the context. */
    requestId?: string;
  },
): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next) => {
    // Inject the D1 binding into env (c.env may be undefined in Hono test mode)
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    (c.env as Record<string, unknown>).DB = d1;
    if (opts?.env) {
      Object.assign(c.env as Record<string, unknown>, opts.env);
    }

    c.set("db", createDb(d1));
    c.set("user", user as never);
    c.set("session", null);
    c.set("requestId", opts?.requestId ?? "test-request-id");

    if (opts && "apiToken" in opts) {
      c.set("apiToken", opts.apiToken ?? null);
    }

    if (opts?.workspaceMembership) {
      c.set("workspaceMembership", {
        id: opts.workspaceMembership.id,
        workspaceId: opts.workspaceMembership.workspaceId ?? "test-workspace-id",
        role: opts.workspaceMembership.role,
      });
    }
    if (opts?.projectAccess) {
      c.set("projectAccess", opts.projectAccess);
    }
    if (opts?.currentProject) {
      c.set("currentProject", opts.currentProject);
    }

    await next();
  };
}

/**
 * Middleware that injects D1 but does NOT set a user (for unauthenticated tests).
 */
export function fakeEnv(d1: D1Database): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next) => {
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    (c.env as Record<string, unknown>).DB = d1;
    (c.env as Record<string, unknown>).TOKEN_HASH_PEPPER = TEST_TOKEN_HASH_PEPPER;
    c.set("db", createDb(d1));
    await next();
  };
}

/**
 * Pepper used by every PAT hash test in the suite. A fixed value is fine
 * because tests run in isolation against an ephemeral in-memory D1 — what
 * matters is that the SAME pepper feeds both `generateApiToken` (at seed
 * time) and `verifyToken` (at assertion time), so the hashes line up.
 *
 * Production deployments must supply their own high-entropy `TOKEN_HASH_PEPPER`
 * environment variable; see `.dev.vars.example`.
 */
export const TEST_TOKEN_HASH_PEPPER = "test-token-hash-pepper-do-not-use-in-production";
