/// <reference types="@cloudflare/workers-types" />
/**
 * End-to-end tests for the PAT project policy on WORKSPACE-LEVEL routes.
 *
 * ## Why this file exists
 *
 * `enforceTokenProjectBinding` closed the hole on routes that name a project
 * or task. It could not close the hole on the routes guarded by
 * `requireWorkspaceMember` / `requireWorkspaceRole`, because those guards see
 * only a `:workspaceId` and so can enforce only the token's WORKSPACE binding.
 * A large family of routes reads and writes project-owned data behind exactly
 * that guard, and every one of them was reproduced returning a sibling
 * project's data to a token narrowed to a different project:
 *
 * | Route | Leaked |
 * | --- | --- |
 * | `GET /workspaces/:id/task-groups?projectIds=` | the sibling project's columns |
 * | `GET /workspaces/:id/search` | sibling task titles + project names |
 * | `GET /workspaces/:id/dashboard[/my-tasks|/upcoming]` | sibling tasks and aggregates |
 * | `GET /workspaces/:id/activity` | sibling field-level change history |
 * | `GET /workspaces/:id/labels` | sibling label names |
 * | `GET /workspaces/:id/projects` | sibling project rows |
 * | `GET /workspaces/:id/webhooks` | sibling webhook targets |
 * | `GET /workspaces/:id/export` | the ENTIRE workspace archive |
 * | `POST /workspaces/:id/webhooks` | persisted a standing egress pipe for a denied project |
 *
 * That set falsifies the containment promise `docs/api/api-tokens.md` makes
 * about selected-project tokens, so the tests below are the executable form of
 * that promise.
 *
 * ## Test shape, and why it is this shape
 *
 * Endpoints are exercised against one shared fixture by up to three callers:
 *
 *  1. a PAT narrowed to `projSelected` — must see only that project, or be
 *     refused where refusal is the policy;
 *  2. a `projectScope: "all"` PAT — must be completely unaffected;
 *  3. a cookie session (no PAT at all) — must be completely unaffected.
 *
 * Callers 1 and 3 appear on every endpoint. Caller 3 is not padding: these are
 * the app's primary read endpoints, and a filter that fired for humans would
 * empty the entire UI, which is a worse regression than the leak being fixed.
 *
 * Caller 2 is asserted wherever a narrowed token is expected to see LESS,
 * because that is where an over-broad filter would show up. It is omitted on
 * the two webhook mutations (`DELETE .../webhooks/:id` and
 * `POST .../webhooks/:id/test`), where the narrowed token is refused outright
 * and the cookie session already proves the guard is opt-in.
 *
 * Assertions are on CONTENT — returned ids, titles, names, and rows actually
 * persisted — never on status alone. The audit that found this hole notes that
 * status-only assertions are exactly what let it ship: a 403 that still wrote
 * the row, or a 200 whose body quietly contains the sibling project, both pass
 * a status check.
 *
 * The real route modules are mounted (not the handler functions) because the
 * bug class is a WIRING gap: a handler-level test with a hand-built context
 * can pass while the mounted route still leaks.
 */

import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ApiToken } from "../../db/schema";
import type { AppEnv } from "../env";
import type { EmailMessage, EmailSendResult } from "../lib/email/types";

// The webhook-created security email is an external boundary this file does
// not own; stub it so `createWebhook` runs its real logic without SMTP.
const mockEmailSend = vi.fn<(msg: EmailMessage) => Promise<EmailSendResult>>(
  () => Promise.resolve({ id: "test-email-id" }),
);
vi.mock("../lib/email", () => ({
  createEmailService: vi.fn(() => ({ send: mockEmailSend })),
}));

