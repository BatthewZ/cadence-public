/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the API token management handlers.
 *
 * ## Why these tests matter
 *
 * Token management is the single most security-sensitive surface in the
 * application: a bug here is a credential-leak primitive. Every test below
 * locks in one specific invariant that, if regressed silently, would let
 * an attacker either pivot a compromised PAT into more PATs, exfiltrate
 * the SHA-256 hash, or grow a token's authority beyond what the minting
 * user actually holds.
 *
 * Concretely we cover:
 *  - **Plaintext-once contract.** Mint returns plaintext, no later endpoint
 *    does, and the persisted row stores the hash (never the plaintext).
 *  - **Scope hygiene.** Unknown scopes are rejected by name; duplicates
 *    are rejected; projectIds outside the workspace are rejected; the
 *    `expiresInDays` default and ceiling are enforced.
 *  - **PAT lockout.** Every endpoint refuses requests that arrived under a
 *    PAT (so a compromised token cannot mint siblings).
 *  - **Ownership / admin escalation.** Members only see their own tokens
 *    on list/detail/delete; admins see siblings; only owners can rotate.
 *  - **Rotation lifecycle.** Mints a sibling with the same scopes/project
 *    scope/expiry, points the old row at the new id, schedules the old
 *    row for revocation in 7 days, rejects rotation of revoked/already-
 *    rotated tokens.
 *  - **Workspace isolation.** Tokens minted in workspace A never appear in
 *    workspace B's list (catches mis-scoped WHERE clauses).
 *  - **Email side-effect.** Creation triggers the audit email; the email
 *    body carries the user-supplied token name and resolved scopes.
 *
 * The test harness wires a minimal Hono app per `describe` block, primes
 * `c.set("apiToken", ...)` directly to simulate PAT vs cookie auth, and
 * uses a real in-memory D1 (Miniflare) so the persisted-hash invariants
 * are checked against actual SQL.
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

import type { ApiToken } from "../../../db/schema";
import type { AppEnv } from "../../env";
import { hashToken, KNOWN_SCOPES } from "../../lib/api-tokens";
// ---------------------------------------------------------------------------
// Mock the email service. We import the module by absolute path used in the
// handler so the vi.mock substitution lines up at module-resolution time.
// The handler asks `createEmailService` for a transport, so we hand back a
// stub whose `send` is a vi.fn — that lets tests assert the security email
// was actually dispatched.
// ---------------------------------------------------------------------------
// We type the stub against the EmailService.send signature so
// `mock.calls[0][0]` carries the right message shape downstream.
import type { EmailMessage, EmailSendResult } from "../../lib/email/types";
import { rejectPatAuth } from "../../middleware/authorize";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedProject,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_TOKEN_HASH_PEPPER,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";

const mockEmailSend = vi.fn<(msg: EmailMessage) => Promise<EmailSendResult>>(
  () => Promise.resolve({ id: "test-email-id" }),
);
vi.mock("../../lib/email", () => ({
  createEmailService: vi.fn(() => ({ send: mockEmailSend })),
}));

import {
  createApiToken,
  createApiTokenSchema,
  getApiToken,
  listApiTokens,
  listApiTokensQuerySchema,
  revokeApiToken,
  rotateApiToken,
} from "./api-tokens.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let otherWorkspaceId: string;
let projectId: string;
let otherWorkspaceProjectId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  otherWorkspaceId = await seedWorkspace(d1, TEST_USER.id, {
    slug: "other-ws",
    name: "Other",
  });
  projectId = await seedProject(d1, workspaceId, { name: "Token Test Project" });
  otherWorkspaceProjectId = await seedProject(d1, otherWorkspaceId, {
    name: "Foreign Project",
  });
  // Add TEST_USER_2 to the primary workspace as a regular member so we can
  // test cross-user visibility and admin-vs-member listing rules.
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
});

afterAll(async () => {
  await dispose();
});

beforeEach(() => {
  mockEmailSend.mockClear();
});

afterEach(async () => {
  // Each test seeds its own tokens; clean up so list-counting tests stay
  // isolated. We delete by hand rather than re-running migrations because
  // the migration cost dominates the test runtime.
  await d1.prepare("DELETE FROM api_token").run();
});

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

