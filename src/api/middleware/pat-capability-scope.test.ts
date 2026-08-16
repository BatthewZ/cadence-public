/// <reference types="@cloudflare/workers-types" />
/**
 * End-to-end tests for PAT CAPABILITY-SCOPE enforcement on the dashboard,
 * search and notification route modules.
 *
 * ## Why this file exists
 *
 * `docs/api/api-tokens.md` states as fact that "every endpoint a PAT can reach
 * requires one or more scopes". That was false for three whole route modules:
 * `dashboard.routes.ts`, `search.routes.ts` and `notifications.routes.ts`
 * mounted membership guards (or, for notifications, `requireAuth` alone) and
 * no capability scope at all. A token minted with a single narrow, unrelated
 * scope — `{"scopes":["team:read"],"projectScope":"all"}` — answered `200` on
 * all of them and read:
 *
 * | Route | Read without any covering scope |
 * | --- | --- |
 * | `GET /workspaces/:id/dashboard` | task counts, cost totals, per-member workload, overdue task titles + due dates + assignees, the project list |
 * | `GET /workspaces/:id/dashboard/my-tasks` | task titles, due dates, labels |
 * | `GET /workspaces/:id/dashboard/upcoming` | task titles and due dates in every bucket |
 * | `GET /workspaces/:id/activity` | full `oldValue`/`newValue` change text |
 * | `GET /projects/:id/dashboard` | task rollups plus the project budget |
 * | `GET /projects/:id/activity` | full `oldValue`/`newValue` change text |
 * | `GET /workspaces/:id/search` | free-text search over task titles/descriptions and project names/descriptions |
 * | `GET /notifications`, `/notifications/unread-count` | the inbox, whose rows embed task titles and comment excerpts verbatim |
 * | `PATCH /notifications/:id/read`, `POST /notifications/mark-all-read`, `DELETE /notifications/:id` | durable mutation of the human's inbox state |
 *
 * The project-binding work that preceded this narrowed *which projects* those
 * routes could reach. It never asked whether the token was permitted to read
 * tasks at all, which is an orthogonal question and the one this file pins.
 *
 * ## Test shape, and why it is this shape
 *
 * Every route is asserted in BOTH directions:
 *
 *  1. **deny** — a token holding a real but non-covering scope gets `403` with
 *     the exact `Insufficient scope: requires <scope>` body; and
 *  2. **allow** — a token holding the covering scope gets a success status.
 *
 * The deny direction is the one that carries the information. An allow-only
 * test passes whether the route checks the right scope, the wrong scope, or
 * nothing at all, which is precisely how a module with zero scope mounts
 * shipped in the first place. Asserting the *message* (not just `403`) is what
 * distinguishes "denied for the intended scope" from "denied for some other
 * reason" — role, membership and project-binding failures all answer 403 too,
 * so a status-only assertion could pass against a guard checking the wrong
 * thing entirely.
 *
 * A third caller — a **cookie session** (no PAT) — is asserted on every route
 * whose middleware could plausibly fire for a human, which is every GET here.
 * These middlewares are supposed to no-op without a token, and these are the
 * app's primary read endpoints; a scope check that fired for humans would empty
 * the entire UI, a worse regression than the leak being closed. The two DELETE
 * cases (`/notifications/:id`, `/uploads/:id`) carry no cookie assertion of
 * their own: both sit on paths whose GET is already covered by one, and the
 * factories they exercise are the same two instances mounted for the whole
 * path.
 *
 * The REAL route modules are mounted, never the handler functions. The bug
 * class here is a WIRING gap: a handler-level test with a hand-primed context
 * passes happily while the mounted route has no guard on it.
 *
 * Companion file: `pat-workspace-scope.test.ts` covers the orthogonal axis
 * (which projects a token may see); this one covers which capabilities it
 * holds.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiToken } from "../../db/schema";
import type { AppEnv } from "../env";
import dashboardRoutes from "../routes/dashboard/dashboard.routes";
import notificationRoutes from "../routes/notifications/notifications.routes";
import searchRoutes from "../routes/search/search.routes";
import uploadRoutes from "../routes/uploads/uploads.routes";
import {
  createTestD1,
  fakeAuth,
  fakePat,
  seedNotification,
  seedProject,
  seedTask,
  seedTaskActivity,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../test-utils";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;

let wsId: string;
let projectId: string;
let notifId: string;

/** A due date inside the "upcoming" window so the bucket query returns rows. */
const DUE_SOON = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  ({ d1, dispose } = await createTestD1());

  await seedUser(d1, TEST_USER);
  // TEST_USER is the workspace OWNER, so every human-level membership and role
  // check passes trivially. That is deliberate: it isolates the scope check as
  // the only thing that can produce a 403 in these tests.
  wsId = await seedWorkspace(d1, TEST_USER.id, { name: "Scope WS", slug: "scope-ws" });
  projectId = await seedProject(d1, wsId, { name: "Scope Project", budget: 1000 });

  const groupId = await seedTaskGroup(d1, projectId, { name: "To Do" });
  const taskId = await seedTask(d1, projectId, groupId, {
    title: "Scope task",
    assigneeId: TEST_USER.id,
    dueDate: DUE_SOON,
  });

  await seedTaskActivity(d1, taskId, TEST_USER.id, {
    field: "title",
    newValue: "renamed",
  });

  notifId = await seedNotification(d1, TEST_USER.id, {
    title: "Scope notification",
    workspaceId: wsId,
  });
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------

