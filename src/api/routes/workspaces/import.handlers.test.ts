/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the workspace import endpoint.
 *
 * Real in-memory D1 (Miniflare) + bare Hono, following the
 * export.handlers.test.ts pattern: handler-only apps for behavior tests,
 * and the REAL middleware stack where the policy itself is under test
 * (401/403, rate limit). The deep pipeline mechanics (chunk math, repair
 * pass, rollback ordering) are covered by the parse/executor/trello unit
 * suites — these tests pin the HTTP-shaped decisions:
 *
 * - **Dry run writes NOTHING and is NOT audited.** The stateless-preview
 *   design (plan decision 5) only holds if a preview is observably free of
 *   side effects — asserted against actual DB row counts, not the handler's
 *   word. The audit boundary (commit-only) is pinned here because it is a
 *   policy decision documented in import.handlers.ts: the ledger records
 *   mutations, and a preview mutates nothing.
 *
 * - **The status-code contract** (413 for oversized, 400 with the parser's
 *   verbatim `errors` lines for everything malformed) is what the UI's
 *   error pane is built against.
 *
 * - **Commit produces a live, FK-valid graph with remapped ids** — the
 *   collision-free-by-construction claim, checked by joining the imported
 *   rows back together in SQL rather than trusting the response counts.
 *
 * - **Trello end-to-end through the endpoint** proves the sniff → convert →
 *   validate → execute dispatch is actually wired (each stage is unit-tested
 *   in isolation; this is the only place the composition runs for real).
 *
 * - **The compensating-delete smoke test** exercises one constraint failure
 *   through the HTTP layer (executor tests cover the rollback deeply) so a
 *   future handler refactor cannot silently bypass the per-project
 *   all-or-nothing semantics.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MAX_IMPORT_FILE_BYTES,
  type WorkspaceExport,
} from "../../../shared/schemas/workspace-export";
import {
  importPreviewSchema,
  importResultSchema,
} from "../../../shared/schemas/workspace-import";
import type { AppEnv } from "../../env";
import { requireWorkspaceRole } from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import {
  createTestD1,
  fakeAuth,
  fakeEnv,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import { importWorkspaceData } from "./import.handlers";
import {
  makeExportFile,
  makeGroup,
  makeLabel,
  makeProject,
  makeSubtask,
  makeTask,
  makeUser,
  nextPos,
} from "./import/test-fixtures";

let d1: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Request/app helpers
// ---------------------------------------------------------------------------

/** See workspaces.handlers.test.ts — injects an env object so fakeAuth can
 *  attach the D1 binding when Hono's test request has no env. */
async function req(app: Hono<AppEnv>, input: string | Request): Promise<Response> {
  return await app.request(input, undefined, {});
}

/** Handler-only app (auth middleware bypassed) for behavior tests. */
function createHandlerApp(user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER) {
  const app = new Hono<AppEnv>();
  app.use("/*", fakeAuth(d1, user));
  app.post("/workspaces/:workspaceId/import", importWorkspaceData);
  return app;
}

/** Route-shaped app with the REAL auth/role middleware stack (membership
 *  resolved against D1) for the 401/403 authorization tests. */
function createGuardedApp(user?: typeof TEST_USER | typeof TEST_USER_2) {
  const app = new Hono<AppEnv>();
  app.use("/*", user ? fakeAuth(d1, user) : fakeEnv(d1));
  app.post(
    "/workspaces/:workspaceId/import",
    requireAuth,
    requireWorkspaceRole("owner", "admin"),
    importWorkspaceData,
  );
  return app;
}

/** Multipart upload request — the uploads/attachments test precedent. */
function uploadRequest(
  url: string,
  // `Uint8Array<ArrayBuffer>` (not the default `ArrayBufferLike` generic):
  // BlobPart rejects SharedArrayBuffer-backed views, and every caller here
  // constructs a plain ArrayBuffer-backed array — narrowing the param keeps
  // File construction typed without a cast.
  content: string | Uint8Array<ArrayBuffer> | object,
  filename = "export.json",
): Request {
  const payload =
    typeof content === "string" || content instanceof Uint8Array
      ? content
      : JSON.stringify(content);
  const formData = new FormData();
  formData.append("file", new File([payload], filename, { type: "application/json" }));
  return new Request(`http://localhost${url}`, { method: "POST", body: formData });
}

async function seedTargetWorkspace(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = await seedWorkspace(d1, TEST_USER.id, {
    name: "Import Target",
    slug: `import-ws-${suffix}`,
  });
  await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");
  return wsId;
}

// ---------------------------------------------------------------------------
// DB inspection helpers — preview claims are verified against actual rows
// ---------------------------------------------------------------------------

async function countOne(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await d1
    .prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Full content row counts for a workspace — the zero-writes assertion. */
async function contentCounts(wsId: string) {
  const inProjects = "(SELECT id FROM project WHERE workspaceId = ?)";
  const inTasks = `(SELECT id FROM task WHERE projectId IN ${inProjects})`;
  return {
    projects: await countOne(
      "SELECT COUNT(*) AS n FROM project WHERE workspaceId = ?",
      wsId,
    ),
    taskGroups: await countOne(
      `SELECT COUNT(*) AS n FROM task_group WHERE projectId IN ${inProjects}`,
      wsId,
    ),
    labels: await countOne(
      `SELECT COUNT(*) AS n FROM label WHERE projectId IN ${inProjects}`,
      wsId,
    ),
    tasks: await countOne(
      `SELECT COUNT(*) AS n FROM task WHERE projectId IN ${inProjects}`,
      wsId,
    ),
    subtasks: await countOne(
      `SELECT COUNT(*) AS n FROM subtask WHERE taskId IN ${inTasks}`,
      wsId,
    ),
    comments: await countOne(
      `SELECT COUNT(*) AS n FROM comment WHERE taskId IN ${inTasks}`,
      wsId,
    ),
  };
}

const ZERO_CONTENT = {
  projects: 0,
  taskGroups: 0,
  labels: 0,
  tasks: 0,
  subtasks: 0,
  comments: 0,
};

/** Poll for the deferred audit insert (deferWork runs inline but unawaited
 *  in the test env — same rationale as export.handlers.test.ts). */
async function waitForImportAuditRow(
  workspaceId: string,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const row = await d1
      .prepare("SELECT * FROM audit_log WHERE workspaceId = ? AND action = 'import'")
      .bind(workspaceId)
      .first();
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

async function countImportAuditRows(workspaceId: string): Promise<number> {
  return countOne(
    "SELECT COUNT(*) AS n FROM audit_log WHERE workspaceId = ? AND action = 'import'",
    workspaceId,
  );
}

/** Shape of every parse-failure response: errorResponse's `error` plus the
 *  parser's verbatim `errors` lines (the contract the UI error pane uses). */
const errorBodySchema = z.object({ error: z.string(), errors: z.array(z.string()) });

// ---------------------------------------------------------------------------
// Fixture: a Cadence export exercising counts, skips, matching and links
// ---------------------------------------------------------------------------

/**
 * One project, 2 groups (incl. completion), 1 label, 2 tasks (one with a
 * subtask, comment, label link, attachment manifest and activity rows),
 * envelope-level webhook/team/invitation sections, and a users directory
 * with one matchable email and one ghost. Built fresh per test — fixture
 * ids come from a module counter, and sharing documents across tests would
 * couple their assertions.
 */
function makeRichExportFile(): WorkspaceExport {
  const groupTodo = makeGroup({ name: "To Do" });
  const groupDone = makeGroup({ name: "Done", isCompletionGroup: true });
  const labelBug = makeLabel({ name: "bug", color: "#ff0000" });

  const taskAssigned = makeTask(groupTodo.id, {
    title: "Assigned to a matchable member",
    assigneeRef: "ref-member",
    labelIds: [labelBug.id],
    subtasks: [makeSubtask({ title: "One subtask" })],
    comments: [
      {
        body: "Comment by the ghost",
        authorRef: "ref-ghost",
        createdAt: "2026-02-01T10:00:00.000Z",
        updatedAt: "2026-02-01T10:00:00.000Z",
      },
    ],
    attachments: [
      {
        filename: "spec.pdf",
        mimeType: "application/pdf",
        size: 1234,
        key: "task-attachment/u/spec.pdf",
        url: "/api/uploads/task-attachment/u/spec.pdf",
      },
    ],
    activity: [
      {
        actorRef: null,
        action: "created",
        field: null,
        oldValue: null,
        newValue: null,
        createdAt: "2026-02-01T09:00:00.000Z",
      },
      {
        actorRef: "ref-ghost",
        action: "updated",
        field: "title",
        oldValue: "Old",
        newValue: "New",
        createdAt: "2026-02-01T09:30:00.000Z",
      },
    ],
  });
  const taskGhost = makeTask(groupDone.id, {
    title: "Assigned to a ghost",
    assigneeRef: "ref-ghost",
  });

  return makeExportFile({
    users: [
      makeUser("ref-member", TEST_USER_2.email, TEST_USER_2.name),
      makeUser("ref-ghost", "ghost@example.com", "Ghost User"),
    ],
    teams: [{ name: "Core Team", description: null, members: [] }],
    webhooks: [
      {
        name: "CI Notifier",
        url: "https://example.com/hooks/ci",
        events: ["task.created"],
        active: true,
        projectId: null,
      },
    ],
    invitations: [{ email: "newcomer@example.com", role: "member", status: "pending" }],
    projects: [
      makeProject({
        name: "Imported Alpha",
        taskGroups: [groupTodo, groupDone],
        labels: [labelBug],
        tasks: [taskAssigned, taskGhost],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Dry run: full preview, zero writes, no audit row
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/import?dryRun=true", () => {
  it("returns the preview report and writes ZERO rows and NO audit entry", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import?dryRun=true`, makeRichExportFile()),
    );
    expect(res.status).toBe(200);
    const body = importPreviewSchema.parse(await res.json());

    expect(body.dryRun).toBe(true);
    expect(body.sourceFormat).toBe("cadence");
    expect(body.counts).toEqual({
      projects: 1,
      taskGroups: 2,
      tasks: 2,
      labels: 1,
      subtasks: 1,
      comments: 1,
    });
    // The honest-cuts ledger: envelope-only sections + doc-carried
    // attachments/activity, all reported instead of silently dropped.
    expect(body.skipped).toEqual({
      webhooks: 1,
      teams: 1,
      invitations: 1,
      attachments: 1,
      activity: 2,
      closedItems: 0,
    });
    // The ghost references two distinct tasks (comment on one, assignee on
    // the other) — the count a human needs for "invite first or proceed?".
    expect(body.unmatchedUsers).toEqual([
      { email: "ghost@example.com", name: "Ghost User", taskCount: 2 },
    ]);

    // THE stateless-dry-run guarantee: observably zero writes.
    expect(await contentCounts(wsId)).toEqual(ZERO_CONTENT);

    // And no audit row — previews are reads, the ledger records mutations
    // (decision documented in import.handlers.ts). The deferred-work window
    // is generous so a regression cannot hide behind timing.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await countImportAuditRows(wsId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Commit: full graph with remapped ids and valid FKs, plus the audit row
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/import — commit", () => {
  it("creates the full graph with remapped ids, valid FKs and remapped recurrence links", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    // Recurrence pair: child references the parent inside the file. The ids
    // must be remapped TOGETHER or the link silently re-attaches to nothing.
    const group = makeGroup({ name: "Recurring" });
    const parent = makeTask(group.id, {
      title: "Recurring parent",
      recurrenceRule: { frequency: "weekly", interval: 1, daysOfWeek: [1] },
      recurrenceSeriesId: "src-series-1",
    });
    const child = makeTask(group.id, {
      title: "Recurring child",
      recurrenceParentId: parent.id,
      recurrenceSeriesId: "src-series-1",
    });
    const file = makeRichExportFile();
    file.projects.push(
      makeProject({ name: "Recurrence Project", taskGroups: [group], tasks: [parent, child] }),
    );

    const res = await req(app, uploadRequest(`/workspaces/${wsId}/import`, file));
    expect(res.status).toBe(200);
    const body = importResultSchema.parse(await res.json());

    expect(body.dryRun).toBe(false);
    expect(body.sourceFormat).toBe("cadence");
    expect(body.failedProjects).toEqual([]);
    expect(body.counts).toEqual({
      projects: 2,
      taskGroups: 3,
      tasks: 4,
      labels: 1,
      subtasks: 1,
      comments: 1,
    });
    expect(await contentCounts(wsId)).toEqual({
      projects: 2,
      taskGroups: 3,
      labels: 1,
      tasks: 4,
      subtasks: 1,
      comments: 1,
    });

    // Remapped ids: every created id is a fresh UUID, never the source id
    // (source ids here are "src-*" fixture strings, so leakage is obvious).
    const projects = (
      await d1
        .prepare("SELECT id, name FROM project WHERE workspaceId = ?")
        .bind(wsId)
        .all<{ id: string; name: string }>()
    ).results;
    for (const p of projects) {
      expect(p.id).not.toMatch(/^src-/);
    }

    // FK validity, asserted by joining the graph back together: zero
    // orphans means every remap table was applied consistently.
    const inProjects = "(SELECT id FROM project WHERE workspaceId = ?)";
    expect(
      await countOne(
        `SELECT COUNT(*) AS n FROM task WHERE projectId IN ${inProjects} AND taskGroupId NOT IN (SELECT id FROM task_group WHERE projectId IN ${inProjects})`,
        wsId,
        wsId,
      ),
    ).toBe(0);
    expect(
      await countOne(
        `SELECT COUNT(*) AS n FROM task_label WHERE taskId IN (SELECT id FROM task WHERE projectId IN ${inProjects}) AND labelId NOT IN (SELECT id FROM label WHERE projectId IN ${inProjects})`,
        wsId,
        wsId,
      ),
    ).toBe(0);

    // Recurrence links: child points at the parent's NEW id; the shared
    // series id is one fresh UUID, not the source value.
    const parentRow = await d1
      .prepare("SELECT id, recurrence_series_id AS seriesId FROM task WHERE title = ?")
      .bind("Recurring parent")
      .first<{ id: string; seriesId: string }>();
    const childRow = await d1
      .prepare(
        "SELECT recurrence_parent_id AS parentId, recurrence_series_id AS seriesId FROM task WHERE title = ?",
      )
      .bind("Recurring child")
      .first<{ parentId: string; seriesId: string }>();
    expect(childRow!.parentId).toBe(parentRow!.id);
    expect(childRow!.seriesId).toBe(parentRow!.seriesId);
    expect(childRow!.seriesId).not.toBe("src-series-1");

    // The importer is always each imported project's admin — every project
    // must end up with a member who can manage it.
    expect(
      await countOne(
        `SELECT COUNT(*) AS n FROM project_member WHERE projectId IN ${inProjects} AND userId = ? AND role = 'admin'`,
        wsId,
        TEST_USER.id,
      ),
    ).toBe(2);

    // The ingress IS audited (commit only — the dry-run test pins the
    // other half of the boundary), with what-actually-happened metadata.
    const audit = await waitForImportAuditRow(wsId);
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBe(TEST_USER.id);
    expect(audit!.apiTokenId).toBeNull();
    expect(audit!.resourceType).toBe("workspace");
    const metadata = JSON.parse(String(audit!.metadata)) as Record<string, unknown>;
    expect(metadata.sourceFormat).toBe("cadence");
    expect(metadata.projects).toBe(2);
    expect(metadata.tasks).toBe(4);
    expect(metadata.failedProjects).toBe(0);
  });

  it("assigns email-matched users and nulls + reports unmatched ones", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import`, makeRichExportFile()),
    );
    expect(res.status).toBe(200);
    const body = importResultSchema.parse(await res.json());

    // Matched by email (member of the target workspace) → assigned.
    const matched = await d1
      .prepare("SELECT assigneeId FROM task WHERE title = ?")
      .bind("Assigned to a matchable member")
      .first<{ assigneeId: string | null }>();
    expect(matched!.assigneeId).toBe(TEST_USER_2.id);

    // No member with that email → null, never a cross-workspace guess...
    const ghosted = await d1
      .prepare("SELECT assigneeId FROM task WHERE title = ?")
      .bind("Assigned to a ghost")
      .first<{ assigneeId: string | null }>();
    expect(ghosted!.assigneeId).toBeNull();
    const ghostComment = await d1
      .prepare("SELECT authorId FROM comment WHERE body = ?")
      .bind("Comment by the ghost")
      .first<{ authorId: string | null }>();
    expect(ghostComment!.authorId).toBeNull();

    // ...and the loss is REPORTED, not silent.
    expect(body.unmatchedUsers).toEqual([
      { email: "ghost@example.com", name: "Ghost User", taskCount: 2 },
    ]);
  });

  it("rolls back a failing project (compensating delete) while importing the others", async () => {
    // Deep rollback coverage lives in executor.test.ts — this is the HTTP
    // smoke proving the semantics survive the endpoint composition. Two
    // tasks share one (taskGroupId, position) pair: Zod-valid, but the
    // UNIQUE index fires in write phase 2, AFTER the project row committed.
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const goodGroup = makeGroup({ name: "Good Group" });
    const badGroup = makeGroup({ name: "Bad Group" });
    const dupPos = nextPos();
    const file = makeExportFile({
      projects: [
        makeProject({
          name: "Good Project",
          taskGroups: [goodGroup],
          tasks: [makeTask(goodGroup.id, { title: "Survives" })],
        }),
        makeProject({
          name: "Bad Project",
          taskGroups: [badGroup],
          tasks: [
            makeTask(badGroup.id, { title: "Dup A", position: dupPos }),
            makeTask(badGroup.id, { title: "Dup B", position: dupPos }),
          ],
        }),
      ],
    });

    const res = await req(app, uploadRequest(`/workspaces/${wsId}/import`, file));
    expect(res.status).toBe(200);
    const body = importResultSchema.parse(await res.json());

    expect(body.failedProjects).toHaveLength(1);
    expect(body.failedProjects[0].name).toBe("Bad Project");
    expect(body.counts.projects).toBe(1);

    // The failed project's graph is fully gone; the good one is intact.
    expect(
      await countOne(
        "SELECT COUNT(*) AS n FROM project WHERE workspaceId = ? AND name = 'Bad Project'",
        wsId,
      ),
    ).toBe(0);
    expect(
      await countOne(
        "SELECT COUNT(*) AS n FROM project WHERE workspaceId = ? AND name = 'Good Project'",
        wsId,
      ),
    ).toBe(1);
    expect(await countOne("SELECT COUNT(*) AS n FROM task WHERE title = 'Dup A'")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Trello end-to-end through the endpoint (sniff → convert → import)
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/import — Trello file", () => {
  it("imports a Trello board: groups from lists, tasks, labels, subtasks; closed items skipped", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const board = {
      id: "brd000000000000000000001",
      name: "Migration Board",
      desc: "Moved from Trello",
      labels: [
        { id: "lbl-1", name: "Urgent", color: "red" },
        { id: "lbl-2", name: "Later", color: "green" },
      ],
      lists: [
        { id: "list-open", name: "Doing", closed: false, pos: 1 },
        { id: "list-closed", name: "Old", closed: true, pos: 2 },
      ],
      cards: [
        {
          id: "card-1",
          name: "Ship the migration",
          desc: "Card description",
          closed: false,
          idList: "list-open",
          due: "2026-07-01T12:00:00.000Z",
          dueComplete: false,
          idLabels: ["lbl-1", "lbl-2"],
          pos: 1,
        },
        { id: "card-2", name: "Second card", closed: false, idList: "list-open", pos: 2 },
        { id: "card-archived", name: "Archived card", closed: true, idList: "list-open" },
      ],
      checklists: [
        {
          id: "chk-1",
          idCard: "card-1",
          name: "Steps",
          checkItems: [
            { id: "ci-1", name: "Step one", state: "complete", pos: 1 },
            { id: "ci-2", name: "Step two", state: "incomplete", pos: 2 },
          ],
        },
      ],
      actions: [
        {
          id: "act-1",
          type: "commentCard",
          date: "2026-03-01T10:00:00.000Z",
          data: { text: "Looks good to me", card: { id: "card-1" } },
          memberCreator: { fullName: "Alice Trello", username: "alice" },
        },
      ],
      members: [{ id: "mem-1", fullName: "Alice Trello", username: "alice" }],
    };

    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import`, board, "board.json"),
    );
    expect(res.status).toBe(200);
    const body = importResultSchema.parse(await res.json());

    expect(body.sourceFormat).toBe("trello");
    expect(body.failedProjects).toEqual([]);
    // Archived list + archived card, reported — never silently resurrected.
    expect(body.skipped.closedItems).toBe(2);
    expect(body.counts).toMatchObject({ projects: 1, taskGroups: 1, tasks: 2, labels: 2 });

    // Landed graph: board → project, open list → group, open cards → tasks.
    const project = await d1
      .prepare("SELECT id, description FROM project WHERE workspaceId = ? AND name = ?")
      .bind(wsId, "Migration Board")
      .first<{ id: string; description: string | null }>();
    expect(project).not.toBeNull();
    expect(project!.description).toBe("Moved from Trello");

    const groups = (
      await d1
        .prepare("SELECT name FROM task_group WHERE projectId = ?")
        .bind(project!.id)
        .all<{ name: string }>()
    ).results;
    expect(groups.map((g) => g.name)).toEqual(["Doing"]);

    const tasks = (
      await d1
        .prepare("SELECT id, title, dueDate, completed FROM task WHERE projectId = ? ORDER BY position")
        .bind(project!.id)
        .all<{ id: string; title: string; dueDate: number | null; completed: number }>()
    ).results;
    expect(tasks.map((t) => t.title)).toEqual(["Ship the migration", "Second card"]);
    expect(tasks[0].dueDate).not.toBeNull();

    const labels = (
      await d1
        .prepare("SELECT name FROM label WHERE projectId = ? ORDER BY name")
        .bind(project!.id)
        .all<{ name: string }>()
    ).results;
    expect(labels.map((l) => l.name)).toEqual(["Later", "Urgent"]);
    expect(
      await countOne(
        "SELECT COUNT(*) AS n FROM task_label WHERE taskId = ?",
        tasks[0].id,
      ),
    ).toBe(2);

    // Checklist items → subtasks (state mapped to completed).
    const subtasks = (
      await d1
        .prepare("SELECT title, completed FROM subtask WHERE taskId = ? ORDER BY position")
        .bind(tasks[0].id)
        .all<{ title: string; completed: number }>()
    ).results;
    expect(subtasks.map((s) => s.title)).toEqual(["Step one", "Step two"]);
    expect(subtasks.map((s) => s.completed)).toEqual([1, 0]);

    // Trello comment → Cadence comment with authorship preserved in the
    // body (Trello exports carry no emails, so authorRef cannot resolve).
    const trelloComment = await d1
      .prepare("SELECT body, authorId FROM comment WHERE taskId = ?")
      .bind(tasks[0].id)
      .first<{ body: string; authorId: string | null }>();
    expect(trelloComment).not.toBeNull();
    expect(trelloComment!.body).toContain("Looks good to me");
    expect(trelloComment!.body).toContain("Alice Trello");
    expect(trelloComment!.authorId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Upload validation: the status-code contract
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/import — invalid uploads", () => {
  it("returns 413 for a file over MAX_IMPORT_FILE_BYTES, before any JSON parsing", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    // Deliberately NOT valid JSON: a 413 here proves the byte guard runs
    // first (a parse attempt on this would return 400 instead).
    const oversized = new Uint8Array(MAX_IMPORT_FILE_BYTES + 1);
    const res = await req(app, uploadRequest(`/workspaces/${wsId}/import`, oversized));
    expect(res.status).toBe(413);
    const body = errorBodySchema.parse(await res.json());
    expect(body.errors[0]).toContain("20 MB");
    expect(await contentCounts(wsId)).toEqual(ZERO_CONTENT);
  });

  it("returns 400 with a friendly message for malformed JSON", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const res = await req(app, uploadRequest(`/workspaces/${wsId}/import`, "{not json"));
    expect(res.status).toBe(400);
    const body = errorBodySchema.parse(await res.json());
    expect(body.errors[0]).toContain("not valid JSON");
  });

  it("returns 400 for valid JSON in an unsupported format", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import`, { hello: "world" }),
    );
    expect(res.status).toBe(400);
    const body = errorBodySchema.parse(await res.json());
    expect(body.errors[0]).toContain("Unsupported file format");
  });

  it("returns 400 with located messages for a Cadence file that fails schema validation", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const group = makeGroup();
    const file = makeExportFile({
      projects: [
        makeProject({
          taskGroups: [group],
          // Empty title violates the contract (min 1) — the error must NAME
          // the offending path so a user can find it in a large file.
          tasks: [makeTask(group.id, { title: "" })],
        }),
      ],
    });

    const res = await req(app, uploadRequest(`/workspaces/${wsId}/import`, file));
    expect(res.status).toBe(400);
    const body = errorBodySchema.parse(await res.json());
    expect(body.errors.some((e) => e.includes("title"))).toBe(true);
    expect(await contentCounts(wsId)).toEqual(ZERO_CONTENT);
  });

  it("returns 400 when the file field is missing or not a file", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    // Multipart body with no "file" field at all.
    const emptyForm = new FormData();
    emptyForm.append("note", "no file here");
    const missing = await req(
      app,
      new Request(`http://localhost/workspaces/${wsId}/import`, {
        method: "POST",
        body: emptyForm,
      }),
    );
    expect(missing.status).toBe(400);

    // "file" present but as a plain string field, not an uploaded File.
    const stringForm = new FormData();
    stringForm.append("file", JSON.stringify(makeExportFile()));
    const stringField = await req(
      app,
      new Request(`http://localhost/workspaces/${wsId}/import`, {
        method: "POST",
        body: stringForm,
      }),
    );
    expect(stringField.status).toBe(400);

    // Raw JSON body (not multipart at all) — parseBody throws; mapped to 400.
    const rawJson = await req(
      app,
      new Request(`http://localhost/workspaces/${wsId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeExportFile()),
      }),
    );
    expect(rawJson.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/import — authorization", () => {
  it("returns 401 when unauthenticated", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createGuardedApp();

    const res = await req(app, uploadRequest(`/workspaces/${wsId}/import`, makeExportFile()));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a plain member (owner/admin only) and writes nothing", async () => {
    const wsId = await seedTargetWorkspace();
    // TEST_USER_2 is seeded as role "member" — workspace-wide ingress is
    // reserved for owner/admin, exactly like export's egress.
    const app = createGuardedApp(TEST_USER_2);

    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import`, makeRichExportFile()),
    );
    expect(res.status).toBe(403);
    expect(await contentCounts(wsId)).toEqual(ZERO_CONTENT);
  });

  it("allows the owner through the real middleware stack", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createGuardedApp(TEST_USER);

    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import?dryRun=true`, makeExportFile()),
    );
    expect(res.status).toBe(200);
    importPreviewSchema.parse(await res.json());
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/import — rate limit", () => {
  it("enforces the 10/hour import quota (same config as the route wiring)", async () => {
    // Mounts the exact limiter configuration registered in
    // workspaces.routes.ts (max 10 / 3600 s / defaultRateLimitKey) — the
    // export.handlers.test.ts precedent for pinning limiter behavior.
    const wsId = await seedTargetWorkspace();
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, TEST_USER));
    app.post(
      "/workspaces/:workspaceId/import",
      rateLimit({
        max: 10,
        windowSeconds: 3600,
        prefix: "workspace-import-test",
        keyFn: defaultRateLimitKey,
      }),
      importWorkspaceData,
    );

    for (let i = 0; i < 10; i++) {
      const res = await req(
        app,
        uploadRequest(`/workspaces/${wsId}/import?dryRun=true`, makeExportFile()),
      );
      expect(res.status).toBe(200);
    }

    const blocked = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import?dryRun=true`, makeExportFile()),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Subrequest-budget warning (plan risk: Workers Free caps 50 subrequests per
// invocation; each project costs ~5-20 — >40 projects risks a partial import
// on Free-plan self-hosts, so the preview must warn BEFORE any write).
// ---------------------------------------------------------------------------

describe("POST /workspaces/:workspaceId/import — subrequest-budget warning", () => {
  it("warns on >40-project files in the dry-run preview", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const projects = Array.from({ length: 41 }, (_, i) =>
      makeProject({ name: `Bulk project ${i + 1}` }),
    );
    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import?dryRun=true`, makeExportFile({ projects })),
    );
    expect(res.status).toBe(200);
    const body = importPreviewSchema.parse(await res.json());
    expect(body.counts.projects).toBe(41);
    expect(
      body.warnings.some((w) => w.includes("more than 40 projects")),
    ).toBe(true);
  });

  it("does not warn at or below the 40-project threshold", async () => {
    const wsId = await seedTargetWorkspace();
    const app = createHandlerApp();

    const projects = Array.from({ length: 2 }, (_, i) =>
      makeProject({ name: `Small project ${i + 1}` }),
    );
    const res = await req(
      app,
      uploadRequest(`/workspaces/${wsId}/import?dryRun=true`, makeExportFile({ projects })),
    );
    expect(res.status).toBe(200);
    const body = importPreviewSchema.parse(await res.json());
    expect(body.warnings.some((w) => w.includes("subrequest"))).toBe(false);
  });
});
