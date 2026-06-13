/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the workspace export endpoint.
 *
 * Uses a real in-memory D1 (Miniflare) so the one-batch SELECT strategy is
 * exercised against actual SQL, following the workspaces.handlers.test.ts
 * pattern (bare Hono + fakeAuth + seed helpers).
 *
 * Why these tests matter beyond coverage numbers:
 *
 * - **The contract test** (`workspaceExportSchema.parse` on the full
 *   streamed body) is the load-bearing guarantee of the whole feature:
 *   the export endpoint and the import validator share ONE schema, so a
 *   document that parses here is by construction importable. Because the
 *   webhook/invitation sections are `z.strictObject`, this same parse is
 *   also the secret-leak tripwire — a handler regression that spreads a
 *   raw DB row (with `secret`/`token`) into the envelope FAILS the parse
 *   instead of silently shipping credentials in user downloads.
 *
 * - **The raw-body string search for secrets** complements the schema
 *   check: it would catch a leak through any non-strict section too
 *   (defense in depth on the single most dangerous failure mode).
 *
 * - **The ex-member directory test** pins the design decision that
 *   `assigneeId`/`completedBy`/`authorId` references to departed users
 *   still resolve in the `users` directory — attribution of work is
 *   workspace data and must survive membership churn.
 *
 * - **The single-document streaming tests** exist because this endpoint
 *   is the first ReadableStream response in src/api: the chunked
 *   head/per-project/close serialization MUST reassemble into exactly one
 *   valid JSON document for every project count, including zero.
 *
 * - **The audit test** asserts the egress ledger: a workspace-wide data
 *   download that left no trace would be a security-review finding.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { workspaceExportSchema } from "../../../shared/schemas/workspace-export";
import type { AppEnv } from "../../env";
import { requireWorkspaceRole } from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import {
  createTestD1,
  fakeAuth,
  fakeEnv,
  sampleUnsplashPayload,
  seedComment,
  seedInvitation,
  seedLabel,
  seedProject,
  seedProjectMember,
  seedSubtask,
  seedTask,
  seedTaskActivity,
  seedTaskGroup,
  seedTeam,
  seedTeamMember,
  seedUser,
  seedWebhook,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import { exportWorkspace } from "./export.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;

/** A user who is referenced by tasks/comments but is NOT a workspace
 *  member — the "departed colleague" case the users directory must cover. */
const EX_MEMBER = {
  id: "ex-member-user-id",
  name: "Departed Colleague",
  email: "departed@example.com",
};

const WEBHOOK_SECRET = "whsec_super_secret_signing_value_42";

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  await d1
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
    )
    .bind(EX_MEMBER.id, EX_MEMBER.name, EX_MEMBER.email, 1700000000, 1700000000)
    .run();
});

afterAll(async () => {
  await dispose();
});

/** See workspaces.handlers.test.ts — injects an env object so fakeAuth can
 *  attach the D1 binding when Hono's test request has no env. */
async function req(app: Hono<AppEnv>, input: string | Request): Promise<Response> {
  return await app.request(input, undefined, {});
}

/** Handler-only app (auth middleware bypassed) for body/contract tests. */
function createHandlerApp(user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER) {
  const app = new Hono<AppEnv>();
  app.use("/*", fakeAuth(d1, user));
  app.get("/workspaces/:workspaceId/export", exportWorkspace);
  return app;
}

/** Route-shaped app with the REAL auth/role middleware stack (membership
 *  resolved against D1) for the 401/403 authorization tests. */
function createGuardedApp(user?: typeof TEST_USER | typeof TEST_USER_2) {
  const app = new Hono<AppEnv>();
  app.use("/*", user ? fakeAuth(d1, user) : fakeEnv(d1));
  app.get(
    "/workspaces/:workspaceId/export",
    requireAuth,
    requireWorkspaceRole("owner", "admin"),
    exportWorkspace,
  );
  return app;
}