/**
 * A PAT row shaped exactly as `middleware/auth.ts` hands it downstream after a
 * successful verification. `projectScope: "all"` on every caller so the
 * project-binding policy can never be the reason for a 403 — this file is only
 * about capability scopes, and the two failure modes share a status code.
 */
function pat(scopes: string[]): ApiToken {
  return fakePat({
    id: "tok_capability_scope_test",
    workspaceId: wsId,
    name: "capability-scope-test",
    scopes: JSON.stringify(scopes),
  });
}

/**
 * Mount the real route modules behind a middleware priming exactly what the
 * auth middleware primes. `token: null` reproduces a cookie session precisely —
 * `auth.ts` always writes `apiToken: null` on the session branch, which is why
 * `apiToken` is passed explicitly rather than omitted.
 */
function appWith(token: ApiToken | null) {
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    fakeAuth(d1, TEST_USER, {
      apiToken: token,
      requestId: "pat-capability-scope-test",
      // An empty bucket is enough for the uploads block below: a scope refusal
      // never reaches the handler, and the allowed caller only has to get PAST
      // the scope gate, which a clean 404 for a key that does not exist proves.
      env: { STORAGE: { get: () => Promise.resolve(null) } },
    }),
  );
  app.route("/", searchRoutes);
  app.route("/", dashboardRoutes);
  app.route("/", notificationRoutes);
  app.route("/", uploadRoutes);
  return app;
}

type Req = { path: string; method?: string };

async function callAs(token: ApiToken | null, req: Req): Promise<Response> {
  return appWith(token).request(req.path, { method: req.method ?? "GET" });
}

/**
 * Assert the deny direction: `scopes` must NOT be enough for `req`, and the
 * refusal must name `missing`.
 *
 * Naming the scope in the assertion is what makes the test a real guard. A
 * bare `expect(403)` would also pass if the route rejected for a completely
 * different reason, and would keep passing if someone swapped the mount for a
 * check on the wrong resource.
 */
async function expectDenied(scopes: string[], req: Req, missing: string) {
  const res = await callAs(pat(scopes), req);
  expect(res.status).toBe(403);
  const body = await res.json<{ error: string }>();
  expect(body.error).toBe(`Insufficient scope: requires ${missing}`);
}

/** Assert the allow direction: `scopes` IS enough, and the route answers 2xx. */
async function expectAllowed(scopes: string[], req: Req) {
  const res = await callAs(pat(scopes), req);
  expect(res.status).toBe(200);
}

/** Assert the no-PAT path is untouched — the regression that would hurt most. */
async function expectCookieUnaffected(req: Req) {
  const res = await callAs(null, req);
  expect(res.status).toBe(200);
}

/**
 * The scope every "wrong scope" caller below holds. `team:read` is a real,
 * grantable member of `KNOWN_SCOPES` and covers none of these routes — it is
 * the exact token shape from the original reproduction, so these tests fail if
 * the reported bug ever returns.
 */
const UNRELATED = ["team:read"];

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