import dashboardRoutes from "../routes/dashboard/dashboard.routes";
import notificationRoutes from "../routes/notifications/notifications.routes";
import projectRoutes from "../routes/projects/projects.routes";
import searchRoutes from "../routes/search/search.routes";
import taskGroupRoutes from "../routes/task-groups/task-groups.routes";
import webhookRoutes from "../routes/webhooks/webhooks.routes";
import { exportWorkspace } from "../routes/workspaces/export.handlers";
import {
  createTestD1,
  fakeAuth,
  fakePat,
  jsonRequest,
  seedLabel,
  seedProject,
  seedTask,
  seedTaskActivity,
  seedTaskGroup,
  seedUser,
  seedWebhook,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";
import { requireWorkspaceRole } from "./authorize";
import { requireAuth } from "./require-auth";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;

/** Workspace A. TEST_USER is the OWNER, so every human-level check passes —
 *  which is precisely the condition that made this leak reachable. */
let wsA: string;
/** The single project the narrow token is allowed to touch. */
let projSelected: string;
/** A sibling project in the same workspace, deliberately outside the list. */
let projSibling: string;

let groupSelected: string;
let groupSibling: string;
let taskSelected: string;
let taskSibling: string;

/** Webhook bound to the selected project. */
let whSelected: string;
/** Webhook bound to the sibling project. */
let whSibling: string;
/** Workspace-wide webhook (projectId NULL) — a `task.*` firehose. */
let whWorkspace: string;

/** A SECOND workspace TEST_USER also belongs to. The `/notifications` feed is
 *  keyed by user, not by workspace, so it is the one place a token bound to
 *  workspace A can reach workspace B's rows without the workspace half. */
let wsB: string;
let projInWsB: string;

/** Notification ids, one per row shape the scope rule has to classify. */
let notifSelected: string;
let notifSibling: string;
let notifOtherWorkspace: string;
let notifWorkspaceLevel: string;
let notifForeignWorkspaceLevel: string;
let notifUntethered: string;

/** A due date inside every "upcoming" bucket window. */
const DUE_SOON = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  ({ d1, dispose } = await createTestD1());

  await seedUser(d1, TEST_USER);
  wsA = await seedWorkspace(d1, TEST_USER.id, { name: "Workspace A" });

  // Both project names share the "Alpha" token so a single search query
  // matches both projects AND both tasks — otherwise a filter that silently
  // dropped one dimension would look like a pass.
  projSelected = await seedProject(d1, wsA, { name: "Alpha Selected Project" });
  projSibling = await seedProject(d1, wsA, { name: "Alpha Sibling Project" });

  groupSelected = await seedTaskGroup(d1, projSelected, { name: "Column Selected" });
  groupSibling = await seedTaskGroup(d1, projSibling, { name: "Column Sibling" });

  taskSelected = await seedTask(d1, projSelected, groupSelected, {
    title: "Alpha task in selected",
    assigneeId: TEST_USER.id,
    dueDate: DUE_SOON,
  });
  taskSibling = await seedTask(d1, projSibling, groupSibling, {
    title: "Alpha task in sibling",
    assigneeId: TEST_USER.id,
    dueDate: DUE_SOON,
  });

  await seedLabel(d1, projSelected, "label-selected");
  await seedLabel(d1, projSibling, "label-sibling");

  await seedTaskActivity(d1, taskSelected, TEST_USER.id, {
    field: "title",
    newValue: "secret-selected-value",
  });
  await seedTaskActivity(d1, taskSibling, TEST_USER.id, {
    field: "title",
    newValue: "secret-sibling-value",
  });

  whSelected = (
    await seedWebhook(d1, wsA, { name: "wh-selected", projectId: projSelected })
  ).id;
  whSibling = (
    await seedWebhook(d1, wsA, { name: "wh-sibling", projectId: projSibling })
  ).id;
  whWorkspace = (await seedWebhook(d1, wsA, { name: "wh-workspace" })).id;

  // --- Workspace B, plus one notification per row shape ------------------
  await seedUser(d1, TEST_USER_2);
  wsB = await seedWorkspace(d1, TEST_USER_2.id, { slug: "ws-b", name: "Workspace B" });
  await seedWorkspaceMember(d1, wsB, TEST_USER.id, "member");
  projInWsB = await seedProject(d1, wsB, { name: "Project In B" });

  notifSelected = await seedNotificationRow({
    title: 'You were assigned to "selected task"',
    projectId: projSelected,
    taskId: taskSelected,
  });
  notifSibling = await seedNotificationRow({
    title: 'You were assigned to "SIBLING SECRET TASK"',
    body: "sibling comment body leak",
    projectId: projSibling,
    taskId: taskSibling,
  });
  notifOtherWorkspace = await seedNotificationRow({
    title: "Notification from workspace B",
    projectId: projInWsB,
  });
  notifWorkspaceLevel = await seedNotificationRow({
    title: "You were invited to Workspace A",
    workspaceId: wsA,
  });
  notifForeignWorkspaceLevel = await seedNotificationRow({
    title: "You were invited to Workspace B",
    workspaceId: wsB,
  });
  notifUntethered = await seedNotificationRow({ title: "Account-level notice" });
});

/**
 * Insert a notification row directly.
 *
 * The shared `seedNotification` helper cannot set `projectId`/`taskId`, and
 * those columns are the entire subject of the notification scope rule — the
 * three row shapes (project-owned / workspace-owned / untethered) are exactly
 * what has to be told apart. Inserting here keeps the fixture honest without
 * widening a helper other suites depend on.
 */
async function seedNotificationRow(opts: {
  title: string;
  body?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO notification (id, userId, type, title, body, read, workspaceId, projectId, taskId, createdAt)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      TEST_USER.id,
      "task_assigned",
      opts.title,
      opts.body ?? null,
      opts.workspaceId ?? null,
      opts.projectId ?? null,
      opts.taskId ?? null,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return id;
}

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------

/**
 * This file's PAT, bound to workspace A. Everything except identity comes from
 * the shared `fakePat` fixture — including the full read+write scope set, which
 * matters here for the reason that fixture documents: a scope failure and a
 * binding failure both answer 403, so a token that is narrow on the scope axis
 * would let these tests pass with the binding guard removed entirely.
 */
function pat(overrides: Partial<ApiToken>): ApiToken {
  return fakePat({
    id: "tok_ws_scope_test",
    workspaceId: wsA,
    name: "ws-scope-test",
    ...overrides,
  });
}

/** Narrowed to `projSelected` alone — the caller under test. */
const narrowToken = () =>
  pat({
    id: "tok_narrow",
    projectScope: "selected",
    projectIds: JSON.stringify([projSelected]),
  });

/** Narrowed to NOTHING. The fail-closed edge: must see zero, never all. */
const emptyToken = () =>
  pat({ id: "tok_empty", projectScope: "selected", projectIds: "[]" });

/** Unnarrowed token — the control that proves the change is opt-in. */
const allToken = () => pat({ id: "tok_all", projectScope: "all" });

/**
 * Mount the real route modules behind a middleware priming exactly what the
 * auth middleware primes. `token: null` reproduces a cookie session precisely
 * — `auth.ts` always writes `apiToken: null` on the session branch.
 *
 * The export route is rebuilt here rather than importing the whole workspaces
 * router, which would drag in the multipart import surface this file has no
 * business exercising.
 *
 * That rebuild is DELIBERATELY NARROWER than production, and the difference
 * matters because this file's whole premise is that wiring gaps are the bug
 * class. Only `requireAuth` + `requireWorkspaceRole("owner","admin")` are
 * reproduced. The real mount in `workspaces.routes.ts` also carries
 * `workspaceReadScope`, `workspaceWriteScope` and a 5/hour rate limit — none
 * of which is exercised here, so removing any of them would NOT turn this file
 * red. What is under test is the project-scope decision alone; the scope and
 * rate-limit mounts are covered where they are declared, not here.
 */
function appWith(token: ApiToken | null) {
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    fakeAuth(d1, TEST_USER, { apiToken: token, requestId: "pat-ws-scope-test" }),
  );
  app.route("/", searchRoutes);
  app.route("/", dashboardRoutes);
  app.route("/", taskGroupRoutes);
  app.route("/", projectRoutes);
  app.route("/", webhookRoutes);
  app.route("/", notificationRoutes);
  app.get(
    "/workspaces/:workspaceId/export",
    requireAuth,
    requireWorkspaceRole("owner", "admin"),
    exportWorkspace,
  );
  return app;
}

