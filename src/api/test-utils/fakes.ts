import type { Context, MiddlewareHandler } from "hono";

import { createDb } from "../../db";
import type { AppEnv } from "../env";

// ---------------------------------------------------------------------------
// Fake user / auth helpers
// ---------------------------------------------------------------------------

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
 * Middleware that sets the auth context (user + session) and injects the
 * D1 binding into `c.env.DB`. Place before handlers in test apps.
 */
export function fakeAuth(
  d1: D1Database,
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
  } = TEST_USER,
  opts?: {
    workspaceMembership?: { id: string; workspaceId?: string; role: "owner" | "admin" | "member" };
    projectAccess?: { role: "admin" | "member" | "viewer"; source: "workspace" | "project" };
    currentProject?: { id: string; workspaceId: string };
  },
): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next) => {
    // Inject the D1 binding into env (c.env may be undefined in Hono test mode)
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    (c.env as Record<string, unknown>).DB = d1;

    c.set("db", createDb(d1));
    c.set("user", user as never);
    c.set("session", null);
    c.set("requestId", "test-request-id");

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
    c.set("db", createDb(d1));
    await next();
  };
}