describe("dashboard routes require task/project read scopes", () => {
  it("GET /workspaces/:id/dashboard refuses a token without task:read", async () => {
    await expectDenied(UNRELATED, { path: `/workspaces/${wsId}/dashboard` }, "task:read");
  });

  it("GET /workspaces/:id/dashboard also refuses a task-only token (it returns project rows)", async () => {
    // The workspace dashboard's body carries a project collection equivalent
    // to `GET /workspaces/:id/projects`, so `task:read` alone must not unlock
    // it — otherwise the project resource is readable through a back door.
    await expectDenied(["task:read"], { path: `/workspaces/${wsId}/dashboard` }, "project:read");
  });

  it("GET /workspaces/:id/dashboard passes with both scopes, and for a cookie session", async () => {
    await expectAllowed(["task:read", "project:read"], { path: `/workspaces/${wsId}/dashboard` });
    await expectCookieUnaffected({ path: `/workspaces/${wsId}/dashboard` });
  });

  it("GET /workspaces/:id/dashboard/my-tasks refuses a token without task:read", async () => {
    await expectDenied(
      UNRELATED,
      { path: `/workspaces/${wsId}/dashboard/my-tasks` },
      "task:read",
    );
  });

  it("GET /workspaces/:id/dashboard/my-tasks passes on task:read alone", async () => {
    // Also proves the two-scope mount on the parent `/dashboard` path did NOT
    // leak onto this nested route: Hono's literal `app.use` pattern matches
    // that path only, and this assertion is what holds that property in place.
    await expectAllowed(["task:read"], { path: `/workspaces/${wsId}/dashboard/my-tasks` });
    await expectCookieUnaffected({ path: `/workspaces/${wsId}/dashboard/my-tasks` });
  });

  it("GET /workspaces/:id/dashboard/upcoming refuses a token without task:read", async () => {
    await expectDenied(
      UNRELATED,
      { path: `/workspaces/${wsId}/dashboard/upcoming` },
      "task:read",
    );
  });

  it("GET /workspaces/:id/dashboard/upcoming passes on task:read alone", async () => {
    await expectAllowed(["task:read"], { path: `/workspaces/${wsId}/dashboard/upcoming` });
    await expectCookieUnaffected({ path: `/workspaces/${wsId}/dashboard/upcoming` });
  });

  it("GET /workspaces/:id/activity refuses a token without task:read", async () => {
    await expectDenied(UNRELATED, { path: `/workspaces/${wsId}/activity` }, "task:read");
  });

  it("GET /workspaces/:id/activity passes on task:read alone", async () => {
    await expectAllowed(["task:read"], { path: `/workspaces/${wsId}/activity` });
    await expectCookieUnaffected({ path: `/workspaces/${wsId}/activity` });
  });

  it("GET /projects/:id/dashboard refuses a token without task:read", async () => {
    await expectDenied(UNRELATED, { path: `/projects/${projectId}/dashboard` }, "task:read");
  });

  it("GET /projects/:id/dashboard also refuses a task-only token (it returns the budget)", async () => {
    await expectDenied(
      ["task:read"],
      { path: `/projects/${projectId}/dashboard` },
      "project:read",
    );
  });

  it("GET /projects/:id/dashboard passes with both scopes, and for a cookie session", async () => {
    await expectAllowed(["task:read", "project:read"], {
      path: `/projects/${projectId}/dashboard`,
    });
    await expectCookieUnaffected({ path: `/projects/${projectId}/dashboard` });
  });

  it("GET /projects/:id/activity refuses a token without task:read", async () => {
    await expectDenied(UNRELATED, { path: `/projects/${projectId}/activity` }, "task:read");
  });

  it("GET /projects/:id/activity passes on task:read alone", async () => {
    await expectAllowed(["task:read"], { path: `/projects/${projectId}/activity` });
    await expectCookieUnaffected({ path: `/projects/${projectId}/activity` });
  });

  it("honors the read:* aggregate across every dashboard route", async () => {
    // `read:*` is what most real integrations are minted with; if the mounts
    // did not honor it the fix would break every existing broad-read client.
    for (const path of [
      `/workspaces/${wsId}/dashboard`,
      `/workspaces/${wsId}/dashboard/my-tasks`,
      `/workspaces/${wsId}/dashboard/upcoming`,
      `/workspaces/${wsId}/activity`,
      `/projects/${projectId}/dashboard`,
      `/projects/${projectId}/activity`,
    ]) {
      await expectAllowed(["read:*"], { path });
    }
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe("search route requires task:read and project:read", () => {
  const searchPath = () => `/workspaces/${wsId}/search?q=Scope`;

  it("refuses a token holding neither scope", async () => {
    await expectDenied(UNRELATED, { path: searchPath() }, "task:read");
  });

  it("refuses a task-only token (the response includes project rows)", async () => {
    await expectDenied(["task:read"], { path: searchPath() }, "project:read");
  });

  it("refuses a project-only token (the response includes task rows)", async () => {
    await expectDenied(["project:read"], { path: searchPath() }, "task:read");
  });

  it("passes with both scopes, with read:*, and for a cookie session", async () => {
    await expectAllowed(["task:read", "project:read"], { path: searchPath() });
    await expectAllowed(["read:*"], { path: searchPath() });
    await expectCookieUnaffected({ path: searchPath() });
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe("notification routes require task scopes", () => {
  it("GET /notifications refuses a token without task:read", async () => {
    await expectDenied(UNRELATED, { path: "/notifications" }, "task:read");
  });

  it("GET /notifications passes on task:read, and for a cookie session", async () => {
    await expectAllowed(["task:read"], { path: "/notifications" });
    await expectCookieUnaffected({ path: "/notifications" });
  });

  it("GET /notifications/unread-count refuses a token without task:read", async () => {
    await expectDenied(UNRELATED, { path: "/notifications/unread-count" }, "task:read");
  });

  it("GET /notifications/unread-count passes on task:read, and for a cookie session", async () => {
    await expectAllowed(["task:read"], { path: "/notifications/unread-count" });
    await expectCookieUnaffected({ path: "/notifications/unread-count" });
  });

  it("PATCH /notifications/:id/read refuses a read-only token", async () => {
    // `task:read` is the interesting deny case rather than an unrelated scope:
    // it proves the mutation is gated on the WRITE half, not merely on the
    // same read scope as the feed.
    await expectDenied(
      ["task:read"],
      { path: `/notifications/${notifId}/read`, method: "PATCH" },
      "task:write",
    );
  });

  it("PATCH /notifications/:id/read passes with task:write, and for a cookie session", async () => {
    await expectAllowed(["task:write"], {
      path: `/notifications/${notifId}/read`,
      method: "PATCH",
    });
    await expectCookieUnaffected({ path: `/notifications/${notifId}/read`, method: "PATCH" });
  });

  it("POST /notifications/mark-all-read refuses a read-only token", async () => {
    await expectDenied(
      ["task:read"],
      { path: "/notifications/mark-all-read", method: "POST" },
      "task:write",
    );
  });

  it("POST /notifications/mark-all-read passes with task:write, and for a cookie session", async () => {
    await expectAllowed(["task:write"], {
      path: "/notifications/mark-all-read",
      method: "POST",
    });
    await expectCookieUnaffected({ path: "/notifications/mark-all-read", method: "POST" });
  });

  it("DELETE /notifications/:id refuses a read-only token", async () => {
    await expectDenied(
      ["task:read"],
      { path: `/notifications/${notifId}`, method: "DELETE" },
      "task:write",
    );
  });

  it("DELETE /notifications/:id passes with task:write and does NOT demand task:delete", async () => {
    // Deleting a notification is not deleting a task, so the mount omits
    // `allowDelete`. If someone adds it, this assertion turns red — which is
    // the intent: the heightened scope must stay reserved for real task
    // deletion.
    const res = await callAs(pat(["task:write"]), {
      path: `/notifications/${notifId}`,
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Uploads — the file bytes themselves
// ---------------------------------------------------------------------------

describe("upload routes require attachment scopes", () => {
  // `serveUpload` already authorizes per resource: a task attachment is
  // resolved back to its owning task and checked against the caller's project
  // access. That answers "may this PERSON see this file", which is a different
  // question from "may this CREDENTIAL ask for files at all" — and only the
  // first was being asked. A `team:read` token still downloaded attachments
  // for every project its holder could reach.
  const FILE = "/uploads/task-attachment/some-user/some-file.txt";

  it("GET /uploads/... refuses a token with no attachment scope", async () => {
    await expectDenied(UNRELATED, { path: FILE }, "attachment:read");
  });

  it("GET /uploads/... lets a token holding attachment:read reach the handler", async () => {
    // Asserted as "past the gate", not as 200: the fixture seeds no object, so
    // the handler's own answer is a 404. What matters is that the refusal is
    // no longer the SCOPE refusal — without this the deny test above would
    // still pass if the mount rejected every caller outright.
    const res = await callAs(pat(["attachment:read"]), { path: FILE });
    expect(res.status).not.toBe(403);
    expect(await res.text()).not.toContain("Insufficient scope");
  });

  it("DELETE /uploads/:id refuses a read-only token, and takes attachment:write", async () => {
    // No `attachment:delete` exists in the v1 grammar, so the mount omits
    // `allowDelete` and DELETE falls under `attachment:write`. If someone adds
    // the stronger scope, the second assertion turns red.
    await expectDenied(["attachment:read"], { path: "/uploads/x", method: "DELETE" }, "attachment:write");
    const res = await callAs(pat(["attachment:write"]), {
      path: "/uploads/x",
      method: "DELETE",
    });
    expect(res.status).not.toBe(403);
  });

  it("leaves a cookie session completely unaffected", async () => {
    // Avatars are displayed throughout the app and must stay readable by any
    // signed-in human. These middlewares no-op without a PAT, and this is the
    // assertion that keeps that true.
    const res = await callAs(null, { path: FILE });
    expect(res.status).not.toBe(403);
    expect(await res.text()).not.toContain("Insufficient scope");
  });
});