/** Issue `path` as each of the three callers and return the parsed bodies. */
async function getAsAll<T>(path: string): Promise<{
  narrow: T;
  all: T;
  cookie: T;
  narrowStatus: number;
  allStatus: number;
  cookieStatus: number;
}> {
  const [narrowRes, allRes, cookieRes] = await Promise.all([
    appWith(narrowToken()).request(path),
    appWith(allToken()).request(path),
    appWith(null).request(path),
  ]);
  return {
    narrow: await narrowRes.json<T>(),
    all: await allRes.json<T>(),
    cookie: await cookieRes.json<T>(),
    narrowStatus: narrowRes.status,
    allStatus: allRes.status,
    cookieStatus: cookieRes.status,
  };
}

const sorted = (xs: string[]) => [...xs].sort();

// ---------------------------------------------------------------------------
// Aggregate reads — the policy is FILTER, not reject
// ---------------------------------------------------------------------------

describe("GET /workspaces/:id/search", () => {
  it("returns only the narrow token's project and its tasks", async () => {
    const r = await getAsAll<{
      projects: { id: string }[];
      tasks: { id: string; title: string }[];
    }>(`/workspaces/${wsA}/search?q=Alpha`);

    expect(r.narrowStatus).toBe(200);
    expect(r.narrow.projects.map((p) => p.id)).toEqual([projSelected]);
    expect(r.narrow.tasks.map((t) => t.id)).toEqual([taskSelected]);
    // The sibling's title must not appear anywhere in the payload — search is
    // the highest-yield probe in the API precisely because it returns titles.
    expect(JSON.stringify(r.narrow)).not.toContain("Alpha task in sibling");
    expect(JSON.stringify(r.narrow)).not.toContain("Alpha Sibling Project");
  });

  it("leaves an all-scope token and a cookie session seeing both projects", async () => {
    const r = await getAsAll<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>(`/workspaces/${wsA}/search?q=Alpha`);

    expect(r.allStatus).toBe(200);
    expect(sorted(r.all.projects.map((p) => p.id))).toEqual(
      sorted([projSelected, projSibling]),
    );
    expect(sorted(r.all.tasks.map((t) => t.id))).toEqual(
      sorted([taskSelected, taskSibling]),
    );

    expect(r.cookieStatus).toBe(200);
    expect(sorted(r.cookie.projects.map((p) => p.id))).toEqual(
      sorted([projSelected, projSibling]),
    );
    expect(sorted(r.cookie.tasks.map((t) => t.id))).toEqual(
      sorted([taskSelected, taskSibling]),
    );
  });

  it("returns nothing at all for a token narrowed to an empty list", async () => {
    // The fail-closed edge. An empty `IN ()` compiled to a no-op would hand
    // this token the entire workspace.
    const res = await appWith(emptyToken()).request(
      `/workspaces/${wsA}/search?q=Alpha`,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ projects: unknown[]; tasks: unknown[] }>();
    expect(body.projects).toEqual([]);
    expect(body.tasks).toEqual([]);
  });
});

describe("GET /workspaces/:id/dashboard", () => {
  it("aggregates only over the narrow token's project", async () => {
    const r = await getAsAll<{
      projects: { id: string }[];
      taskCounts: { totalCount: number };
    }>(`/workspaces/${wsA}/dashboard`);

    expect(r.narrowStatus).toBe(200);
    expect(r.narrow.projects.map((p) => p.id)).toEqual([projSelected]);
    // The rolled-up count is the assertion that matters: an unfiltered
    // aggregate leaks the sibling project as a NUMBER, which no row-level
    // inspection of the response would reveal.
    expect(r.narrow.taskCounts.totalCount).toBe(1);
  });

  it("leaves an all-scope token and a cookie session aggregating over both", async () => {
    const r = await getAsAll<{
      projects: { id: string }[];
      taskCounts: { totalCount: number };
    }>(`/workspaces/${wsA}/dashboard`);

    expect(r.allStatus).toBe(200);
    expect(sorted(r.all.projects.map((p) => p.id))).toEqual(
      sorted([projSelected, projSibling]),
    );
    expect(r.all.taskCounts.totalCount).toBe(2);

    expect(r.cookieStatus).toBe(200);
    expect(sorted(r.cookie.projects.map((p) => p.id))).toEqual(
      sorted([projSelected, projSibling]),
    );
    expect(r.cookie.taskCounts.totalCount).toBe(2);
  });
});

