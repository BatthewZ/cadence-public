/// <reference types="@cloudflare/workers-types" />
/**
 * End-to-end integration tests for the Personal Access Token (PAT) feature.
 *
 * ## Scope and why this file exists
 *
 * Unlike `api-tokens.handlers.test.ts` — which exercises individual handler
 * functions with a primed context — this file exercises the FULL request
 * path: the real Hono router from {@link routes}, the real
 * {@link authSessionMiddleware} (PAT branch and cookie branch), the real
 * {@link verifyToken} / {@link hashToken} primitives, and a real in-memory
 * D1 backend.
 *
 * The boundary we are testing is the integration of:
 *  - PAT minting via cookie-authed call
 *  - PAT verification (hash + revocation + expiry + membership) on subsequent
 *    Bearer-authed calls
 *  - The PAT-lockout contract that prevents a PAT from minting/revoking
 *    sibling tokens
 *  - Rotation lifecycle: sibling minted, old token kept alive for 7d, then
 *    the scheduled-handler sweep finalises revocation
 *  - Workspace-scope and project-scope guards on real `:workspaceId` and
 *    `:projectId` routes
 *  - Tampered-token rejection: a syntactically valid `cdn_pat_…` that does
 *    not match any DB row must produce a clean 401
 *
 * The only thing we mock is the better-auth session resolver and the email
 * service — both are external boundaries (HTTP-cookie session + SMTP) that
 * the PAT integration boundary does not own.
 */

import { Hono } from "hono";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks must be declared BEFORE importing the modules under
// test so vitest's hoisting wires the substitutions before route handlers
// resolve their dependencies.
// ---------------------------------------------------------------------------

vi.mock("../../lib/auth", () => ({
  createAuth: vi.fn(),
  resolveAllowedOrigin: (origin: string | undefined) => origin ?? null,
  resetAuthCache: vi.fn(),
}));

type EmailMessage = { to: string; from?: string; subject: string; html: string; text?: string };
const mockEmailSend = vi.fn<(msg: EmailMessage) => Promise<{ id: string }>>(() =>
  Promise.resolve({ id: "test-email-id" }),
);
vi.mock("../../lib/email", () => ({
  createEmailService: vi.fn(() => ({ send: mockEmailSend })),
}));

import { createDb } from "../../../db";
import type { AppEnv } from "../../env";
import { TOKEN_PREFIX } from "../../lib/api-tokens";
import { createAuth } from "../../lib/auth";
import { authSessionMiddleware } from "../../middleware/auth";
import routes from "../../routes";
import { processScheduledTokenRevocations } from "../../scheduled/api-token-revocation";
import {
  createTestD1,
  seedProject,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_TOKEN_HASH_PEPPER,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let otherWorkspaceId: string;
let projectInPrimary: string;
let otherProjectInPrimary: string;

const mockCreateAuth = vi.mocked(createAuth);

/**
 * Build a `getSession` mock that resolves to TEST_USER when a cookie is
 * present and to null otherwise. Mirrors better-auth's actual behavior
 * closely enough that the auth middleware exercises both its branches.
 */
function installCookieAuthMock() {
  mockCreateAuth.mockImplementation(
    () =>
      ({
        api: {
          getSession: vi.fn(({ headers }: { headers: Headers }) => {
            const cookie = headers.get("cookie") ?? "";
            if (!cookie.includes("better-auth.session_token=")) {
              return Promise.resolve(null);
            }
            return Promise.resolve({
              user: { ...TEST_USER },
              session: {
                id: "test-session-id",
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              },
            });
          }),
        },
      }) as never,
  );
}

/**
 * Build a Hono app that mirrors the production wiring just closely enough
 * for the auth + routes integration to be exercised end-to-end:
 *
 *  1. Set `db` on context (matches the per-request middleware in
 *     `src/api/index.ts`). MUST run BEFORE authSessionMiddleware because
 *     the PAT branch reads `c.get("db")` to verify the token.
 *  2. Run the real `authSessionMiddleware`.
 *  3. Mount the real route tree at `/`.
 *
 * The standalone production globals (request id, logger, telemetry, CORS,
 * security headers) are deliberately omitted — they are tested separately
 * and only add noise to the PAT integration boundary we care about here.
 */
function buildE2EApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    // Make c.env writable for our test bindings (Hono's test mode has env undefined).
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    const env = c.env as Record<string, unknown>;
    env.DB = d1;
    env.BETTER_AUTH_SECRET = "test-secret";
    env.BETTER_AUTH_URL = "http://localhost";
    env.TOKEN_HASH_PEPPER = TEST_TOKEN_HASH_PEPPER;
    c.set("db", createDb(d1));
    c.set("requestId", "test-request-id");
    await next();
  });

  app.use("*", authSessionMiddleware);
  app.route("/", routes);
  return app;
}

/**
 * Request constructor that attaches a session cookie so the cookie-auth
 * branch fires inside `authSessionMiddleware`.
 */