// ---------------------------------------------------------------------------
// Seed: a workspace exercising every exported table
// ---------------------------------------------------------------------------

type SeededGraph = {
  wsId: string;
  slug: string;
  projectId: string;
  groupId: string;
  doneGroupId: string;
  labelId: string;
  taskId: string;
  recurringTaskId: string;
  attachmentKey: string;
  /** Unique per graph — `invitation.token` carries a UNIQUE index. */
  invitationToken: string;
};

/**
 * Seeds the full workspace graph: members, team, webhook (with secret),
 * invitation (with token), project with groups/labels, tasks covering the
 * calendar (startDate), ICS provenance (sourceUid), recurrence, cost and
 * Unsplash-cover columns, subtasks, comments (incl. one by the
 * ex-member), task labels, an attachment+upload pair, and activity rows.
 * Each call uses a unique slug so tests stay independent on the shared D1.
 */
async function seedFullGraph(): Promise<SeededGraph> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const slug = `export-ws-${suffix}`;
  const wsId = await seedWorkspace(d1, TEST_USER.id, { name: "Export WS", slug });
  await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

  const teamId = await seedTeam(d1, wsId, { name: "Core Team" });
  await seedTeamMember(d1, teamId, TEST_USER.id, "lead");
  await seedTeamMember(d1, teamId, TEST_USER_2.id, "member");

  const projectId = await seedProject(d1, wsId, {
    name: "Export Project",
    description: "Project under export test",
    budget: 250_000,
    coverUnsplash: sampleUnsplashPayload("export-project-cover"),
  });
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  await seedProjectMember(d1, projectId, TEST_USER_2.id, "viewer");

  await seedWebhook(d1, wsId, {
    name: "CI Notifier",
    url: "https://example.com/hooks/ci",
    secret: WEBHOOK_SECRET,
    events: JSON.stringify(["task.created", "task.completed"]),
    projectId,
  });
  const invitationToken = `invitation-secret-acceptance-token-${suffix}`;
  await seedInvitation(d1, wsId, {
    email: "newcomer@example.com",
    role: "member",
    token: invitationToken,
    status: "pending",
  });

  const groupId = await seedTaskGroup(d1, projectId, { name: "To Do" });
  const doneGroupId = await seedTaskGroup(d1, projectId, {
    name: "Done",
    isCompletionGroup: true,
  });
  const labelId = await seedLabel(d1, projectId, "bug", "#ff0000");

  // Task 1: assigned to the EX-member, date range + cost + cover + sourceUid.
  const taskId = await seedTask(d1, projectId, groupId, {
    title: "Calendar task",
    description: "Has a start/due range",
    assigneeId: EX_MEMBER.id,
    priority: "high",
    startDate: new Date("2026-06-01T00:00:00Z"),
    dueDate: new Date("2026-06-15T00:00:00Z"),
    cost: 12_500,
    icon: "calendar",
    coverUnsplash: sampleUnsplashPayload("export-task-cover"),
  });
  await d1
    .prepare("UPDATE task SET source_uid = ? WHERE id = ?")
    .bind("ics-uid-export-test@example.com", taskId)
    .run();

  // Task 2: recurring + completed by the ex-member (completedBy reference).
  const recurringTaskId = await seedTask(d1, projectId, doneGroupId, {
    title: "Recurring chore",
    completed: true,
    priority: "low",
  });
  await d1
    .prepare(
      "UPDATE task SET recurrence_rule = ?, recurrence_series_id = ?, completedBy = ?, completedAt = ? WHERE id = ?",
    )
    .bind(
      JSON.stringify({ frequency: "weekly", interval: 1, daysOfWeek: [1, 3] }),
      "series-export-test",
      EX_MEMBER.id,
      Math.floor(Date.now() / 1000),
      recurringTaskId,
    )
    .run();

  await seedSubtask(d1, taskId, { title: "Subtask A", completed: true });
  await seedSubtask(d1, taskId, { title: "Subtask B" });
  // Distinct createdAt values: the export orders comments by createdAt and
  // the contract test asserts that order, so same-second seeds would flake.
  await seedComment(d1, taskId, TEST_USER.id, {
    body: "Member comment",
    createdAt: new Date("2026-01-01T10:00:00Z"),
  });
  await seedComment(d1, taskId, EX_MEMBER.id, {
    body: "Comment by departed user",
    createdAt: new Date("2026-01-02T10:00:00Z"),
  });

  // Task ↔ label link.
  await d1
    .prepare(
      "INSERT INTO task_label (id, taskId, labelId, createdAt) VALUES (?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), taskId, labelId, Math.floor(Date.now() / 1000))
    .run();

  // Attachment manifest source: upload row + task_attachment join row. The
  // binary itself never participates in export, so no R2 fixture is needed.
  const attachmentKey = `task-attachment/${TEST_USER.id}/${suffix}.pdf`;
  const uploadId = crypto.randomUUID();
  await d1
    .prepare(
      "INSERT INTO upload (id, userId, key, filename, mimeType, size, purpose, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      uploadId,
      TEST_USER.id,
      attachmentKey,
      "spec.pdf",
      "application/pdf",
      34_567,
      "task-attachment",
      Math.floor(Date.now() / 1000),
    )
    .run();
  await d1
    .prepare(
      "INSERT INTO task_attachment (id, taskId, uploadId, createdAt) VALUES (?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), taskId, uploadId, Math.floor(Date.now() / 1000))
    .run();

  await seedTaskActivity(d1, taskId, TEST_USER.id, {
    action: "updated",
    field: "title",
    oldValue: "Old title",
    newValue: "Calendar task",
  });
  await seedTaskActivity(d1, recurringTaskId, EX_MEMBER.id, {
    action: "completed",
  });

  return {
    wsId,
    slug,
    projectId,
    groupId,
    doneGroupId,
    labelId,
    taskId,
    recurringTaskId,
    attachmentKey,
    invitationToken,
  };
}

/**
 * The audit insert runs through deferWork, which in the test env executes
 * inline but unawaited (`void work()`), so the row may land a tick after
 * the response resolves — poll briefly instead of racing it.
 */
async function waitForAuditRow(
  workspaceId: string,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const row = await d1
      .prepare("SELECT * FROM audit_log WHERE workspaceId = ? AND action = 'export'")
      .bind(workspaceId)
      .first();
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

// ---------------------------------------------------------------------------
// The contract test
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — contract", () => {
  it("streams a document that satisfies workspaceExportSchema with the full graph", async () => {
    const graph = await seedFullGraph();
    const app = createHandlerApp();

    const res = await req(
      app,
      `/workspaces/${graph.wsId}/export?includeActivity=true`,
    );
    expect(res.status).toBe(200);

    // Read the FULL streamed body and require it to be ONE valid JSON
    // document — the chunked serialization must be invisible to clients.
    const text = await res.text();
    const doc = workspaceExportSchema.parse(JSON.parse(text));

    expect(doc.format).toBe("cadence.workspace");
    expect(doc.formatVersion).toBe(1);
    expect(doc.exportedBy).toBe(TEST_USER.email);
    expect(doc.workspace.slug).toBe(graph.slug);

    // Workspace-level sections.
    expect(doc.members).toHaveLength(2);
    expect(doc.teams).toHaveLength(1);
    expect(doc.teams[0].members).toHaveLength(2);
    expect(doc.webhooks).toEqual([
      {
        name: "CI Notifier",
        url: "https://example.com/hooks/ci",
        events: ["task.created", "task.completed"],
        active: true,
        projectId: graph.projectId,
      },
    ]);
    expect(doc.invitations).toEqual([
      { email: "newcomer@example.com", role: "member", status: "pending" },
    ]);

    // Project subtree.
    expect(doc.projects).toHaveLength(1);
    const proj = doc.projects[0];
    expect(proj.id).toBe(graph.projectId);
    expect(proj.budget).toBe(250_000);
    expect(proj.coverUnsplash?.id).toBe("export-project-cover");
    expect(proj.members).toHaveLength(2);
    expect(proj.taskGroups.map((g) => g.id).sort()).toEqual(
      [graph.groupId, graph.doneGroupId].sort(),
    );
    // Split assertion instead of `createdAt: expect.any(String)` — expect.any
    // returns `any`, which trips no-unsafe-assignment in an object literal.
    expect(proj.labels).toHaveLength(1);
    expect(proj.labels[0]).toMatchObject({
      id: graph.labelId,
      name: "bug",
      color: "#ff0000",
    });
    expect(typeof proj.labels[0]?.createdAt).toBe("string");

    // Task field round-trip, including the calendar-ics columns.
    const calendarTask = proj.tasks.find((t) => t.id === graph.taskId);
    expect(calendarTask).toBeDefined();
    expect(calendarTask!.taskGroupId).toBe(graph.groupId);
    expect(calendarTask!.priority).toBe("high");
    expect(calendarTask!.assigneeRef).toBe(EX_MEMBER.id);
    expect(calendarTask!.startDate).toBe("2026-06-01T00:00:00.000Z");
    expect(calendarTask!.dueDate).toBe("2026-06-15T00:00:00.000Z");
    expect(calendarTask!.cost).toBe(12_500);
    expect(calendarTask!.sourceUid).toBe("ics-uid-export-test@example.com");
    expect(calendarTask!.coverUnsplash?.id).toBe("export-task-cover");
    expect(calendarTask!.labelIds).toEqual([graph.labelId]);
    expect(calendarTask!.subtasks.map((s) => s.title)).toEqual([
      "Subtask A",
      "Subtask B",
    ]);
    expect(calendarTask!.comments.map((c) => c.authorRef)).toEqual([
      TEST_USER.id,
      EX_MEMBER.id,
    ]);
    expect(calendarTask!.attachments).toEqual([
      {
        filename: "spec.pdf",
        mimeType: "application/pdf",
        size: 34_567,
        key: graph.attachmentKey,
        url: `/api/uploads/${graph.attachmentKey}`,
      },
    ]);
    expect(calendarTask!.activity).toHaveLength(1);

    const recurring = proj.tasks.find((t) => t.id === graph.recurringTaskId);
    expect(recurring).toBeDefined();
    expect(recurring!.recurrenceRule).toEqual({
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [1, 3],
    });
    expect(recurring!.recurrenceSeriesId).toBe("series-export-test");
    expect(recurring!.completed).toBe(true);
    expect(recurring!.completedByRef).toBe(EX_MEMBER.id);
    expect(recurring!.activity).toHaveLength(1);
    expect(recurring!.activity![0].actorRef).toBe(EX_MEMBER.id);
  });

  it("returns one valid JSON document for multiple projects and for zero projects", async () => {
    // Zero projects — the stream's open/close path with an empty array.
    const emptySlug = `export-empty-${crypto.randomUUID().slice(0, 8)}`;
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Empty WS",
      slug: emptySlug,
    });
    const app = createHandlerApp();

    const emptyRes = await req(app, `/workspaces/${emptyWsId}/export`);
    expect(emptyRes.status).toBe(200);
    const emptyDoc = workspaceExportSchema.parse(JSON.parse(await emptyRes.text()));
    expect(emptyDoc.projects).toEqual([]);

    // Multiple projects — exercises the comma-separated per-project chunks.
    const multiSlug = `export-multi-${crypto.randomUUID().slice(0, 8)}`;
    const multiWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Multi WS",
      slug: multiSlug,
    });
    const pA = await seedProject(d1, multiWsId, { name: "Project A" });
    const pB = await seedProject(d1, multiWsId, { name: "Project B" });
    const pC = await seedProject(d1, multiWsId, { name: "Project C" });
    const gA = await seedTaskGroup(d1, pA, { name: "G" });
    await seedTask(d1, pA, gA, { title: "Task in A" });

    const multiRes = await req(app, `/workspaces/${multiWsId}/export`);
    expect(multiRes.status).toBe(200);
    const multiDoc = workspaceExportSchema.parse(JSON.parse(await multiRes.text()));
    expect(multiDoc.projects.map((p) => p.id).sort()).toEqual([pA, pB, pC].sort());
    expect(multiDoc.projects.find((p) => p.id === pA)?.tasks).toHaveLength(1);
  });

  it("returns 404 for a nonexistent workspace", async () => {
    const app = createHandlerApp();
    const res = await req(app, "/workspaces/nonexistent-workspace-id/export");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Secrets never serialize
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — secret redaction", () => {
  it("omits the webhook secret and invitation token from the raw body", async () => {
    const graph = await seedFullGraph();
    const app = createHandlerApp();

    const res = await req(app, `/workspaces/${graph.wsId}/export`);
    expect(res.status).toBe(200);
    const text = await res.text();

    // String-search the RAW body, not just the parsed/validated object —
    // this guards every section, including any future non-strict one.
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(text).not.toContain(graph.invitationToken);

    // The non-secret webhook/invitation fields ARE present (we redact
    // secrets, not the records).
    expect(text).toContain("CI Notifier");
    expect(text).toContain("newcomer@example.com");
  });
});