describe("GET /workspaces/:id/dashboard/my-tasks", () => {
  it("returns only the narrow token's tasks", async () => {
    const r = await getAsAll<{ tasks: { id: string }[] }>(
      `/workspaces/${wsA}/dashboard/my-tasks`,
    );

    expect(r.narrowStatus).toBe(200);
    expect(r.narrow.tasks.map((t) => t.id)).toEqual([taskSelected]);

    expect(sorted(r.all.tasks.map((t) => t.id))).toEqual(
      sorted([taskSelected, taskSibling]),
    );
    expect(sorted(r.cookie.tasks.map((t) => t.id))).toEqual(
      sorted([taskSelected, taskSibling]),
    );
  });

  it("intersects with — never overrides — the caller's own projectIds filter", async () => {
    // A narrowed token explicitly ASKING for the sibling project must get
    // nothing, not the sibling project. The two filters must intersect.
    const res = await appWith(narrowToken()).request(
      `/workspaces/${wsA}/dashboard/my-tasks?projectIds=${projSibling}`,
    );
    expect(res.status).toBe(200);
    expect((await res.json<{ tasks: unknown[] }>()).tasks).toEqual([]);

    // Same request on a cookie session still works — proof the intersection
    // is token-driven, not a blanket rejection of the query parameter.
    const human = await appWith(null).request(
      `/workspaces/${wsA}/dashboard/my-tasks?projectIds=${projSibling}`,
    );
    const humanTasks = await human.json<{ tasks: { id: string }[] }>();
    expect(humanTasks.tasks.map((t) => t.id)).toEqual([taskSibling]);
  });
});

describe("GET /workspaces/:id/dashboard/upcoming", () => {
  it("buckets only the narrow token's tasks", async () => {
    const r = await getAsAll<{ buckets: Record<string, { id: string }[]> }>(
      `/workspaces/${wsA}/dashboard/upcoming`,
    );

    const ids = (b: Record<string, { id: string }[]>) =>
      sorted(Object.values(b).flat().map((t) => t.id));

    expect(r.narrowStatus).toBe(200);
    expect(ids(r.narrow.buckets)).toEqual([taskSelected]);
    expect(ids(r.all.buckets)).toEqual(sorted([taskSelected, taskSibling]));
    expect(ids(r.cookie.buckets)).toEqual(sorted([taskSelected, taskSibling]));
  });
});

describe("GET /workspaces/:id/activity", () => {
  it("returns only the narrow token's project history", async () => {
    const r = await getAsAll<{ activities: { taskId: string; newValue: string }[] }>(
      `/workspaces/${wsA}/activity`,
    );

    expect(r.narrowStatus).toBe(200);
    expect(r.narrow.activities.map((a) => a.taskId)).toEqual([taskSelected]);
    // Activity rows carry before/after VALUES, so an unfiltered feed leaks the
    // sibling's task content, not merely its metadata.
    expect(JSON.stringify(r.narrow)).not.toContain("secret-sibling-value");
    expect(JSON.stringify(r.narrow)).toContain("secret-selected-value");

    expect(sorted(r.all.activities.map((a) => a.taskId))).toEqual(
      sorted([taskSelected, taskSibling]),
    );
    expect(sorted(r.cookie.activities.map((a) => a.taskId))).toEqual(
      sorted([taskSelected, taskSibling]),
    );
  });
});

describe("GET /workspaces/:id/labels", () => {
  it("returns only the narrow token's project labels", async () => {
    const r = await getAsAll<{ labels: { name: string }[] }>(
      `/workspaces/${wsA}/labels`,
    );

    expect(r.narrowStatus).toBe(200);
    expect(r.narrow.labels.map((l) => l.name)).toEqual(["label-selected"]);
    expect(sorted(r.all.labels.map((l) => l.name))).toEqual(
      sorted(["label-selected", "label-sibling"]),
    );
    expect(sorted(r.cookie.labels.map((l) => l.name))).toEqual(
      sorted(["label-selected", "label-sibling"]),
    );
  });
});

describe("GET /workspaces/:id/task-groups", () => {
  it("drops requested project ids the narrow token may not see", async () => {
    const path = `/workspaces/${wsA}/task-groups?projectIds=${projSelected},${projSibling}`;
    const r = await getAsAll<{ taskGroups: { id: string; projectId: string }[] }>(path);

    expect(r.narrowStatus).toBe(200);
    expect(r.narrow.taskGroups.map((g) => g.id)).toEqual([groupSelected]);
    expect(sorted(r.all.taskGroups.map((g) => g.id))).toEqual(
      sorted([groupSelected, groupSibling]),
    );
    expect(sorted(r.cookie.taskGroups.map((g) => g.id))).toEqual(
      sorted([groupSelected, groupSibling]),
    );
  });

  it("returns an empty list when the narrow token asks only for a denied project", async () => {
    const res = await appWith(narrowToken()).request(
      `/workspaces/${wsA}/task-groups?projectIds=${projSibling}`,
    );
    expect(res.status).toBe(200);
    expect((await res.json<{ taskGroups: unknown[] }>()).taskGroups).toEqual([]);
  });
});

describe("GET /workspaces/:id/projects", () => {
  it("lists only the narrow token's project", async () => {
    const r = await getAsAll<{ projects: { id: string; name: string }[] }>(
      `/workspaces/${wsA}/projects`,
    );

    expect(r.narrowStatus).toBe(200);
    expect(r.narrow.projects.map((p) => p.id)).toEqual([projSelected]);
    expect(JSON.stringify(r.narrow)).not.toContain("Alpha Sibling Project");

    expect(sorted(r.all.projects.map((p) => p.id))).toEqual(
      sorted([projSelected, projSibling]),
    );
    expect(sorted(r.cookie.projects.map((p) => p.id))).toEqual(
      sorted([projSelected, projSibling]),
    );
  });
});

