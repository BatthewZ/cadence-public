/**
 * Tests for the authorize middleware family.
 *
 * Why these tests are critical: the authorize middleware is the load-bearing
 * gatekeeper between authentication (who you are) and the handler (what you
 * can do). Three policy layers stack here and any one of them being wrong
 * silently is an authorization bypass:
 *
 *   1. Membership / role  — the underlying human's role in the workspace or
 *      project. This is the legacy cookie-auth path.
 *   2. Token workspace scope — a PAT minted for workspace A must never act
 *      on workspace B even when its user is a member of both.
 *   3. Token project scope — a PAT with `projectScope: "selected"` must only
 *      see the explicit id list; a `selected` token with the wrong project
 *      ID gets the same 403 as a non-member.
 *   4. Token capability scope — `task:write`, `read:*`, etc. Cookie auth is
 *      grandfathered to bypass scope checks; PATs are enforced strictly.
 *
 * We exercise each layer independently AND in combination because real
 * requests hit them in sequence. Information disclosure matters: every
 * deny-path must return the same generic 403 body so an attacker cannot
 * distinguish "wrong workspace" from "no membership" from "wrong project
 * scope" — that distinction would let them enumerate token shape.
 *
 * We mock `resolveProjectAccess` / `resolveTaskAccess` because the
 * middleware's role is composition, not the underlying queries (which have
 * their own dedicated tests). This keeps these tests fast and focused on
 * the gate logic the middleware actually owns.
 */

import type { SQL } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { Context } from "hono";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiToken } from "../../db/schema";
import { notification } from "../../db/schema/notification";
import { project } from "../../db/schema/project";
import { task } from "../../db/schema/task";
import { webhook } from "../../db/schema/webhook";
import type { AppEnv } from "../env";

vi.mock("../lib/access", () => ({
  resolveProjectAccess: vi.fn(),
  resolveTaskAccess: vi.fn(),
}));

import { resolveProjectAccess, resolveTaskAccess } from "../lib/access";
import {
  enforceTokenWorkspaceWideAccess,
  requireProjectAccess,
  requireProjectRole,
  requireReadScopeForResource,
  requireTaskAccess,
  requireTokenScope,
  requireWorkspaceMember,
  requireWorkspaceRole,
  requireWriteScopeForResource,
  tokenAllowsProject,
  tokenProjectAllowList,
  tokenProjectScopeFilter,
  tokenWorkspaceScopeFilter,
} from "./authorize";

const mockResolveProjectAccess = vi.mocked(resolveProjectAccess);
const mockResolveTaskAccess = vi.mocked(resolveTaskAccess);

/**
 * Build a stub ApiToken row. The middleware only reads `workspaceId`,
 * `scopes`, `projectScope`, and `projectIds` — everything else is filler.
 * Going through `unknown` keeps the test from carrying every lifecycle
 * column; if the middleware ever begins consuming additional fields, the
 * compiler will fail loudly here and force a deliberate update.
 */
function fakeToken(overrides: Partial<ApiToken>): ApiToken {
  return {
    id: "tok_test",
    userId: "user_test",
    workspaceId: "ws_test",
    name: "test",
    tokenHash: "hash",
    tokenPrefix: "cdn_pat_abcd",
    scopes: JSON.stringify([]),
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

/**
 * Minimal user shape that satisfies the middleware's `c.get("user")` read.
 * The middleware only inspects `id`. Cast through unknown to avoid dragging
 * in better-auth's full plugin-augmented User type.
 */
function fakeUser(id = "user_test"): NonNullable<AppEnv["Variables"]["user"]> {
  return { id } as unknown as NonNullable<AppEnv["Variables"]["user"]>;
}

/**
 * Build an app with a priming middleware that seeds the auth context
 * (user, apiToken, db, workspaceMembership) from per-test fixtures, then
 * mounts the middleware under test on a route that asserts pass-through.
 *
 * We seed `workspaceMembership` directly when provided so the membership
 * code path uses the cached value and we do not need a real DB. This is
 * exactly how the auth middleware (M1's branch) primes PAT-authed
 * requests in production.
 */
type Fixture = {
  user?: NonNullable<AppEnv["Variables"]["user"]> | null;
  token?: ApiToken | null;
  membership?: AppEnv["Variables"]["workspaceMembership"];
  /**
   * Optional stand-in for the `db` handle. Only the "does this project row
   * exist at all?" fallback inside `getOrResolveProjectAccess` ever touches
   * it, so a test that needs to distinguish the middleware's 404 from its 403
   * supplies {@link projectLookupStub}; everything else leaves it unset and
   * gets the inert `{}`.
   */
  db?: AppEnv["Variables"]["db"];
};

/**
 * Minimal `db` double for the single query `getOrResolveProjectAccess` runs
 * when `resolveProjectAccess` came back null: `select(...).from(...)
 * .where(...).limit(1)`. Returning `rows` decides which branch the middleware
 * takes — `[]` means "no such project" (404) and a row means "project exists,
 * you just cannot see it" (403). That distinction is a real part of the
 * contract (a 404 tells a caller the id is wrong; a 403 tells them it is not
 * theirs), so it deserves a test that can actually fail rather than an
 * assertion that accepts either.
 */
function projectLookupStub(rows: { id: string }[]): AppEnv["Variables"]["db"] {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as unknown as AppEnv["Variables"]["db"];
}

function createApp(
  middleware: ReturnType<
    | typeof requireWorkspaceMember
    | typeof requireWorkspaceRole
    | typeof requireProjectAccess
    | typeof requireProjectRole
    | typeof requireTaskAccess
    | typeof requireTokenScope
    | typeof requireWriteScopeForResource
    | typeof requireReadScopeForResource
  >,
  fixture: Fixture,
  routePath = "/ws/:workspaceId",
) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "test-req");
    // Most cases seed `workspaceMembership` and mock the access resolvers, so
    // no query runs and a bare object is enough. The exception is the
    // project-not-found branch: `getOrResolveProjectAccess` falls through to a
    // real `select().from().where().limit()` to tell 404 from 403, and
    // `projectLookupStub` is what answers it. Hence `fixture.db`, and hence
    // the fallback rather than an unconditional stub.
    c.set("db", fixture.db ?? ({} as never));
    if (fixture.user !== undefined) c.set("user", fixture.user);
    if (fixture.token !== undefined) c.set("apiToken", fixture.token);
    if (fixture.membership !== undefined)
      c.set("workspaceMembership", fixture.membership);
    await next();
  });
  app.use(routePath, middleware);
  app.all(routePath, (c) => c.json({ ok: true }));
  app.all(`${routePath}/*`, (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  mockResolveProjectAccess.mockReset();
  mockResolveTaskAccess.mockReset();
});