// ---------------------------------------------------------------------------
// Users ref directory
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — users directory", () => {
  it("resolves every ref, including ex-members who are not in workspace_member", async () => {
    const graph = await seedFullGraph();
    const app = createHandlerApp();

    const res = await req(
      app,
      `/workspaces/${graph.wsId}/export?includeActivity=true`,
    );
    const doc = workspaceExportSchema.parse(JSON.parse(await res.text()));

    const refs = new Set(doc.users.map((u) => u.ref));

    // Current members are present...
    expect(refs.has(TEST_USER.id)).toBe(true);
    expect(refs.has(TEST_USER_2.id)).toBe(true);
    // ...and so is the departed assignee/author/actor, with the portable
    // email key import needs for matching.
    const departed = doc.users.find((u) => u.ref === EX_MEMBER.id);
    expect(departed).toBeDefined();
    expect(departed!.email).toBe(EX_MEMBER.email);
    expect(departed!.name).toBe(EX_MEMBER.name);

    // Every ref used anywhere in the document resolves into the directory.
    const usedRefs: Array<string | null> = [];
    for (const m of doc.members) usedRefs.push(m.userRef);
    for (const t of doc.teams) for (const m of t.members) usedRefs.push(m.userRef);
    for (const p of doc.projects) {
      for (const m of p.members) usedRefs.push(m.userRef);
      for (const t of p.tasks) {
        usedRefs.push(t.assigneeRef, t.completedByRef);
        for (const cm of t.comments) usedRefs.push(cm.authorRef);
        for (const a of t.activity ?? []) usedRefs.push(a.actorRef);
      }
    }
    for (const ref of usedRefs) {
      if (ref !== null) expect(refs.has(ref)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// includeActivity flag
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — includeActivity", () => {
  it("omits activity by default and includes it with ?includeActivity=true", async () => {
    const graph = await seedFullGraph();
    const app = createHandlerApp();

    const defaultRes = await req(app, `/workspaces/${graph.wsId}/export`);
    const defaultDoc = workspaceExportSchema.parse(
      JSON.parse(await defaultRes.text()),
    );
    for (const p of defaultDoc.projects) {
      for (const t of p.tasks) {
        expect(t.activity).toBeUndefined();
      }
    }

    const withRes = await req(
      app,
      `/workspaces/${graph.wsId}/export?includeActivity=true`,
    );
    const withDoc = workspaceExportSchema.parse(JSON.parse(await withRes.text()));
    const allActivity = withDoc.projects.flatMap((p) =>
      p.tasks.flatMap((t) => t.activity ?? []),
    );
    expect(allActivity.length).toBe(2);
  });

  it("accepts includeActivity=1 as the opt-in form", async () => {
    const graph = await seedFullGraph();
    const app = createHandlerApp();

    const res = await req(app, `/workspaces/${graph.wsId}/export?includeActivity=1`);
    const doc = workspaceExportSchema.parse(JSON.parse(await res.text()));
    const allActivity = doc.projects.flatMap((p) =>
      p.tasks.flatMap((t) => t.activity ?? []),
    );
    expect(allActivity.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — headers", () => {
  it("sets Content-Type and a dated attachment Content-Disposition", async () => {
    const graph = await seedFullGraph();
    const app = createHandlerApp();

    const res = await req(app, `/workspaces/${graph.wsId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const today = new Date().toISOString().slice(0, 10);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${graph.slug}-export-${today}.json"`,
    );
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — authorization", () => {
  it("returns 401 when unauthenticated", async () => {
    const graph = await seedFullGraph();
    const app = createGuardedApp();

    const res = await req(app, `/workspaces/${graph.wsId}/export`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a plain member (owner/admin only)", async () => {
    const graph = await seedFullGraph();
    // TEST_USER_2 was seeded as role "member" — full data egress is
    // reserved for owner/admin by design.
    const app = createGuardedApp(TEST_USER_2);

    const res = await req(app, `/workspaces/${graph.wsId}/export`);
    expect(res.status).toBe(403);
  });

  it("allows the owner through the real middleware stack", async () => {
    const graph = await seedFullGraph();
    const app = createGuardedApp(TEST_USER);

    const res = await req(app, `/workspaces/${graph.wsId}/export`);
    expect(res.status).toBe(200);
    workspaceExportSchema.parse(JSON.parse(await res.text()));
  });
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — audit", () => {
  it("writes an audit_log row with action 'export' and null apiTokenId for cookie auth", async () => {
    const graph = await seedFullGraph();
    const app = createHandlerApp();

    const res = await req(
      app,
      `/workspaces/${graph.wsId}/export?includeActivity=true`,
    );
    expect(res.status).toBe(200);
    await res.text();

    const row = await waitForAuditRow(graph.wsId);
    expect(row).not.toBeNull();
    expect(row!.action).toBe("export");
    expect(row!.actorUserId).toBe(TEST_USER.id);
    expect(row!.apiTokenId).toBeNull();
    expect(row!.resourceType).toBe("workspace");
    expect(row!.resourceId).toBe(graph.wsId);
    expect(row!.status).toBe(200);

    const metadata = z
      .object({
        includeActivity: z.boolean(),
        projects: z.number(),
        tasks: z.number(),
      })
      .parse(JSON.parse(String(row!.metadata)));
    expect(metadata.includeActivity).toBe(true);
    expect(metadata.projects).toBe(1);
    expect(metadata.tasks).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/export — rate limit", () => {
  it("enforces the 5/hour export quota (same config as the route wiring)", async () => {
    // Mounts the exact limiter configuration registered in
    // workspaces.routes.ts (max 5 / 3600 s / defaultRateLimitKey) in front
    // of the handler — the invitations.handlers.test.ts precedent for
    // asserting limiter behavior without a route-file harness.
    const graph = await seedFullGraph();
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, TEST_USER));
    app.get(
      "/workspaces/:workspaceId/export",
      rateLimit({
        max: 5,
        windowSeconds: 3600,
        prefix: "workspace-export-test",
        keyFn: defaultRateLimitKey,
      }),
      exportWorkspace,
    );

    for (let i = 0; i < 5; i++) {
      const res = await req(app, `/workspaces/${graph.wsId}/export`);
      expect(res.status).toBe(200);
      await res.text();
    }

    const blocked = await req(app, `/workspaces/${graph.wsId}/export`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
  });
});
