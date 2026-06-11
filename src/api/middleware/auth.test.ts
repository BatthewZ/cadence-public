/// <reference types="@cloudflare/workers-types" />
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth", () => ({
  createAuth: vi.fn(),
  resetAuthCache: vi.fn(),
}));

import { createDb } from "../../db";
import { apiToken } from "../../db/schema";
import type { AppEnv } from "../env";
import {
  generateApiToken,
  newApiTokenId,
  TOKEN_PREFIX,
} from "../lib/api-tokens";
import { createAuth, resetAuthCache } from "../lib/auth";
import {
  createTestD1,
  seedUser,
  seedWorkspace,
  TEST_TOKEN_HASH_PEPPER,
  TEST_USER,
} from "../test-utils";
import { authSessionMiddleware } from "./auth";

const mockCreateAuth = vi.mocked(createAuth);

function createApp() {
  const app = new Hono();

  app.use("*", authSessionMiddleware as never);
  app.get("/test", (c) => {
    const user = c.get("user" as never);
    const session = c.get("session" as never);
    return c.json({ user, session });
  });

  return app;
}

/**
 * Helper to build a Request with a cookie header so the middleware proceeds
 * past the early-exit check and actually calls getSession.
 */
function requestWithCookie(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { cookie: "better-auth.session_token=test-token" },
  });
}

describe("authSessionMiddleware", () => {
  beforeEach(() => {
    vi.mocked(resetAuthCache).mockClear();
    mockCreateAuth.mockReset();
  });

  it("skips getSession and sets null user/session when no cookie or auth header is present", async () => {
    // Do NOT set up mockCreateAuth — if getSession were called it would throw
    const app = createApp();
    const res = await app.request("/test");

    expect(res.status).toBe(200);
    const body = await res.json<{ user: null; session: null }>();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();

    // createAuth should never have been called
    expect(mockCreateAuth).not.toHaveBeenCalled();
  });

  it("sets user and session when getSession returns a session", async () => {
    const fakeUser = { id: "1", email: "test@example.com", name: "Test" };
    const fakeSession = { id: "s1", expiresAt: new Date() };

    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: fakeUser,
          session: fakeSession,
        }),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    expect(res.status).toBe(200);
    const body = await res.json<{ user: typeof fakeUser; session: typeof fakeSession }>();
    expect(body.user).toEqual(fakeUser);
    expect(body.session).toMatchObject({ id: "s1" });
  });

  it("sets user and session to null when getSession returns null", async () => {
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    expect(res.status).toBe(200);
    const body = await res.json<{ user: null; session: null }>();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();
  });

  it("falls back to null user/session when getSession throws (stale/corrupt cookie)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockRejectedValue(new Error("D1_ERROR: no such table: session")),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    expect(res.status).toBe(200);
    const body = await res.json<{ user: null; session: null }>();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();

    expect(errorSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string) as {
      level: string;
      middleware: string;
    };
    expect(logged.level).toBe("error");
    expect(logged.middleware).toBe("authSession");

    errorSpy.mockRestore();
  });

  it("calls next() in both cases — handler is always reached", async () => {
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    // If next() wasn't called, we'd get a 404
    expect(res.status).toBe(200);
  });

  it("calls next() when early-exiting due to missing credentials", async () => {
    const app = createApp();
    // No cookie, no authorization header — early exit path
    const res = await app.request("/test");

    // If next() wasn't called, we'd get a 404
    expect(res.status).toBe(200);
  });

  it("proceeds to getSession when authorization header is present (no cookie)", async () => {
    const fakeUser = { id: "2", email: "bearer@example.com", name: "Bearer" };
    const fakeSession = { id: "s2", expiresAt: new Date() };

    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: fakeUser,
          session: fakeSession,
        }),
      },
    } as never);

    const app = createApp();
    const req = new Request("http://localhost/test", {
      headers: { authorization: "Bearer some-token" },
    });
    const res = await app.request(req);

    expect(res.status).toBe(200);
    expect(mockCreateAuth).toHaveBeenCalled();
    const body = await res.json<{ user: typeof fakeUser; session: typeof fakeSession }>();
    expect(body.user).toEqual(fakeUser);
  });
});