type TokenRowOpts = {
  id?: string;
  userId?: string;
  workspaceId?: string;
  name?: string;
  tokenHash?: string;
  tokenPrefix?: string;
  scopes?: string[];
  projectScope?: "all" | "selected";
  projectIds?: string[] | null;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  revokeAt?: Date | null;
  rotatedToId?: string | null;
};

/**
 * Insert a token row directly into D1 so tests don't have to go through the
 * mint endpoint when they only need a target for list/get/rotate/revoke
 * assertions. Mirrors the seed-helper conventions in test-utils/seed.ts.
 */
async function seedApiToken(opts: TokenRowOpts = {}): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  const userId = opts.userId ?? TEST_USER.id;
  const wsId = opts.workspaceId ?? workspaceId;
  const name = opts.name ?? "Seed Token";
  const hash =
    opts.tokenHash ?? `hash-${id}`.padEnd(64, "0").slice(0, 64);
  const prefix = opts.tokenPrefix ?? `cdn_pat_${id.slice(0, 4)}`;
  const scopes = JSON.stringify(opts.scopes ?? ["workspace:read"]);
  const projectScope = opts.projectScope ?? "all";
  const projectIdsJson =
    opts.projectIds === null || opts.projectIds === undefined
      ? null
      : JSON.stringify(opts.projectIds);
  const toSec = (d: Date | null | undefined) =>
    d ? Math.floor(d.getTime() / 1000) : null;
  await d1
    .prepare(
      `INSERT INTO api_token (id, userId, workspaceId, name, tokenHash, tokenPrefix, scopes, projectScope, projectIds, lastUsedAt, expiresAt, revokeAt, revokedAt, rotatedToId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      wsId,
      name,
      hash,
      prefix,
      scopes,
      projectScope,
      projectIdsJson,
      null,
      toSec(opts.expiresAt ?? null),
      toSec(opts.revokeAt ?? null),
      toSec(opts.revokedAt ?? null),
      opts.rotatedToId ?? null,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return id;
}

type Caller = {
  user?: { id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: Date; updatedAt: Date };
  role?: "owner" | "admin" | "member";
  apiToken?: ApiToken | null;
  workspaceId?: string;
};

/**
 * Mount the named handler on a fake app, with the auth context primed to
 * either a cookie session or a PAT depending on the `apiToken` option. The
 * `requireWorkspaceMember`-equivalent context priming happens via fakeAuth's
 * `workspaceMembership` option so handler-level role checks see the
 * intended role.
 */
function buildApp(
  caller: Caller,
  mountFn: (app: Hono<AppEnv>) => void,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const wsId = caller.workspaceId ?? workspaceId;
  app.use(
    "/*",
    fakeAuth(d1, caller.user ?? TEST_USER, {
      workspaceMembership: {
        id: "wm-test",
        workspaceId: wsId,
        role: caller.role ?? "owner",
      },
    }),
  );
  // Layer in the PAT marker after fakeAuth so the production
  // `rejectPatAuth()` middleware can observe the PAT context. fakeAuth does
  // not touch apiToken so we override explicitly per test.
  app.use("/*", async (c, next) => {
    if (caller.apiToken !== undefined) c.set("apiToken", caller.apiToken);
    else c.set("apiToken", null);
    // Provide BETTER_AUTH_URL on the env so the email link composes cleanly.
    (c.env as Record<string, unknown>).BETTER_AUTH_URL =
      "https://cadence.example.com";
    (c.env as Record<string, unknown>).TOKEN_HASH_PEPPER = TEST_TOKEN_HASH_PEPPER;
    await next();
  });
  // Mount the production PAT-lockout middleware (M3). The handlers
  // themselves no longer call rejectPatCaller — the policy lives once at
  // the route group level, so to exercise that lockout in handler tests we
  // need to install the same middleware here.
  app.use("/*", rejectPatAuth());
  mountFn(app);
  return app;
}

function fakePatToken(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: "tok_test",
    userId: TEST_USER.id,
    workspaceId,
    name: "test pat",
    tokenHash: "hash",
    tokenPrefix: "cdn_pat_xxxx",
    scopes: JSON.stringify(["workspace:read"]),
    projectScope: "all",
    projectIds: null,
    lastUsedAt: null,
    expiresAt: null,
    revokeAt: null,
    revokedAt: null,
    rotatedToId: null,
    createdAt: new Date(),
    ...overrides,
  } as ApiToken;
}

// ---------------------------------------------------------------------------
// createApiToken (POST /workspaces/:workspaceId/api-tokens)
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/api-tokens — createApiToken", () => {
  function mountCreate(app: Hono<AppEnv>) {
    app.post(
      "/workspaces/:workspaceId/api-tokens",
      validateBody(createApiTokenSchema),
      createApiToken,
    );
  }

  it("mints a token, returns plaintext exactly once, persists only the hash, and sends the audit email", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Slack integration",
        scopes: ["task:read", "task:write"],
        projectScope: "all",
      }),
      undefined,
      {},
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ token: { id: string; plaintext: string; tokenPrefix: string; scopes: string[]; projectScope: string; status: string } }>();
    expect(body.token.plaintext).toMatch(/^cdn_pat_/);
    expect(body.token.tokenPrefix).toBe(body.token.plaintext.slice(0, 12));
    expect(body.token.scopes.sort()).toEqual(["task:read", "task:write"]);
    expect(body.token.projectScope).toBe("all");
    expect(body.token.status).toBe("active");

    // The persisted row stores only the hash — never the plaintext.
    const expectedHash = await hashToken(body.token.plaintext, TEST_TOKEN_HASH_PEPPER);
    const persisted = await d1
      .prepare("SELECT tokenHash, scopes, projectScope, projectIds, expiresAt FROM api_token WHERE id = ?")
      .bind(body.token.id)
      .first<{ tokenHash: string; scopes: string; projectScope: string; projectIds: string | null; expiresAt: number | null }>();
    expect(persisted?.tokenHash).toBe(expectedHash);
    expect(persisted?.projectScope).toBe("all");
    expect(persisted?.projectIds).toBeNull();
    // Default expiry kicks in (365d) since the request omitted expiresInDays.
    expect(persisted?.expiresAt).not.toBeNull();

    // Audit email was dispatched (deferWork runs inline in tests).
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.to).toBe(TEST_USER.email);
    expect(call.subject).toContain("API token");
    expect(call.html).toContain("Slack integration");
  });

  it("defaults expiresInDays to 365 when omitted", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const before = Date.now();
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Default expiry",
        scopes: ["workspace:read"],
        projectScope: "all",
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ token: { id: string; expiresAt: string } }>();
    const expiresAtMs = new Date(body.token.expiresAt).getTime();
    const expectedMin = before + 364 * 24 * 60 * 60 * 1000;
    const expectedMax = Date.now() + 366 * 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAtMs).toBeLessThanOrEqual(expectedMax);
  });

  it("rejects expiresInDays above the 3650 ceiling", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Too long",
        scopes: ["workspace:read"],
        projectScope: "all",
        expiresInDays: 3651,
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown scopes by name", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Bad scope",
        scopes: ["workspace:read", "totally:fake"],
        projectScope: "all",
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("totally:fake");
  });

  it("rejects duplicate scopes", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Dup",
        scopes: ["workspace:read", "workspace:read"],
        projectScope: "all",
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(400);
  });

  it("rejects projectScope=selected with no projectIds", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Missing ids",
        scopes: ["project:read"],
        projectScope: "selected",
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(400);
  });

  it("rejects projectIds that do not belong to the workspace", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Foreign project",
        scopes: ["project:read"],
        projectScope: "selected",
        projectIds: [otherWorkspaceProjectId],
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain(otherWorkspaceProjectId);
  });

  it("accepts projectScope=selected with valid project ids", async () => {
    const app = buildApp({ role: "owner" }, mountCreate);
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Scoped",
        scopes: ["project:read"],
        projectScope: "selected",
        projectIds: [projectId],
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ token: { projectScope: string; projectIds: string[] | null } }>();
    expect(body.token.projectScope).toBe("selected");
    expect(body.token.projectIds).toEqual([projectId]);
  });

  it("returns 403 when the caller authenticated with a PAT", async () => {
    const app = buildApp(
      { role: "owner", apiToken: fakePatToken() },
      mountCreate,
    );
    const res = await app.request(
      jsonRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
        name: "Pat cannot mint",
        scopes: ["workspace:read"],
        projectScope: "all",
      }),
      undefined,
      {},
    );
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("API tokens cannot manage");
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listApiTokens
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/api-tokens — listApiTokens", () => {
  function mountList(app: Hono<AppEnv>) {
    // `validateQuery` mirrors what the OpenAPI route does in production so
    // tests exercise the same parse path as real traffic. Without it, the
    // handler still works (it tolerates an unvalidated context for
    // robustness) but we would not catch a schema-level regression.
    app.get(
      "/workspaces/:workspaceId/api-tokens",
      validateQuery(listApiTokensQuerySchema),
      listApiTokens,
    );
  }

  it("returns the caller's own tokens (no tokenHash field)", async () => {
    await seedApiToken({ name: "Mine", userId: TEST_USER.id });
    await seedApiToken({ name: "Other user", userId: TEST_USER_2.id });

    const app = buildApp({ role: "member" }, mountList);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tokens: Array<{ name: string; userId: string; tokenHash?: string }> }>();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0].name).toBe("Mine");
    expect(body.tokens[0].userId).toBe(TEST_USER.id);
    expect((body.tokens[0] as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  it("admins see every member's tokens in the workspace", async () => {
    await seedApiToken({ name: "Mine", userId: TEST_USER.id });
    await seedApiToken({ name: "Sibling", userId: TEST_USER_2.id });

    const app = buildApp({ role: "admin" }, mountList);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tokens: Array<{ name: string }> }>();
    expect(body.tokens.map((t) => t.name).sort()).toEqual(["Mine", "Sibling"]);
  });

  it("ignores tokens from sibling workspaces", async () => {
    await seedApiToken({ name: "Here", workspaceId });
    await seedApiToken({ name: "There", workspaceId: otherWorkspaceId });

    const app = buildApp({ role: "owner" }, mountList);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tokens: Array<{ name: string }> }>();
    expect(body.tokens.map((t) => t.name)).toEqual(["Here"]);
  });

  it("returns 403 for PAT-authenticated callers", async () => {
    const app = buildApp(
      { role: "owner", apiToken: fakePatToken() },
      mountList,
    );
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens`,
      undefined,
      {},
    );
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------
  // includeRevoked filter
  //
  // Revoked tokens are tombstoned (never hard-deleted) so audit attribution
  // survives. Without this filter the workspace settings list grew without
  // bound — every rotated/revoked token from years past stayed visible.
  // These tests pin both the default-hide behaviour and the opt-in path the
  // "Show revoked" toggle uses.
  // ---------------------------------------------------------------------
  it("hides revoked tokens by default", async () => {
    await seedApiToken({ name: "Active", userId: TEST_USER.id });
    await seedApiToken({
      name: "Revoked",
      userId: TEST_USER.id,
      revokedAt: new Date(),
    });

    const app = buildApp({ role: "owner" }, mountList);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tokens: Array<{ name: string }> }>();
    expect(body.tokens.map((t) => t.name)).toEqual(["Active"]);
  });

  it("includes revoked tokens when includeRevoked=true", async () => {
    await seedApiToken({ name: "Active", userId: TEST_USER.id });
    await seedApiToken({
      name: "Revoked",
      userId: TEST_USER.id,
      revokedAt: new Date(),
    });

    const app = buildApp({ role: "owner" }, mountList);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens?includeRevoked=true`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tokens: Array<{ name: string; status: string }> }>();
    expect(body.tokens.map((t) => t.name).sort()).toEqual(["Active", "Revoked"]);
    // The hidden-by-default contract also implies the status field still
    // surfaces "revoked" — the FE relies on it to render the red badge.
    const revoked = body.tokens.find((t) => t.name === "Revoked");
    expect(revoked?.status).toBe("revoked");
  });

  it("hides revoked tokens when includeRevoked=false (explicit)", async () => {
    await seedApiToken({ name: "Active", userId: TEST_USER.id });
    await seedApiToken({
      name: "Revoked",
      userId: TEST_USER.id,
      revokedAt: new Date(),
    });

    const app = buildApp({ role: "owner" }, mountList);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens?includeRevoked=false`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tokens: Array<{ name: string }> }>();
    expect(body.tokens.map((t) => t.name)).toEqual(["Active"]);
  });

  it("rejects non-canonical includeRevoked values with 400", async () => {
    const app = buildApp({ role: "owner" }, mountList);
    // The enum schema only accepts the literal strings "true" / "false". A
    // bare `?includeRevoked=1` must fail loudly rather than silently mean
    // "hide" — silent acceptance is how the `coerce.boolean()` footgun
    // (every non-empty string → true) creeps into APIs.
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens?includeRevoked=1`,
      undefined,
      {},
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// getApiToken
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/api-tokens/:tokenId — getApiToken", () => {
  function mountGet(app: Hono<AppEnv>) {
    app.get("/workspaces/:workspaceId/api-tokens/:tokenId", getApiToken);
  }

  it("owner can fetch their own token detail", async () => {
    const id = await seedApiToken({ name: "Detailed", userId: TEST_USER.id });
    const app = buildApp({ role: "member" }, mountGet);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens/${id}`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ token: { id: string; name: string; tokenHash?: string } }>();
    expect(body.token.id).toBe(id);
    expect(body.token.name).toBe("Detailed");
    expect((body.token as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  it("non-owner member receives 404 to avoid disclosing token existence", async () => {
    const id = await seedApiToken({ name: "Not yours", userId: TEST_USER_2.id });
    const app = buildApp({ role: "member" }, mountGet);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens/${id}`,
      undefined,
      {},
    );
    expect(res.status).toBe(404);
  });

  it("admin can fetch any member's token detail", async () => {
    const id = await seedApiToken({ name: "Admin view", userId: TEST_USER_2.id });
    const app = buildApp({ role: "admin" }, mountGet);
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens/${id}`,
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ token: { id: string } }>();
    expect(body.token.id).toBe(id);
  });

  it("returns 403 for PAT-authenticated callers", async () => {
    const id = await seedApiToken();
    const app = buildApp(
      { role: "owner", apiToken: fakePatToken() },
      mountGet,
    );
    const res = await app.request(
      `/workspaces/${workspaceId}/api-tokens/${id}`,
      undefined,
      {},
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// revokeApiToken
// ---------------------------------------------------------------------------

describe("DELETE /workspaces/:workspaceId/api-tokens/:tokenId — revokeApiToken", () => {
  function mountDelete(app: Hono<AppEnv>) {
    app.delete("/workspaces/:workspaceId/api-tokens/:tokenId", revokeApiToken);
  }

  it("owner can revoke their own token (sets revokedAt)", async () => {
    const id = await seedApiToken({ userId: TEST_USER.id });
    const app = buildApp({ role: "member" }, mountDelete);
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}`, { method: "DELETE" }),
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const row = await d1
      .prepare("SELECT revokedAt FROM api_token WHERE id = ?")
      .bind(id)
      .first<{ revokedAt: number | null }>();
    expect(row?.revokedAt).not.toBeNull();
  });

  it("admin can revoke another member's token", async () => {
    const id = await seedApiToken({ userId: TEST_USER_2.id });
    const app = buildApp({ role: "admin" }, mountDelete);
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}`, { method: "DELETE" }),
      undefined,
      {},
    );
    expect(res.status).toBe(200);
    const row = await d1
      .prepare("SELECT revokedAt FROM api_token WHERE id = ?")
      .bind(id)
      .first<{ revokedAt: number | null }>();
    expect(row?.revokedAt).not.toBeNull();
  });

  it("non-owner member cannot revoke someone else's token (404)", async () => {
    const id = await seedApiToken({ userId: TEST_USER_2.id });
    const app = buildApp({ role: "member" }, mountDelete);
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}`, { method: "DELETE" }),
      undefined,
      {},
    );
    expect(res.status).toBe(404);
    const row = await d1
      .prepare("SELECT revokedAt FROM api_token WHERE id = ?")
      .bind(id)
      .first<{ revokedAt: number | null }>();
    expect(row?.revokedAt).toBeNull();
  });

  it("returns 403 for PAT-authenticated callers", async () => {
    const id = await seedApiToken();
    const app = buildApp(
      { role: "owner", apiToken: fakePatToken() },
      mountDelete,
    );
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}`, { method: "DELETE" }),
      undefined,
      {},
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// rotateApiToken
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/api-tokens/:tokenId/rotate — rotateApiToken", () => {
  function mountRotate(app: Hono<AppEnv>) {
    app.post(
      "/workspaces/:workspaceId/api-tokens/:tokenId/rotate",
      rotateApiToken,
    );
  }

  it("creates a sibling with the same scopes/projectScope/projectIds/expiresAt, points old to new, sets a 7-day revokeAt, and returns plaintext", async () => {
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const oldId = await seedApiToken({
      userId: TEST_USER.id,
      name: "Original",
      scopes: ["task:read", "task:write"],
      projectScope: "selected",
      projectIds: [projectId],
      expiresAt,
    });

    const app = buildApp({ role: "owner" }, mountRotate);
    const before = Date.now();
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${oldId}/rotate`, { method: "POST" }),
      undefined,
      {},
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ token: { id: string; plaintext: string; scopes: string[]; projectScope: string; projectIds: string[] | null; expiresAt: string; name: string } }>();
    expect(body.token.plaintext).toMatch(/^cdn_pat_/);
    expect(body.token.scopes.sort()).toEqual(["task:read", "task:write"]);
    expect(body.token.projectScope).toBe("selected");
    expect(body.token.projectIds).toEqual([projectId]);
    expect(body.token.name).toBe("Original (rotated)");
    // Expiry is inherited byte-for-byte.
    expect(new Date(body.token.expiresAt).getTime()).toBe(
      Math.floor(expiresAt.getTime() / 1000) * 1000,
    );

    // Old token row points at new id and has revokeAt ~7 days out.
    const oldRow = await d1
      .prepare("SELECT rotatedToId, revokeAt, revokedAt FROM api_token WHERE id = ?")
      .bind(oldId)
      .first<{ rotatedToId: string | null; revokeAt: number | null; revokedAt: number | null }>();
    expect(oldRow?.rotatedToId).toBe(body.token.id);
    expect(oldRow?.revokedAt).toBeNull();
    const revokeAtMs = (oldRow?.revokeAt ?? 0) * 1000;
    const sevenDaysFromBefore = before + 7 * 24 * 60 * 60 * 1000;
    const sevenDaysFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(revokeAtMs).toBeGreaterThanOrEqual(sevenDaysFromBefore - 5000);
    expect(revokeAtMs).toBeLessThanOrEqual(sevenDaysFromNow + 5000);
  });

  it("rejects rotation of a revoked token (409)", async () => {
    const id = await seedApiToken({
      userId: TEST_USER.id,
      revokedAt: new Date(),
    });
    const app = buildApp({ role: "owner" }, mountRotate);
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}/rotate`, { method: "POST" }),
      undefined,
      {},
    );
    expect(res.status).toBe(409);
  });

  it("rejects rotation when the token is already rotating (409)", async () => {
    const successorId = await seedApiToken({ userId: TEST_USER.id, name: "successor" });
    const id = await seedApiToken({
      userId: TEST_USER.id,
      name: "old",
      rotatedToId: successorId,
    });
    const app = buildApp({ role: "owner" }, mountRotate);
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}/rotate`, { method: "POST" }),
      undefined,
      {},
    );
    expect(res.status).toBe(409);
  });

  it("non-owner cannot rotate someone else's token (403)", async () => {
    const id = await seedApiToken({ userId: TEST_USER_2.id });
    const app = buildApp({ role: "admin" }, mountRotate);
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}/rotate`, { method: "POST" }),
      undefined,
      {},
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for PAT-authenticated callers", async () => {
    const id = await seedApiToken();
    const app = buildApp(
      { role: "owner", apiToken: fakePatToken() },
      mountRotate,
    );
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/api-tokens/${id}/rotate`, { method: "POST" }),
      undefined,
      {},
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Sanity: scope grammar is in sync with the lib's KNOWN_SCOPES export so a
// test that hardcodes a scope name will fail loudly if the canonical set
// drifts. This keeps the test corpus from silently asserting against a
// stale grammar.
// ---------------------------------------------------------------------------
describe("KNOWN_SCOPES", () => {
  it("includes the scopes exercised in this file", () => {
    for (const s of [
      "workspace:read",
      "task:read",
      "task:write",
      "project:read",
    ]) {
      expect(KNOWN_SCOPES.has(s)).toBe(true);
    }
  });
});