function cookieRequest(
  method: string,
  path: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = {
    cookie: "better-auth.session_token=test-session-token",
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

/**
 * Request constructor that attaches a PAT bearer token so the PAT branch
 * fires inside `authSessionMiddleware`.
 */
function patRequest(
  plaintext: string,
  method: string,
  path: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${plaintext}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  otherWorkspaceId = await seedWorkspace(d1, TEST_USER.id, {
    slug: "other-ws",
    name: "Other Workspace",
  });
  projectInPrimary = await seedProject(d1, workspaceId, { name: "Primary P" });
  otherProjectInPrimary = await seedProject(d1, workspaceId, {
    name: "Sibling P",
  });
  // Ensure TEST_USER_2 is also a member of the primary workspace so the
  // workspace listing endpoint returns a deterministic shape.
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
});

afterAll(async () => {
  await dispose();
});

beforeEach(() => {
  installCookieAuthMock();
  mockEmailSend.mockClear();
});

afterEach(async () => {
  await d1.prepare("DELETE FROM api_token").run();
});

// ---------------------------------------------------------------------------
// Scenario 1 — Full lifecycle (cookie auth → mint → use as Bearer → revoke)
// ---------------------------------------------------------------------------

describe("E2E: full lifecycle", () => {
  it("mints via cookie, authenticates with the plaintext, then revokes and rejects further use", async () => {
    const app = buildE2EApp();

    // 1. Mint a token via cookie auth.
    const mintRes = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Lifecycle test",
        scopes: ["workspace:read"],
        projectScope: "all",
      }),
    );
    expect(mintRes.status).toBe(201);
    const minted = await mintRes.json<{
      token: { id: string; plaintext: string };
    }>();
    expect(minted.token.plaintext).toMatch(/^cdn_pat_/);

    // 2. Use the plaintext as a Bearer to GET /workspaces.
    const listRes = await app.request(
      patRequest(minted.token.plaintext, "GET", "/workspaces"),
    );
    expect(listRes.status).toBe(200);

    // 3. Revoke the token via cookie auth.
    const revokeRes = await app.request(
      cookieRequest(
        "DELETE",
        `/workspaces/${workspaceId}/api-tokens/${minted.token.id}`,
      ),
    );
    expect(revokeRes.status).toBe(200);

    // 4. The plaintext now must not authenticate.
    const afterRevoke = await app.request(
      patRequest(minted.token.plaintext, "GET", "/workspaces"),
    );
    expect(afterRevoke.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Rotation flow with 7-day grace, then scheduled sweep
// ---------------------------------------------------------------------------

describe("E2E: rotation flow with grace period", () => {
  it("rotates, both tokens work during grace, sweep revokes the old after revokeAt elapses", async () => {
    const app = buildE2EApp();

    // Mint the original token (plaintext A).
    const mintRes = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Rotation original",
        scopes: ["workspace:read"],
        projectScope: "all",
      }),
    );
    expect(mintRes.status).toBe(201);
    const original = await mintRes.json<{
      token: { id: string; plaintext: string };
    }>();
    const plaintextA = original.token.plaintext;

    // Rotate — yields plaintext B and queues plaintext A for revocation.
    const rotateRes = await app.request(
      cookieRequest(
        "POST",
        `/workspaces/${workspaceId}/api-tokens/${original.token.id}/rotate`,
      ),
    );
    expect(rotateRes.status).toBe(201);
    const rotated = await rotateRes.json<{
      token: { id: string; plaintext: string };
    }>();
    const plaintextB = rotated.token.plaintext;
    expect(plaintextB).not.toBe(plaintextA);

    // Both A and B must authenticate during the grace window.
    const aDuringGrace = await app.request(
      patRequest(plaintextA, "GET", "/workspaces"),
    );
    expect(aDuringGrace.status).toBe(200);
    const bDuringGrace = await app.request(
      patRequest(plaintextB, "GET", "/workspaces"),
    );
    expect(bDuringGrace.status).toBe(200);

    // The DB row for the original must point at the new id and have a
    // future revokeAt approximately 7 days out.
    const oldRow = await d1
      .prepare(
        "SELECT rotatedToId, revokeAt, revokedAt FROM api_token WHERE id = ?",
      )
      .bind(original.token.id)
      .first<{ rotatedToId: string | null; revokeAt: number | null; revokedAt: number | null }>();
    expect(oldRow?.rotatedToId).toBe(rotated.token.id);
    expect(oldRow?.revokedAt).toBeNull();
    const expectedRevokeAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const revokeAtMs = (oldRow?.revokeAt ?? 0) * 1000;
    // Allow a 30s window for the test machine.
    expect(revokeAtMs).toBeGreaterThan(expectedRevokeAtMs - 60_000);
    expect(revokeAtMs).toBeLessThan(expectedRevokeAtMs + 60_000);

    // Simulate cron advance: fast-forward revokeAt to one minute ago.
    const pastSec = Math.floor(Date.now() / 1000) - 60;
    await d1
      .prepare("UPDATE api_token SET revokeAt = ? WHERE id = ?")
      .bind(pastSec, original.token.id)
      .run();

    // Run the sweep.
    const db = createDb(d1);
    const revoked = await processScheduledTokenRevocations(db);
    expect(revoked).toBe(1);

    // Plaintext A must now be rejected; plaintext B must still work.
    const aAfterSweep = await app.request(
      patRequest(plaintextA, "GET", "/workspaces"),
    );
    expect(aAfterSweep.status).toBe(401);
    const bAfterSweep = await app.request(
      patRequest(plaintextB, "GET", "/workspaces"),
    );
    expect(bAfterSweep.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Scope enforcement: PAT-lockout on token management endpoints
// ---------------------------------------------------------------------------

describe("E2E: PAT lockout on token-management endpoints", () => {
  it("a narrowly-scoped PAT can read but cannot mint sibling tokens", async () => {
    const app = buildE2EApp();

    // Mint a read-only PAT via cookie auth.
    const mintRes = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Read-only",
        scopes: ["workspace:read"],
        projectScope: "all",
      }),
    );
    expect(mintRes.status).toBe(201);
    const minted = await mintRes.json<{ token: { plaintext: string } }>();

    // The read scope should let it list workspaces.
    const readRes = await app.request(
      patRequest(minted.token.plaintext, "GET", "/workspaces"),
    );
    expect(readRes.status).toBe(200);

    // The PAT-lockout (independent of scope) must block sibling mint.
    const mintViaPatRes = await app.request(
      patRequest(
        minted.token.plaintext,
        "POST",
        `/workspaces/${workspaceId}/api-tokens`,
        {
          name: "Pat cannot mint",
          scopes: ["workspace:read"],
          projectScope: "all",
        },
      ),
    );
    expect(mintViaPatRes.status).toBe(403);
    const body = await mintViaPatRes.json<{ error: string }>();
    expect(body.error).toContain("API tokens cannot manage");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Workspace-scope guard
// ---------------------------------------------------------------------------

describe("E2E: workspace-scope guard", () => {
  it("a token bound to workspace A cannot act on workspace B", async () => {
    const app = buildE2EApp();

    // Mint a token in workspace A (the primary one).
    const mintRes = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "WS-A token",
        scopes: ["workspace:read"],
        projectScope: "all",
      }),
    );
    expect(mintRes.status).toBe(201);
    const minted = await mintRes.json<{ token: { plaintext: string } }>();

    // The same plaintext used against workspace B's :workspaceId route must
    // 403 — the token's workspaceId is the boundary, NOT the user's
    // workspace memberships (the user owns both workspaces).
    const crossRes = await app.request(
      patRequest(minted.token.plaintext, "GET", `/workspaces/${otherWorkspaceId}`),
    );
    expect(crossRes.status).toBe(403);

    // Sanity: against the correct workspace it works.
    const sameRes = await app.request(
      patRequest(minted.token.plaintext, "GET", `/workspaces/${workspaceId}`),
    );
    expect(sameRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Project-scope guard (selected list enforcement)
// ---------------------------------------------------------------------------

describe("E2E: project-scope guard", () => {
  it("token with projectScope=selected only authorises the listed projects", async () => {
    const app = buildE2EApp();

    // Mint a token that can only see `projectInPrimary`.
    const mintRes = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Selected project",
        scopes: ["project:read"],
        projectScope: "selected",
        projectIds: [projectInPrimary],
      }),
    );
    expect(mintRes.status).toBe(201);
    const minted = await mintRes.json<{ token: { plaintext: string } }>();

    // Allowed: the listed project.
    const allowed = await app.request(
      patRequest(minted.token.plaintext, "GET", `/projects/${projectInPrimary}`),
    );
    expect(allowed.status).toBe(200);

    // Forbidden: a sibling project in the same workspace not on the list.
    const denied = await app.request(
      patRequest(
        minted.token.plaintext,
        "GET",
        `/projects/${otherProjectInPrimary}`,
      ),
    );
    expect(denied.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Tampered token (correct prefix, random body, no DB row)
// ---------------------------------------------------------------------------

describe("E2E: tampered token", () => {
  it("rejects a syntactically valid PAT prefix that does not exist in the DB", async () => {
    const app = buildE2EApp();

    // Build a plausible-looking but unknown token: prefix + 32 random
    // base64url-style characters. The verify path must hash it and fail
    // the DB lookup → 401.
    const tampered = `${TOKEN_PREFIX}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(tampered).toMatch(/^cdn_pat_[A-Za-z0-9_-]{32}$/);

    const res = await app.request(
      patRequest(tampered, "GET", "/workspaces"),
    );
    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("Invalid API token");
  });

  it("rejects a Bearer with the wrong prefix without falling through to cookie auth", async () => {
    const app = buildE2EApp();

    // A bearer that does not start with cdn_pat_ deliberately is NOT a PAT;
    // the middleware lets it fall through to the better-auth session
    // resolver, which our mock answers with null since no cookie is
    // attached. So this surfaces as 401 from `requireAuth`.
    const res = await app.request(
      new Request(`http://localhost/workspaces`, {
        method: "GET",
        headers: { Authorization: "Bearer not-a-pat-token" },
      }),
    );
    expect(res.status).toBe(401);
  });
});