// ---------------------------------------------------------------------------
// requireWorkspaceMember
// ---------------------------------------------------------------------------

describe("requireWorkspaceMember (PAT workspace-scope guard)", () => {
  it("passes when a PAT is scoped to the matching workspace", async () => {
    const app = createApp(requireWorkspaceMember(), {
      user: fakeUser(),
      token: fakeToken({ workspaceId: "ws_alpha" }),
      membership: { id: "m1", workspaceId: "ws_alpha", role: "owner" },
    });

    const res = await app.request("/ws/ws_alpha");
    expect(res.status).toBe(200);
  });

  it("returns 403 when a PAT is scoped to a different workspace", async () => {
    // The user IS a member of ws_beta, but their token is bound to ws_alpha.
    // The cookie-auth path would grant access here; the token must not.
    const app = createApp(requireWorkspaceMember(), {
      user: fakeUser(),
      token: fakeToken({ workspaceId: "ws_alpha" }),
      membership: { id: "m1", workspaceId: "ws_beta", role: "member" },
    });

    const res = await app.request("/ws/ws_beta");
    expect(res.status).toBe(403);
    // Generic message — no scope disclosure to the caller.
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Forbidden");
  });

  it("preserves cookie-auth behavior when no PAT is present", async () => {
    const app = createApp(requireWorkspaceMember(), {
      user: fakeUser(),
      token: null,
      membership: { id: "m1", workspaceId: "ws_gamma", role: "member" },
    });

    const res = await app.request("/ws/ws_gamma");
    expect(res.status).toBe(200);
  });

  it("returns 401 when no user is set", async () => {
    const app = createApp(requireWorkspaceMember(), { user: null });
    const res = await app.request("/ws/ws_x");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// requireWorkspaceRole
// ---------------------------------------------------------------------------

describe("requireWorkspaceRole (PAT workspace-scope guard)", () => {
  it("rejects a PAT bound to the wrong workspace even if the role matches", async () => {
    const app = createApp(requireWorkspaceRole("owner", "admin"), {
      user: fakeUser(),
      token: fakeToken({ workspaceId: "ws_alpha" }),
      membership: { id: "m1", workspaceId: "ws_beta", role: "owner" },
    });

    const res = await app.request("/ws/ws_beta");
    expect(res.status).toBe(403);
  });

  it("passes when both role and PAT workspace match", async () => {
    const app = createApp(requireWorkspaceRole("owner", "admin"), {
      user: fakeUser(),
      token: fakeToken({ workspaceId: "ws_alpha" }),
      membership: { id: "m1", workspaceId: "ws_alpha", role: "admin" },
    });

    const res = await app.request("/ws/ws_alpha");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// requireProjectAccess
// ---------------------------------------------------------------------------

describe("requireProjectAccess (PAT project-scope guard)", () => {
  it("passes a token scoped to all projects", async () => {
    mockResolveProjectAccess.mockResolvedValue({
      role: "admin",
      source: "workspace",
      project: { id: "proj_1", workspaceId: "ws_alpha" },
    });

    const app = createApp(
      requireProjectAccess(),
      {
        user: fakeUser(),
        // Workspace id matches the project's owning workspace — the two
        // halves of the binding policy are independent, and this case pins
        // the project-selection half in isolation.
        token: fakeToken({ workspaceId: "ws_alpha", projectScope: "all", projectIds: null }),
      },
      "/projects/:projectId",
    );

    const res = await app.request("/projects/proj_1");
    expect(res.status).toBe(200);
  });

  it("passes a `selected` token that includes the project", async () => {
    mockResolveProjectAccess.mockResolvedValue({
      role: "member",
      source: "project",
      project: { id: "proj_42", workspaceId: "ws_alpha" },
    });

    const app = createApp(
      requireProjectAccess(),
      {
        user: fakeUser(),
        token: fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_42", "proj_99"]),
        }),
      },
      "/projects/:projectId",
    );

    const res = await app.request("/projects/proj_42");
    expect(res.status).toBe(200);
  });

  it("returns 403 when a `selected` token excludes the project", async () => {
    // User has admin access via workspace role; cookie path would pass.
    // The token's selected-project list is the binding constraint.
    mockResolveProjectAccess.mockResolvedValue({
      role: "admin",
      source: "workspace",
      project: { id: "proj_other", workspaceId: "ws_alpha" },
    });

    const app = createApp(
      requireProjectAccess(),
      {
        user: fakeUser(),
        // Same workspace as the project, so ONLY the selected-project list
        // can be responsible for the denial.
        token: fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_42"]),
        }),
      },
      "/projects/:projectId",
    );

    const res = await app.request("/projects/proj_other");
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Forbidden");
  });

  it("returns 404 when the project does not exist (preserves cookie behavior)", async () => {
    // `resolveProjectAccess` returns null for BOTH "no such project" and "no
    // access", so the middleware disambiguates with a second lookup. Feeding
    // that lookup an empty result is the only way to pin the 404 branch — the
    // assertion used to accept 403/404/500 alike, which meant it could not
    // fail and told us nothing about which branch ran.
    mockResolveProjectAccess.mockResolvedValue(null);

    const app = createApp(
      requireProjectAccess(),
      { user: fakeUser(), token: null, db: projectLookupStub([]) },
      "/projects/:projectId",
    );

    const res = await app.request("/projects/proj_missing");
    expect(res.status).toBe(404);
    expect(mockResolveProjectAccess).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireProjectRole
// ---------------------------------------------------------------------------

describe("requireProjectRole (PAT project-scope guard)", () => {
  it("enforces the project-scope guard on the role-restricted variant", async () => {
    mockResolveProjectAccess.mockResolvedValue({
      role: "admin",
      source: "workspace",
      project: { id: "proj_other", workspaceId: "ws_alpha" },
    });

    const app = createApp(
      requireProjectRole("admin"),
      {
        user: fakeUser(),
        token: fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_42"]),
        }),
      },
      "/projects/:projectId",
    );

    const res = await app.request("/projects/proj_other");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// requireTaskAccess
// ---------------------------------------------------------------------------

describe("requireTaskAccess (PAT project-scope guard)", () => {
  it("uses the resolved owning-project id for the token check", async () => {
    mockResolveTaskAccess.mockResolvedValue({
      found: true,
      access: {
        role: "member",
        source: "project",
        project: { id: "proj_owner", workspaceId: "ws_alpha" },
      },
    });

    const app = createApp(
      requireTaskAccess(),
      {
        user: fakeUser(),
        token: fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_unrelated"]),
        }),
      },
      "/tasks/:taskId",
    );

    const res = await app.request("/tasks/task_1");
    expect(res.status).toBe(403);
  });

  it("passes when the task's owning project is in the selected list", async () => {
    mockResolveTaskAccess.mockResolvedValue({
      found: true,
      access: {
        role: "member",
        source: "project",
        project: { id: "proj_owner", workspaceId: "ws_alpha" },
      },
    });

    const app = createApp(
      requireTaskAccess(),
      {
        user: fakeUser(),
        token: fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_owner"]),
        }),
      },
      "/tasks/:taskId",
    );

    const res = await app.request("/tasks/task_1");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// requireTokenScope
// ---------------------------------------------------------------------------

describe("requireTokenScope", () => {
  it("passes when the token carries the exact required scope", async () => {
    const app = createApp(
      requireTokenScope("task:write"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:write"]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("returns 403 with a descriptive message when the scope is missing", async () => {
    const app = createApp(
      requireTokenScope("task:write"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:read"]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    // Token holders are integration developers — they NEED to know the
    // scope name so they can request it on the next mint.
    expect(body.error).toBe("Insufficient scope: requires task:write");
  });

  it("is a no-op for cookie auth (no apiToken in context)", async () => {
    const app = createApp(
      requireTokenScope("task:write"),
      { user: fakeUser(), token: null },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("honors the write:* aggregate", async () => {
    const app = createApp(
      requireTokenScope("task:write"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["write:*"]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("does NOT honor write:* for :delete scopes (heightened action)", async () => {
    const app = createApp(
      requireTokenScope("task:delete"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["write:*"]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// requireWriteScopeForResource
// ---------------------------------------------------------------------------

describe("requireWriteScopeForResource", () => {
  it("does not check scope on GET (read-scope factory handles that direction)", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task" }),
      {
        user: fakeUser(),
        // No scopes at all — would fail any scope check.
        token: fakeToken({ scopes: JSON.stringify([]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("requires <resource>:write on POST", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task" }),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:read"]) }),
      },
      "/",
    );

    const res = await app.request("/", { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Insufficient scope: requires task:write");
  });

  it("requires <resource>:write on PATCH and PUT", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task" }),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:write"]) }),
      },
      "/",
    );

    const patchRes = await app.request("/", { method: "PATCH" });
    expect(patchRes.status).toBe(200);

    const putRes = await app.request("/", { method: "PUT" });
    expect(putRes.status).toBe(200);
  });

  /**
   * DENY direction for PATCH/PUT — the half that actually proves enforcement.
   *
   * The allow-direction test above passes a token that already holds
   * `task:write`, so its 200 is the outcome whether the middleware checks the
   * right scope, the wrong scope, or nothing at all. Only a token WITHOUT the
   * scope can distinguish an enforcing middleware from a no-op. Without this
   * case, folding PATCH/PUT into the safe-method early return would ship
   * green while a read-only PAT could rewrite any record its owner can reach.
   */
  it("refuses PATCH and PUT when the token lacks <resource>:write", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task" }),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:read"]) }),
      },
      "/",
    );

    const patchRes = await app.request("/", { method: "PATCH" });
    expect(patchRes.status).toBe(403);
    expect((await patchRes.json<{ error: string }>()).error).toBe(
      "Insufficient scope: requires task:write",
    );

    const putRes = await app.request("/", { method: "PUT" });
    expect(putRes.status).toBe(403);
    expect((await putRes.json<{ error: string }>()).error).toBe(
      "Insufficient scope: requires task:write",
    );
  });

  it("requires <resource>:delete on DELETE when allowDelete is true", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task", allowDelete: true }),
      {
        user: fakeUser(),
        // task:write alone is not enough — :delete is a heightened scope.
        token: fakeToken({ scopes: JSON.stringify(["task:write"]) }),
      },
      "/",
    );

    const res = await app.request("/", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Insufficient scope: requires task:delete");
  });

  it("passes DELETE with the proper task:delete scope", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task", allowDelete: true }),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:delete"]) }),
      },
      "/",
    );

    const res = await app.request("/", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("falls back to <resource>:write on DELETE when allowDelete is unset", async () => {
    // Resources that do not define a separate :delete scope (e.g. label,
    // attachment, team) should treat DELETE as just another write.
    const app = createApp(
      requireWriteScopeForResource({ resource: "label" }),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["label:write"]) }),
      },
      "/",
    );

    const res = await app.request("/", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  /**
   * DENY direction for the `allowDelete`-unset fallback.
   *
   * Every resource that omits `allowDelete` — `webhook`, `label`,
   * `attachment`, `team`, `invitation`, `workspace` — relies on this single
   * branch for ALL of its DELETE scope enforcement. The allow-direction test
   * above hands the token the scope it needs, so it cannot tell enforcement
   * from a no-op. If DELETE were ever folded into the safe-method early
   * return, a `webhook:read` PAT could destroy another team's integrations
   * and the suite would stay green. This is the case that notices.
   */
  it("refuses DELETE without <resource>:write when allowDelete is unset", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "webhook" }),
      {
        user: fakeUser(),
        // Read-only integration token — must not be able to delete.
        token: fakeToken({ scopes: JSON.stringify(["webhook:read"]) }),
      },
      "/",
    );

    const res = await app.request("/", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Insufficient scope: requires webhook:write");
  });

  it("is a no-op for cookie auth on any method", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task", allowDelete: true }),
      { user: fakeUser(), token: null },
      "/",
    );

    const postRes = await app.request("/", { method: "POST" });
    expect(postRes.status).toBe(200);

    const deleteRes = await app.request("/", { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
  });

  it("honors write:* aggregate on POST/PUT/PATCH but not on opt-in DELETE", async () => {
    const app = createApp(
      requireWriteScopeForResource({ resource: "task", allowDelete: true }),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["write:*"]) }),
      },
      "/",
    );

    const postRes = await app.request("/", { method: "POST" });
    expect(postRes.status).toBe(200);

    const deleteRes = await app.request("/", { method: "DELETE" });
    // write:* deliberately does NOT cover :delete — see api-tokens.ts jsdoc.
    expect(deleteRes.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// requireReadScopeForResource
// ---------------------------------------------------------------------------

describe("requireReadScopeForResource", () => {
  it("requires <resource>:read on GET", async () => {
    const app = createApp(
      requireReadScopeForResource("task"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:write"]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Insufficient scope: requires task:read");
  });

  it("passes GET with the proper read scope", async () => {
    const app = createApp(
      requireReadScopeForResource("task"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["task:read"]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("honors the read:* aggregate", async () => {
    const app = createApp(
      requireReadScopeForResource("task"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify(["read:*"]) }),
      },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("does not gate non-safe methods (write factory's responsibility)", async () => {
    const app = createApp(
      requireReadScopeForResource("task"),
      {
        user: fakeUser(),
        token: fakeToken({ scopes: JSON.stringify([]) }),
      },
      "/",
    );

    const res = await app.request("/", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("is a no-op for cookie auth", async () => {
    const app = createApp(
      requireReadScopeForResource("task"),
      { user: fakeUser(), token: null },
      "/",
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// tokenAllowsProject — the shared PAT binding policy
// ---------------------------------------------------------------------------

/**
 * These tests pin the single source of truth that both the middleware above
 * and the handlers that resolve project access inline (subtasks, comments,
 * task groups) call. Before this policy was extracted, the project-selection
 * and workspace-binding checks existed ONLY inside the middleware, so any
 * route whose URL carried no `:projectId`/`:taskId` silently ran with an
 * unconstrained token. Pinning the predicate directly means a regression
 * shows up here even if every route were rewired.
 */
describe("tokenAllowsProject (shared PAT binding policy)", () => {
  const projAlpha = { id: "proj_alpha", workspaceId: "ws_alpha" };

  it("is a no-op for cookie auth (null and undefined token)", () => {
    // Cookie sessions carry no PAT. The policy must never narrow them —
    // their authorization is the membership/role check alone.
    expect(tokenAllowsProject(null, projAlpha)).toBe(true);
    expect(tokenAllowsProject(undefined, projAlpha)).toBe(true);
  });

  it("allows an `all` token inside its own workspace", () => {
    expect(
      tokenAllowsProject(
        fakeToken({ workspaceId: "ws_alpha", projectScope: "all" }),
        projAlpha,
      ),
    ).toBe(true);
  });

  it("denies an `all` token acting on a project in another workspace", () => {
    // The token is the workspace boundary, not the user: `projectScope: "all"`
    // means "all projects in MY workspace", never "all projects anywhere the
    // owning human happens to be a member".
    expect(
      tokenAllowsProject(
        fakeToken({ workspaceId: "ws_beta", projectScope: "all" }),
        projAlpha,
      ),
    ).toBe(false);
  });

  it("allows a `selected` token listing the project", () => {
    expect(
      tokenAllowsProject(
        fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_alpha", "proj_other"]),
        }),
        projAlpha,
      ),
    ).toBe(true);
  });

  it("denies a `selected` token that omits the project", () => {
    expect(
      tokenAllowsProject(
        fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_other"]),
        }),
        projAlpha,
      ),
    ).toBe(false);
  });

  it("fails closed on a missing, empty or corrupt selected list", () => {
    // A `selected` token whose id list cannot be read must grant nothing.
    // Failing open here would turn a storage bug into a workspace-wide grant.
    for (const projectIds of [null, "", "not json", '{"not":"an array"}', "[]"]) {
      expect(
        tokenAllowsProject(
          fakeToken({
            workspaceId: "ws_alpha",
            projectScope: "selected",
            projectIds,
          }),
          projAlpha,
        ),
      ).toBe(false);
    }
  });

  it("denies an unknown projectScope value (forward fail-closed)", () => {
    expect(
      tokenAllowsProject(
        fakeToken({
          workspaceId: "ws_alpha",
          projectScope: "future_mode",
          projectIds: JSON.stringify(["proj_alpha"]),
        }),
        projAlpha,
      ),
    ).toBe(false);
  });

  it("requires BOTH halves — right project, wrong workspace is still a deny", () => {
    // Guards the exact mistake the extraction exists to prevent: enforcing
    // project selection while forgetting the workspace binding.
    expect(
      tokenAllowsProject(
        fakeToken({
          workspaceId: "ws_beta",
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_alpha"]),
        }),
        projAlpha,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workspace binding on the project/task middleware
// ---------------------------------------------------------------------------

describe("project + task middleware enforce the workspace half of the binding", () => {
  it("returns 403 when a PAT from another workspace reaches a project it could otherwise see", async () => {
    // The human is a workspace admin of ws_alpha, so the cookie path would
    // grant admin here. The token is bound to ws_beta and must not inherit
    // that — this is the promise docs/api/api-tokens.md makes about sibling
    // workspaces ("cannot access any resource in those other workspaces").
    mockResolveProjectAccess.mockResolvedValue({
      role: "admin",
      source: "workspace",
      project: { id: "proj_1", workspaceId: "ws_alpha" },
    });

    const app = createApp(
      requireProjectAccess(),
      {
        user: fakeUser(),
        token: fakeToken({ workspaceId: "ws_beta", projectScope: "all" }),
      },
      "/projects/:projectId",
    );

    const res = await app.request("/projects/proj_1");
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Forbidden");
  });

  it("returns 403 when a PAT from another workspace reaches a task it could otherwise see", async () => {
    mockResolveTaskAccess.mockResolvedValue({
      found: true,
      access: {
        role: "member",
        source: "project",
        project: { id: "proj_owner", workspaceId: "ws_alpha" },
      },
    });

    const app = createApp(
      requireTaskAccess(),
      {
        user: fakeUser(),
        token: fakeToken({ workspaceId: "ws_beta", projectScope: "all" }),
      },
      "/tasks/:taskId",
    );

    const res = await app.request("/tasks/task_1");
    expect(res.status).toBe(403);
  });

  it("leaves cookie sessions untouched on the same project path", async () => {
    mockResolveProjectAccess.mockResolvedValue({
      role: "viewer",
      source: "project",
      project: { id: "proj_1", workspaceId: "ws_alpha" },
    });

    const app = createApp(
      requireProjectAccess(),
      { user: fakeUser(), token: null },
      "/projects/:projectId",
    );

    const res = await app.request("/projects/proj_1");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// tokenProjectAllowList / tokenProjectScopeFilter / enforceTokenWorkspaceWideAccess
// ---------------------------------------------------------------------------

/**
 * The *enumeration* half of the PAT project policy, added to close the hole
 * where `requireWorkspaceMember` / `requireWorkspaceRole` guarded only the
 * token's workspace binding. Workspace-level routes (search, dashboards,
 * activity, labels, workspace task-groups, project list, webhooks) read across
 * every project at once, so they cannot ask `tokenAllowsProject` about "the"
 * project — they need the list, pushed into SQL.
 *
 * Two properties are load-bearing here and each has its own test below:
 *
 *  1. **Agreement.** The enumeration must decide exactly what the predicate
 *     decides, or the API grows two divergent definitions of "selected"
 *     (CLAUDE.md rule 4). The equivalence test is what mechanically holds them
 *     together; if either implementation is edited in isolation it goes red.
 *  2. **No-op for humans.** These are the app's primary read endpoints. If the
 *     filter ever emits SQL for a cookie session, every list in the UI empties
 *     out — a far worse regression than the leak being closed. Hence the
 *     explicit "compiles to nothing" assertions rather than a behavioural
 *     proxy.
 */

/**
 * Capture a REAL Hono context primed exactly as `middleware/auth.ts` primes
 * one. Using the framework's own context (rather than a hand-rolled stub)
 * means `errorResponse`'s `requestId` read and `c.get` typing are exercised
 * for real, so a change to either surfaces here instead of in production.
 */
async function contextWithToken(token: ApiToken | null): Promise<Context<AppEnv>> {
  let captured: Context<AppEnv> | null = null;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "allowlist-test");
    c.set("apiToken", token);
    await next();
  });
  app.get("/", (c) => {
    captured = c;
    return c.body(null, 204);
  });
  await app.request("/");
  if (!captured) throw new Error("context was never captured");
  return captured;
}

/** Compile a Drizzle fragment to the literal SQL + params D1 would receive. */
function compile(fragment: SQL | undefined): { sql: string; params: unknown[] } {
  if (!fragment) throw new Error("expected a SQL fragment, got undefined");
  const query = new SQLiteAsyncDialect().sqlToQuery(fragment);
  return { sql: query.sql, params: query.params };
}

describe("tokenProjectAllowList", () => {
  it("returns null (unrestricted) for cookie auth", () => {
    // `null` must mean "add no filter at all", NOT "an empty list". The whole
    // regression risk of this change is a filter firing for humans.
    expect(tokenProjectAllowList(null)).toBeNull();
    expect(tokenProjectAllowList(undefined)).toBeNull();
  });

  it("returns null (unrestricted) for a projectScope: 'all' token", () => {
    expect(tokenProjectAllowList(fakeToken({ projectScope: "all" }))).toBeNull();
  });

  it("returns the explicit list for a projectScope: 'selected' token", () => {
    expect(
      tokenProjectAllowList(
        fakeToken({
          projectScope: "selected",
          projectIds: JSON.stringify(["proj_a", "proj_b"]),
        }),
      ),
    ).toEqual(["proj_a", "proj_b"]);
  });

  it("returns an EMPTY array — never null — for a missing or corrupt list", () => {
    // The dangerous confusion: `[]` (sees nothing) vs `null` (sees
    // everything). A storage bug in `projectIds` must degrade to zero access,
    // so every unreadable form has to land on `[]`.
    for (const projectIds of [null, "", "not json", '{"not":"an array"}', "[]"]) {
      expect(
        tokenProjectAllowList(
          fakeToken({ projectScope: "selected", projectIds }),
        ),
      ).toEqual([]);
    }
  });

  it("returns an empty array for an unknown projectScope (forward fail-closed)", () => {
    expect(
      tokenProjectAllowList(
        fakeToken({
          projectScope: "future_mode",
          projectIds: JSON.stringify(["proj_a"]),
        }),
      ),
    ).toEqual([]);
  });
});

describe("tokenProjectAllowList agrees with tokenAllowsProject", () => {
  /**
   * The anti-drift harness. `tokenAllowsProject` (via `canAccessProject`) is
   * the authoritative predicate; `tokenProjectAllowList` is its enumeration.
   * Across every branch either function can take — `all`, `selected` with the
   * project listed, omitted, empty or corrupt, and an unknown scope mode — and
   * for a listed, an unlisted and an absent project id, the two must give the
   * same answer. Otherwise a route that filters and a route that checks would
   * disagree about the same token, which is the exact class of bug this whole
   * change exists to remove.
   *
   * The cases are enumerated by hand rather than generated, so this covers
   * every branch of the two functions as they stand today, not every value the
   * `projectScope` column could hold. A new scope mode needs a case added here;
   * `unknown scope mode` is what pins the fail-closed default in the meantime.
   *
   * The equivalence is deliberately asserted only for projects in the token's
   * OWN workspace, because that is the precondition the enumeration documents:
   * it encodes the project half and nothing else. The separate describe below
   * pins the other side of that boundary — that the enumeration does NOT
   * encode the workspace half — so the precondition is a tested fact rather
   * than a comment, and so this harness cannot be mistaken for proof that the
   * filter is safe on a route with no workspace guard.
   */
  const cases: Array<{ label: string; token: ApiToken }> = [
    { label: "all", token: fakeToken({ workspaceId: "ws_alpha", projectScope: "all" }) },
    {
      label: "selected containing the project",
      token: fakeToken({
        workspaceId: "ws_alpha",
        projectScope: "selected",
        projectIds: JSON.stringify(["proj_alpha"]),
      }),
    },
    {
      label: "selected omitting the project",
      token: fakeToken({
        workspaceId: "ws_alpha",
        projectScope: "selected",
        projectIds: JSON.stringify(["proj_other"]),
      }),
    },
    {
      label: "selected with a corrupt list",
      token: fakeToken({
        workspaceId: "ws_alpha",
        projectScope: "selected",
        projectIds: "not json",
      }),
    },
    {
      label: "selected with an empty list",
      token: fakeToken({
        workspaceId: "ws_alpha",
        projectScope: "selected",
        projectIds: "[]",
      }),
    },
    {
      label: "unknown scope mode",
      token: fakeToken({ workspaceId: "ws_alpha", projectScope: "future_mode" }),
    },
  ];

  for (const { label, token } of cases) {
    it(`matches for a ${label} token`, () => {
      const list = tokenProjectAllowList(token);
      for (const id of ["proj_alpha", "proj_other", "proj_absent"]) {
        const viaList = list === null || list.includes(id);
        const viaPredicate = tokenAllowsProject(token, {
          id,
          workspaceId: "ws_alpha",
        });
        expect(
          viaList,
          `${label}: enumeration and predicate disagree about ${id}`,
        ).toBe(viaPredicate);
      }
    });
  }

  it("matches for a cookie session (no token)", () => {
    expect(tokenProjectAllowList(null)).toBeNull();
    expect(tokenAllowsProject(null, { id: "any", workspaceId: "ws_alpha" })).toBe(true);
  });
});

describe("tokenProjectAllowList does NOT encode the workspace half", () => {
  /**
   * The counterexample that bounds the equivalence above, written as a test so
   * the precondition cannot quietly stop being true.
   *
   * `tokenAllowsProject` enforces workspace binding AND project selection.
   * `tokenProjectAllowList` never reads `token.workspaceId`, so for a project
   * in a DIFFERENT workspace the two disagree by design: the predicate denies,
   * the enumeration says "unrestricted". Callers must therefore already hold
   * the workspace half — from `requireWorkspaceMember` / `requireWorkspaceRole`
   * on a `:workspaceId` route, or from `tokenWorkspaceScopeFilter` on a route
   * that has no workspace in its URL (`/notifications`).
   *
   * This is not a latent bug in the shipped code: every current call site is
   * behind one of those two. It is documented and tested because the docstring
   * is what the next handler author will trust, and a filter applied without
   * the workspace half is a cross-tenant leak.
   */
  const foreignProject = { id: "proj_alpha", workspaceId: "ws_alpha" };

  it("says 'unrestricted' for an all-scope token bound to another workspace", () => {
    const t = fakeToken({ workspaceId: "ws_beta", projectScope: "all" });
    expect(tokenProjectAllowList(t)).toBeNull();
    expect(tokenAllowsProject(t, foreignProject)).toBe(false);
  });

  it("says 'allowed' for a selected token listing a project in another workspace", () => {
    const t = fakeToken({
      workspaceId: "ws_beta",
      projectScope: "selected",
      projectIds: JSON.stringify(["proj_alpha"]),
    });
    expect(tokenProjectAllowList(t)).toContain("proj_alpha");
    expect(tokenAllowsProject(t, foreignProject)).toBe(false);
  });
});

describe("tokenWorkspaceScopeFilter", () => {
  it("emits NO fragment for a cookie session", async () => {
    // Same no-op guarantee as the project filter: humans are never narrowed.
    const c = await contextWithToken(null);
    expect(tokenWorkspaceScopeFilter(c, notification.workspaceId)).toBeUndefined();
  });

  it("restricts to the token's workspace even for a projectScope: 'all' token", async () => {
    // Asymmetry with the project half, and the reason these are two functions:
    // EVERY PAT is bound to exactly one workspace, so `all` narrows nothing
    // about projects but still narrows workspaces.
    const c = await contextWithToken(
      fakeToken({ workspaceId: "ws_alpha", projectScope: "all" }),
    );
    const { sql: text, params } = compile(
      tokenWorkspaceScopeFilter(c, notification.workspaceId),
    );
    expect(text).toContain('"notification"."workspaceId" = ?');
    expect(params).toEqual(["ws_alpha"]);
  });

  it("binds to whichever workspace-id column the caller passes", async () => {
    const c = await contextWithToken(fakeToken({ workspaceId: "ws_alpha" }));
    expect(compile(tokenWorkspaceScopeFilter(c, project.workspaceId)).sql).toContain(
      '"project"."workspaceId" = ?',
    );
  });
});

describe("tokenProjectScopeFilter", () => {
  it("emits NO fragment for a cookie session", async () => {
    // Drizzle drops `undefined` operands from `and(...)`, so `undefined` here
    // means the generated SQL is byte-identical to the pre-policy query. This
    // is the assertion that protects the web UI.
    const c = await contextWithToken(null);
    expect(tokenProjectScopeFilter(c, project.id)).toBeUndefined();
  });

  it("emits NO fragment for a projectScope: 'all' token", async () => {
    const c = await contextWithToken(fakeToken({ projectScope: "all" }));
    expect(tokenProjectScopeFilter(c, project.id)).toBeUndefined();
  });

  it("emits an IN (...) fragment bound to the token's ids", async () => {
    const c = await contextWithToken(
      fakeToken({
        projectScope: "selected",
        projectIds: JSON.stringify(["proj_a", "proj_b"]),
      }),
    );
    const { sql: text, params } = compile(tokenProjectScopeFilter(c, project.id));
    expect(text).toContain('"project"."id" in (?, ?)');
    expect(params).toEqual(["proj_a", "proj_b"]);
  });

  it("emits an IMPOSSIBLE predicate — not an empty IN — for an empty list", async () => {
    // `inArray(col, [])` has meant different things across Drizzle releases
    // (throw / `false`), and this is precisely the case where a silent no-op
    // would return the entire workspace to a token narrowed to nothing. We
    // write `1 = 0` ourselves so the fail-closed behaviour does not depend on
    // the ORM version.
    const c = await contextWithToken(
      fakeToken({ projectScope: "selected", projectIds: "[]" }),
    );
    const { sql: text, params } = compile(tokenProjectScopeFilter(c, project.id));
    expect(text).toBe("1 = 0");
    expect(params).toEqual([]);
  });

  it("targets whichever project-id column the caller passes", async () => {
    // Some queries join `project`, others only have `task.projectId` or
    // `webhook.projectId` in scope. The helper must bind to the column it is
    // given rather than assuming a particular table is joined.
    const c = await contextWithToken(
      fakeToken({ projectScope: "selected", projectIds: JSON.stringify(["p"]) }),
    );
    expect(compile(tokenProjectScopeFilter(c, task.projectId)).sql).toContain(
      '"task"."projectId" in (?)',
    );
    expect(compile(tokenProjectScopeFilter(c, webhook.projectId)).sql).toContain(
      '"webhook"."projectId" in (?)',
    );
  });
});

describe("enforceTokenWorkspaceWideAccess", () => {
  it("permits a cookie session", async () => {
    const c = await contextWithToken(null);
    expect(enforceTokenWorkspaceWideAccess(c)).toBeNull();
  });

  it("permits a projectScope: 'all' token", async () => {
    const c = await contextWithToken(fakeToken({ projectScope: "all" }));
    expect(enforceTokenWorkspaceWideAccess(c)).toBeNull();
  });

  it("refuses a projectScope: 'selected' token with the generic 403", async () => {
    // Same bare "Forbidden" body as every other denial: a distinct message
    // would tell a probe holding a stolen token that it is narrowed rather
    // than simply unauthorised.
    const c = await contextWithToken(
      fakeToken({
        projectScope: "selected",
        projectIds: JSON.stringify(["proj_a"]),
      }),
    );
    const res = enforceTokenWorkspaceWideAccess(c);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("refuses a selected token even when its list is empty", async () => {
    const c = await contextWithToken(
      fakeToken({ projectScope: "selected", projectIds: "[]" }),
    );
    expect(enforceTokenWorkspaceWideAccess(c)?.status).toBe(403);
  });
});