// ---------------------------------------------------------------------------
// PAT authentication
//
// These tests run the middleware end-to-end against a real in-memory D1 (via
// Miniflare) so the verifyToken JOIN, revocation/expiry checks, and downstream
// context-setting are all exercised against actual SQL. Bugs in this branch
// either let attackers authenticate (silent allow on bad input) or break
// legitimate integrations (silent 401 on valid input), so the cases below pin
// down both directions.
// ---------------------------------------------------------------------------

describe("authSessionMiddleware — PAT authentication", () => {
  let d1: D1Database;
  let dispose: () => Promise<void>;
  let workspaceId: string;

  beforeAll(async () => {
    const result = await createTestD1();
    d1 = result.d1;
    dispose = result.dispose;

    await seedUser(d1, TEST_USER);
    workspaceId = await seedWorkspace(d1, TEST_USER.id);
  });

  afterAll(async () => {
    await dispose();
  });

  beforeEach(() => {
    // Same reset cadence as the outer describe — every PAT test starts with
    // a clean mock so "createAuth must not have been called" assertions are
    // not poisoned by an earlier test's call.
    vi.mocked(resetAuthCache).mockClear();
    mockCreateAuth.mockReset();
  });

  /**
   * Insert a token row into the live D1 with sane defaults so each test
   * only has to specify what it cares about (expiry, revocation, hash).
   */
  async function insertToken(opts: {
    hash: string;
    prefix: string;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  }): Promise<string> {
    const db = createDb(d1);
    const id = newApiTokenId();
    await db.insert(apiToken).values({
      id,
      userId: TEST_USER.id,
      workspaceId,
      name: "Test PAT",
      tokenHash: opts.hash,
      tokenPrefix: opts.prefix,
      scopes: JSON.stringify(["task:read"]),
      projectScope: "all",
      projectIds: null,
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
      revokeAt: null,
      createdAt: new Date(),
    });
    return id;
  }

  /**
   * Builds a fresh app that injects the real D1 binding into `c.env.DB` and
   * `c.get("db")` BEFORE the auth middleware runs (matching the production
   * middleware chain in src/api/index.ts) and exposes every context key we
   * want to assert on.
   */
  function createPatApp() {
    const app = new Hono<AppEnv>();

    // Stand-in for the request-id middleware so errorResponse can read it.
    app.use("*", async (c, next) => {
      c.set("requestId", "test-request-id");
      await next();
    });

    // Stand-in for the production db-injection middleware (src/api/index.ts:44).
    app.use("*", async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      (c.env as Record<string, unknown>).DB = d1;
      (c.env as Record<string, unknown>).TOKEN_HASH_PEPPER = TEST_TOKEN_HASH_PEPPER;
      c.set("db", createDb(d1));
      await next();
    });

    app.use("*", authSessionMiddleware);

    app.get("/test", (c) => {
      return c.json({
        user: c.get("user"),
        session: c.get("session"),
        apiToken: c.get("apiToken"),
        workspaceMembership: c.get("workspaceMembership"),
      });
    });

    return app;
  }

  function patRequest(plaintext: string): Request {
    return new Request("http://localhost/test", {
      headers: { authorization: `Bearer ${plaintext}` },
    });
  }

  it("authenticates a valid PAT: 200, user is set, apiToken is set, session is null", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({ hash, prefix });

    const app = createPatApp();
    const res = await app.request(patRequest(plaintext));

    expect(res.status).toBe(200);
    const body = await res.json<{
      user: { id: string; email: string } | null;
      session: unknown;
      apiToken: { id: string; tokenHash: string } | null;
    }>();

    expect(body.user).not.toBeNull();
    expect(body.user?.id).toBe(TEST_USER.id);
    expect(body.user?.email).toBe(TEST_USER.email);
    expect(body.session).toBeNull();
    expect(body.apiToken).not.toBeNull();
    expect(body.apiToken?.tokenHash).toBe(hash);

    // createAuth must NOT have been invoked — PAT branch bypasses better-auth.
    expect(mockCreateAuth).not.toHaveBeenCalled();
  });

  it("pre-caches workspaceMembership so the authorize middleware skips a DB lookup", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({ hash, prefix });

    const app = createPatApp();
    const res = await app.request(patRequest(plaintext));

    expect(res.status).toBe(200);
    const body = await res.json<{
      workspaceMembership: {
        id: string;
        workspaceId: string;
        role: string;
      } | null;
    }>();

    expect(body.workspaceMembership).not.toBeNull();
    expect(body.workspaceMembership?.workspaceId).toBe(workspaceId);
    expect(body.workspaceMembership?.role).toBe("owner");
  });

  it("updates lastUsedAt on the token row (fire-and-forget bumpLastUsedAt)", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    const tokenId = await insertToken({ hash, prefix });

    // Confirm starting state — no lastUsedAt yet.
    const db = createDb(d1);
    const [before] = await db
      .select()
      .from(apiToken)
      .where(eq(apiToken.id, tokenId));
    expect(before.lastUsedAt).toBeNull();

    const app = createPatApp();
    const res = await app.request(patRequest(plaintext));
    expect(res.status).toBe(200);

    // deferWork runs inline in the test env (no ExecutionContext), but the
    // Hono `.request()` call resolves as soon as the handler returns. Give the
    // inline promise a tick to settle.
    await new Promise((r) => setTimeout(r, 10));

    const [after] = await db
      .select()
      .from(apiToken)
      .where(eq(apiToken.id, tokenId));
    expect(after.lastUsedAt).not.toBeNull();
    expect(after.lastUsedAt instanceof Date).toBe(true);
  });

  it("rejects an expired PAT with 401 Invalid API token", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({
      hash,
      prefix,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const app = createPatApp();
    const res = await app.request(patRequest(plaintext));

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string; requestId: string }>();
    expect(body.error).toBe("Invalid API token");
    expect(body.requestId).toBe("test-request-id");

    // Must not have fallen through to better-auth.
    expect(mockCreateAuth).not.toHaveBeenCalled();
  });

  it("rejects a revoked PAT with 401", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({
      hash,
      prefix,
      revokedAt: new Date(Date.now() - 1000),
    });

    const app = createPatApp();
    const res = await app.request(patRequest(plaintext));

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invalid API token");
    expect(mockCreateAuth).not.toHaveBeenCalled();
  });

  it("rejects a malformed PAT (correct prefix but no matching row) with 401 — does NOT fall through to cookie auth", async () => {
    // Looks like a PAT, will hash to something nothing matches → 401.
    // This is the critical downgrade-attack test: even if a stale cookie were
    // sent alongside a bogus PAT, the PAT branch must own the request.
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: "downgraded", email: "x@x", name: "x" },
          session: { id: "session-downgrade" },
        }),
      },
    } as never);

    const malformed = `${TOKEN_PREFIX}short`;
    const app = createPatApp();
    const res = await app.request(
      new Request("http://localhost/test", {
        headers: {
          authorization: `Bearer ${malformed}`,
          cookie: "better-auth.session_token=valid-cookie",
        },
      }),
    );

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invalid API token");

    // The cookie path must have been skipped entirely.
    expect(mockCreateAuth).not.toHaveBeenCalled();
  });

  it("falls through to better-auth for non-PAT bearers (e.g. session bearer plugin)", async () => {
    // Authorization is a bearer but NOT a cdn_pat_ — better-auth gets first look.
    const fakeUser = { id: "fb", email: "fb@example.com", name: "Fallback" };
    const fakeSession = { id: "sfb", expiresAt: new Date() };
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: fakeUser,
          session: fakeSession,
        }),
      },
    } as never);

    const app = createPatApp();
    const res = await app.request(
      new Request("http://localhost/test", {
        headers: { authorization: "Bearer some-non-pat-bearer" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockCreateAuth).toHaveBeenCalled();
    const body = await res.json<{
      user: typeof fakeUser | null;
      apiToken: unknown;
    }>();
    expect(body.user).toEqual(fakeUser);
    expect(body.apiToken).toBeNull();
  });

  it("sets apiToken to null on cookie-authenticated requests", async () => {
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
          session: { id: "s-cookie" },
        }),
      },
    } as never);

    const app = createPatApp();
    const res = await app.request(
      new Request("http://localhost/test", {
        headers: { cookie: "better-auth.session_token=valid" },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ apiToken: unknown }>();
    expect(body.apiToken).toBeNull();
  });

  it("sets apiToken to null on the no-credentials early-exit branch", async () => {
    const app = createPatApp();
    const res = await app.request(new Request("http://localhost/test"));

    expect(res.status).toBe(200);
    const body = await res.json<{
      user: null;
      session: null;
      apiToken: null;
    }>();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();
    expect(body.apiToken).toBeNull();
  });
});