// ---------------------------------------------------------------------------
// Webhooks — the write half, where the policy is REJECT
// ---------------------------------------------------------------------------

/** Read a webhook row straight from the DB — a 403 that still wrote is not a fix. */
async function readWebhook(id: string) {
  return await d1
    .prepare("SELECT id, name, projectId, url, active FROM webhook WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; projectId: string | null; url: string; active: number }>();
}

/** Every webhook id currently in workspace A. */
async function webhookIds(): Promise<string[]> {
  const { results } = await d1
    .prepare("SELECT id FROM webhook WHERE workspaceId = ?")
    .bind(wsA)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

const SEEDED_WEBHOOKS = () => sorted([whSelected, whSibling, whWorkspace]);

describe("GET /workspaces/:id/webhooks", () => {
  it("lists only webhooks targeting the narrow token's project", async () => {
    const r = await getAsAll<{ webhooks: { id: string }[] }>(
      `/workspaces/${wsA}/webhooks`,
    );

    expect(r.narrowStatus).toBe(200);
    // The workspace-wide webhook is excluded too: its event stream covers
    // every project, so it is no more the narrow token's to see than the
    // sibling's is.
    expect(r.narrow.webhooks.map((w) => w.id)).toEqual([whSelected]);
    expect(sorted(r.all.webhooks.map((w) => w.id))).toEqual(SEEDED_WEBHOOKS());
    expect(sorted(r.cookie.webhooks.map((w) => w.id))).toEqual(SEEDED_WEBHOOKS());
  });
});

describe("GET /workspaces/:id/webhooks/:webhookId", () => {
  it("refuses the narrow token on a sibling-project and a workspace-wide webhook", async () => {
    for (const id of [whSibling, whWorkspace]) {
      const res = await appWith(narrowToken()).request(
        `/workspaces/${wsA}/webhooks/${id}`,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "Forbidden" });
    }
  });

  it("serves the narrow token its own project's webhook, and everyone else all three", async () => {
    const own = await appWith(narrowToken()).request(
      `/workspaces/${wsA}/webhooks/${whSelected}`,
    );
    expect(own.status).toBe(200);
    expect(await own.json<{ webhook: { id: string } }>()).toMatchObject({
      webhook: { id: whSelected },
    });

    for (const token of [allToken(), null]) {
      for (const id of [whSelected, whSibling, whWorkspace]) {
        const res = await appWith(token).request(`/workspaces/${wsA}/webhooks/${id}`);
        expect(res.status).toBe(200);
      }
    }
  });
});

describe("POST /workspaces/:id/webhooks", () => {
  afterEach(async () => {
    // Remove anything a test created so the list/count assertions elsewhere
    // keep describing the seeded fixture.
    await d1
      .prepare("DELETE FROM webhook WHERE workspaceId = ? AND id NOT IN (?, ?, ?)")
      .bind(wsA, whSelected, whSibling, whWorkspace)
      .run();
  });

  const body = (projectId?: string) => ({
    name: "created-by-test",
    url: "https://example.com/created",
    events: ["task.created"],
    ...(projectId ? { projectId } : {}),
  });

  it("refuses to persist a webhook targeting a project outside the token's list", async () => {
    const before = await webhookIds();
    const res = await appWith(narrowToken()).request(
      jsonRequest("POST", `/workspaces/${wsA}/webhooks`, body(projSibling)),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Forbidden" });
    // The post-condition is the whole point: this endpoint mints a PERMANENT
    // exfiltration pipe, so "returned 403" is worthless without "wrote nothing".
    expect(sorted(await webhookIds())).toEqual(sorted(before));
  });

  it("refuses to persist a workspace-wide webhook for a narrowed token", async () => {
    // Without this the fix is trivially bypassable: denied project P2, a token
    // would register a null-project webhook and receive P2's events anyway.
    const before = await webhookIds();
    const res = await appWith(narrowToken()).request(
      jsonRequest("POST", `/workspaces/${wsA}/webhooks`, body()),
    );

    expect(res.status).toBe(403);
    expect(sorted(await webhookIds())).toEqual(sorted(before));
  });

  it("answers an unknown project id identically to an off-list one (no existence oracle)", async () => {
    // Guard order is the security property here. If `projectBelongsToWorkspace`
    // ran first, a narrowed token could enumerate real project ids: an existing
    // sibling would answer 403 while a random UUID answered
    // `400 Project not found in this workspace`. Binding first collapses both
    // to the same 403 with the same body.
    const unknownId = crypto.randomUUID();
    const [offList, unknown] = await Promise.all([
      appWith(narrowToken()).request(
        jsonRequest("POST", `/workspaces/${wsA}/webhooks`, body(projSibling)),
      ),
      appWith(narrowToken()).request(
        jsonRequest("POST", `/workspaces/${wsA}/webhooks`, body(unknownId)),
      ),
    ]);

    expect(offList.status).toBe(unknown.status);
    expect(offList.status).toBe(403);
    expect(await offList.json<{ error: string }>()).toEqual(
      await unknown.json<{ error: string }>(),
    );
  });

  it("still gives a cookie session the more useful 400 for an unknown project id", async () => {
    // The oracle only has to be closed for callers that could be enumerating.
    // A human already knows which projects exist, so they keep the diagnostic.
    const res = await appWith(null).request(
      jsonRequest("POST", `/workspaces/${wsA}/webhooks`, body(crypto.randomUUID())),
    );
    expect(res.status).toBe(400);
    expect(await res.json<{ error: string }>()).toMatchObject({
      error: "Project not found in this workspace",
    });
  });

  it("still persists a webhook for a project ON the token's list", async () => {
    const res = await appWith(narrowToken()).request(
      jsonRequest("POST", `/workspaces/${wsA}/webhooks`, body(projSelected)),
    );
    expect(res.status).toBe(201);

    const created = await res.json<{ webhook: { id: string } }>();
    const row = await readWebhook(created.webhook.id);
    expect(row?.projectId).toBe(projSelected);
  });

  it("leaves an all-scope token and a cookie session able to target any project", async () => {
    for (const token of [allToken(), null]) {
      for (const projectId of [projSibling, undefined]) {
        const res = await appWith(token).request(
          jsonRequest("POST", `/workspaces/${wsA}/webhooks`, body(projectId)),
        );
        expect(res.status).toBe(201);
        const created = await res.json<{ webhook: { id: string } }>();
        const row = await readWebhook(created.webhook.id);
        expect(row?.projectId).toBe(projectId ?? null);
      }
    }
  });
});

describe("PATCH /workspaces/:id/webhooks/:webhookId", () => {
  afterEach(async () => {
    // Restore the fixture rows so ordering between tests cannot matter.
    await d1
      .prepare("UPDATE webhook SET name = ?, projectId = ? WHERE id = ?")
      .bind("wh-selected", projSelected, whSelected)
      .run();
    await d1
      .prepare("UPDATE webhook SET name = ?, projectId = ?, url = ? WHERE id = ?")
      .bind("wh-sibling", projSibling, "https://example.com/webhook", whSibling)
      .run();
  });

  it("refuses to let a narrow token edit a sibling project's webhook", async () => {
    const res = await appWith(narrowToken()).request(
      jsonRequest("PATCH", `/workspaces/${wsA}/webhooks/${whSibling}`, {
        name: "hijacked",
      }),
    );
    expect(res.status).toBe(403);
    expect((await readWebhook(whSibling))?.name).toBe("wh-sibling");
  });

  it("refuses to let a narrow token REPOINT its own webhook at a denied project", async () => {
    const res = await appWith(narrowToken()).request(
      jsonRequest("PATCH", `/workspaces/${wsA}/webhooks/${whSelected}`, {
        projectId: projSibling,
      }),
    );
    expect(res.status).toBe(403);
    expect((await readWebhook(whSelected))?.projectId).toBe(projSelected);
  });

  it("refuses to let a narrow token widen its own webhook to workspace-wide", async () => {
    const res = await appWith(narrowToken()).request(
      jsonRequest("PATCH", `/workspaces/${wsA}/webhooks/${whSelected}`, {
        projectId: null,
      }),
    );
    expect(res.status).toBe(403);
    expect((await readWebhook(whSelected))?.projectId).toBe(projSelected);
  });

  it("refuses to let a narrow token STEAL a sibling webhook by repointing it in-scope", async () => {
    // The subtle one, and the reason the current target and the new target are
    // checked separately. Validating only the NEW target lets a narrowed token
    // claim a webhook it cannot otherwise touch — `projectId: <its own>` makes
    // the new target legal, and the same request can rename it, change its URL
    // and regenerate its secret. The victim project's integration silently
    // stops receiving events and the attacker's endpoint starts.
    const res = await appWith(narrowToken()).request(
      jsonRequest("PATCH", `/workspaces/${wsA}/webhooks/${whSibling}`, {
        projectId: projSelected,
        name: "stolen",
        url: "https://attacker.example.com/hook",
        regenerateSecret: true,
      }),
    );
    expect(res.status).toBe(403);

    const row = await readWebhook(whSibling);
    expect(row?.projectId).toBe(projSibling);
    expect(row?.name).toBe("wh-sibling");
    expect(row?.url).toBe("https://example.com/webhook");
  });

  it("still lets a narrow token edit its OWN project's webhook", async () => {
    const res = await appWith(narrowToken()).request(
      jsonRequest("PATCH", `/workspaces/${wsA}/webhooks/${whSelected}`, {
        name: "renamed-in-scope",
      }),
    );
    expect(res.status).toBe(200);
    expect((await readWebhook(whSelected))?.name).toBe("renamed-in-scope");
  });

  it("leaves an all-scope token and a cookie session able to edit any webhook", async () => {
    const viaToken = await appWith(allToken()).request(
      jsonRequest("PATCH", `/workspaces/${wsA}/webhooks/${whSibling}`, {
        name: "renamed-by-all-token",
      }),
    );
    expect(viaToken.status).toBe(200);
    expect((await readWebhook(whSibling))?.name).toBe("renamed-by-all-token");

    const viaCookie = await appWith(null).request(
      jsonRequest("PATCH", `/workspaces/${wsA}/webhooks/${whSibling}`, {
        name: "renamed-by-cookie",
      }),
    );
    expect(viaCookie.status).toBe(200);
    expect((await readWebhook(whSibling))?.name).toBe("renamed-by-cookie");
  });
});

describe("DELETE /workspaces/:id/webhooks/:webhookId", () => {
  it("refuses a narrow token on a sibling-project webhook and leaves the row intact", async () => {
    // Deleting another project's webhook is a denial of service on that
    // project's integrations, so it is bound exactly like a read.
    const res = await appWith(narrowToken()).request(
      jsonRequest("DELETE", `/workspaces/${wsA}/webhooks/${whSibling}`),
    );
    expect(res.status).toBe(403);
    expect(await readWebhook(whSibling)).not.toBeNull();
  });

  it("lets a cookie session delete a throwaway webhook in the sibling project", async () => {
    const throwaway = (
      await seedWebhook(d1, wsA, { name: "wh-throwaway", projectId: projSibling })
    ).id;
    const res = await appWith(null).request(
      jsonRequest("DELETE", `/workspaces/${wsA}/webhooks/${throwaway}`),
    );
    expect(res.status).toBe(204);
    expect(await readWebhook(throwaway)).toBeNull();
  });
});

describe("POST /workspaces/:id/webhooks/:webhookId/test", () => {
  it("refuses a narrow token on a sibling webhook and fires no delivery", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await appWith(narrowToken()).request(
        jsonRequest("POST", `/workspaces/${wsA}/webhooks/${whSibling}/test`),
      );
      expect(res.status).toBe(403);
      // `/test` sends a real signed request to the subscriber, so a denial that
      // still called out would confirm the sibling's endpoint is live.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still lets a cookie session test the sibling webhook", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await appWith(null).request(
        jsonRequest("POST", `/workspaces/${wsA}/webhooks/${whSibling}/test`),
      );
      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// Export — the policy is REJECT, because a partial archive would lie
// ---------------------------------------------------------------------------

describe("GET /workspaces/:id/export", () => {
  it("refuses a project-narrowed token outright", async () => {
    const res = await appWith(narrowToken()).request(`/workspaces/${wsA}/export`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Forbidden" });
  });

  it("refuses a token narrowed to an empty list", async () => {
    const res = await appWith(emptyToken()).request(`/workspaces/${wsA}/export`);
    expect(res.status).toBe(403);
  });

  it("still serves the COMPLETE archive to an all-scope token and a cookie session", async () => {
    for (const token of [allToken(), null]) {
      const res = await appWith(token).request(`/workspaces/${wsA}/export`);
      expect(res.status).toBe(200);
      const doc = await res.json<{ projects: { name: string }[] }>();
      expect(sorted(doc.projects.map((p) => p.name))).toEqual(
        sorted(["Alpha Selected Project", "Alpha Sibling Project"]),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Notifications — project-owned data on a route with no :workspaceId
// ---------------------------------------------------------------------------

/**
 * `/notifications` is the odd one out: keyed by user, mounted behind
 * `requireAuth` alone. It therefore needs BOTH halves of the policy applied in
 * the handler — a narrowed token must not see a sibling project's rows, and a
 * token bound to workspace A must not see workspace B's at all, because no
 * guard on this route ever compares the token's workspace to anything.
 *
 * The rows matter more than the count: the producers copy the task title and a
 * 200-character comment excerpt into `title`/`body`, so an unfiltered feed is a
 * direct read of project content, not metadata.
 */
describe("GET /notifications", () => {
  it("shows a narrowed token only its own project's rows, plus non-project rows in its workspace", async () => {
    const res = await appWith(narrowToken()).request("/notifications");
    expect(res.status).toBe(200);
    const body = await res.json<{ notifications: { id: string }[] }>();

    expect(sorted(body.notifications.map((n) => n.id))).toEqual(
      sorted([notifSelected, notifWorkspaceLevel, notifUntethered]),
    );
    // The sibling project's task title and comment excerpt are the payload
    // that made this a real leak rather than an id disclosure.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("SIBLING SECRET TASK");
    expect(raw).not.toContain("sibling comment body leak");
    expect(raw).not.toContain("Notification from workspace B");
    expect(raw).not.toContain("You were invited to Workspace B");
  });

  it("keeps an all-scope token out of OTHER workspaces", async () => {
    // The workspace half, which `projectScope: "all"` does not relax: a token
    // is bound to exactly one workspace at mint time.
    const res = await appWith(allToken()).request("/notifications");
    expect(res.status).toBe(200);
    const body = await res.json<{ notifications: { id: string }[] }>();

    expect(sorted(body.notifications.map((n) => n.id))).toEqual(
      sorted([notifSelected, notifSibling, notifWorkspaceLevel, notifUntethered]),
    );
    expect(body.notifications.map((n) => n.id)).not.toContain(notifOtherWorkspace);
    expect(body.notifications.map((n) => n.id)).not.toContain(
      notifForeignWorkspaceLevel,
    );
  });

  it("leaves a cookie session seeing the entire inbox across every workspace", async () => {
    const res = await appWith(null).request("/notifications");
    expect(res.status).toBe(200);
    const body = await res.json<{ notifications: { id: string }[] }>();

    expect(sorted(body.notifications.map((n) => n.id))).toEqual(
      sorted([
        notifSelected,
        notifSibling,
        notifOtherWorkspace,
        notifWorkspaceLevel,
        notifForeignWorkspaceLevel,
        notifUntethered,
      ]),
    );
  });

  it("shows a token narrowed to an empty list only its non-project rows", async () => {
    // Fail-closed, but not over-closed: an empty project list removes every
    // project-owned row while leaving the workspace-level invitation notice.
    const res = await appWith(emptyToken()).request("/notifications");
    const body = await res.json<{ notifications: { id: string }[] }>();
    expect(sorted(body.notifications.map((n) => n.id))).toEqual(
      sorted([notifWorkspaceLevel, notifUntethered]),
    );
  });
});

describe("GET /notifications/unread-count", () => {
  it("counts only what each caller can actually read", async () => {
    // A count that disagreed with the list it labels would be both a leak and
    // a visible bug in the UI badge.
    const counts: Record<string, number> = {};
    for (const [label, token] of [
      ["narrow", narrowToken()],
      ["all", allToken()],
      ["cookie", null],
    ] as const) {
      const res = await appWith(token).request("/notifications/unread-count");
      expect(res.status).toBe(200);
      counts[label] = (await res.json<{ count: number }>()).count;
    }
    expect(counts).toEqual({ narrow: 3, all: 4, cookie: 6 });
  });
});

describe("notification mutations", () => {
  afterEach(async () => {
    await d1.prepare("UPDATE notification SET read = 0, readAt = NULL").run();
  });

  /** Read a notification's `read` flag straight from D1. */
  async function isRead(id: string): Promise<boolean> {
    const row = await d1
      .prepare("SELECT read FROM notification WHERE id = ?")
      .bind(id)
      .first<{ read: number }>();
    return row?.read === 1;
  }

  it("404s a narrowed token marking a sibling project's notification read, and does not write", async () => {
    // 404 rather than 403 on purpose: the row is invisible to this token, and
    // a distinct status would confirm the id exists.
    const res = await appWith(narrowToken()).request(
      jsonRequest("PATCH", `/notifications/${notifSibling}/read`),
    );
    expect(res.status).toBe(404);
    expect(await isRead(notifSibling)).toBe(false);
  });

  it("still lets a narrowed token mark its OWN project's notification read", async () => {
    const res = await appWith(narrowToken()).request(
      jsonRequest("PATCH", `/notifications/${notifSelected}/read`),
    );
    expect(res.status).toBe(200);
    expect(await isRead(notifSelected)).toBe(true);
  });

  it("404s a narrowed token deleting a sibling notification, and the row survives", async () => {
    const res = await appWith(narrowToken()).request(
      jsonRequest("DELETE", `/notifications/${notifSibling}`),
    );
    expect(res.status).toBe(404);
    const row = await d1
      .prepare("SELECT id FROM notification WHERE id = ?")
      .bind(notifSibling)
      .first<{ id: string }>();
    expect(row?.id).toBe(notifSibling);
  });

  it("limits mark-all-read to the rows the token can see", async () => {
    // The destructive case: an unscoped sweep would mark a human's entire
    // inbox read on behalf of a token that cannot even read most of it.
    const res = await appWith(narrowToken()).request(
      jsonRequest("POST", "/notifications/mark-all-read"),
    );
    expect(res.status).toBe(200);

    expect(await isRead(notifSelected)).toBe(true);
    expect(await isRead(notifWorkspaceLevel)).toBe(true);
    expect(await isRead(notifUntethered)).toBe(true);
    expect(await isRead(notifSibling)).toBe(false);
    expect(await isRead(notifOtherWorkspace)).toBe(false);
    expect(await isRead(notifForeignWorkspaceLevel)).toBe(false);
  });

  it("leaves a cookie session sweeping its whole inbox", async () => {
    const res = await appWith(null).request(
      jsonRequest("POST", "/notifications/mark-all-read"),
    );
    expect(res.status).toBe(200);
    for (const id of [
      notifSelected,
      notifSibling,
      notifOtherWorkspace,
      notifWorkspaceLevel,
      notifForeignWorkspaceLevel,
      notifUntethered,
    ]) {
      expect(await isRead(id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-closed sweep across every filtered read
// ---------------------------------------------------------------------------

/**
 * A token narrowed to an empty list is the case where a filter that silently
 * degraded to a no-op would hand over the whole workspace. The dedicated
 * per-endpoint tests above cover content; this sweep covers *reach*, so a
 * future endpoint added to the filter set cannot pass with a `1 = 0` that was
 * never wired in.
 */
describe("a token narrowed to an empty list sees nothing anywhere", () => {
  const cases: Array<[string, string, (b: Record<string, unknown>) => unknown[]]> = [
    ["projects", `/workspaces/{ws}/projects`, (b) => b.projects as unknown[]],
    ["search", `/workspaces/{ws}/search?q=Alpha`, (b) => b.tasks as unknown[]],
    ["dashboard", `/workspaces/{ws}/dashboard`, (b) => b.projects as unknown[]],
    ["my-tasks", `/workspaces/{ws}/dashboard/my-tasks`, (b) => b.tasks as unknown[]],
    [
      "upcoming",
      `/workspaces/{ws}/dashboard/upcoming`,
      (b) => Object.values(b.buckets as Record<string, unknown[]>).flat(),
    ],
    ["activity", `/workspaces/{ws}/activity`, (b) => b.activities as unknown[]],
    ["labels", `/workspaces/{ws}/labels`, (b) => b.labels as unknown[]],
    ["webhooks", `/workspaces/{ws}/webhooks`, (b) => b.webhooks as unknown[]],
  ];

  for (const [label, template, extract] of cases) {
    it(`returns an empty ${label} collection`, async () => {
      const res = await appWith(emptyToken()).request(
        template.replace("{ws}", wsA),
      );
      expect(res.status).toBe(200);
      expect(extract(await res.json<Record<string, unknown>>())).toEqual([]);
    });
  }

  it("returns no task groups even when explicitly asked for both projects", async () => {
    const res = await appWith(emptyToken()).request(
      `/workspaces/${wsA}/task-groups?projectIds=${projSelected},${projSibling}`,
    );
    expect(res.status).toBe(200);
    expect((await res.json<{ taskGroups: unknown[] }>()).taskGroups).toEqual([]);
  });
});
