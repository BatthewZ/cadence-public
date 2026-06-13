/// <reference types="@cloudflare/workers-types" />
/**
 * THE ROUND-TRIP PROPERTY TEST — "your data is never held hostage" as CI.
 *
 * Property: for a workspace exercising EVERY exportable field, exporting it
 * (real endpoint, full streamed body), importing the file into a second
 * workspace (real endpoint, multipart commit), and exporting THAT workspace
 * yields the same `projects` content subtree — after a principled
 * normalization that strips ONLY what the format documents as
 * non-portable, with each exclusion justified in {@link normalizeProjects}.
 *
 * Why this test must never be stubbed, skipped or weakened: the export
 * schema, the import parser and the executor are three separately-authored
 * modules sharing one contract. Any field that one of them silently drops
 * (a new task column missing from a builder, a remap table not applied, a
 * timestamp regenerated instead of preserved) produces no error anywhere —
 * the data just quietly stops surviving the trip. This test is the only
 * place the WHOLE pipeline runs end to end, so it is the only signal for
 * that failure class. Contract drift becomes a red diff here, not silent
 * loss in someone's archive.
 *
 * The documented non-round-trip items are asserted to be REPORTED, not
 * silent: attachments (binary, manifest-only), activity (archival, never
 * replayed), webhooks/teams/invitations (workspace config, content-scoped
 * import), uploaded cover images (warning), and references to users who
 * are not members of the target workspace (unmatchedUsers).
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  ExportedProject,
  ExportedTask,
  WorkspaceExport,
} from "../../../shared/schemas/workspace-export";
import { workspaceExportSchema } from "../../../shared/schemas/workspace-export";
import { importResultSchema } from "../../../shared/schemas/workspace-import";
import type { AppEnv } from "../../env";
import {
  createTestD1,
  fakeAuth,
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
import { importWorkspaceData } from "./import.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;

/** Referenced by content (assignee/completedBy/comment author/activity
 *  actor) but a member of NEITHER workspace: the one user class whose
 *  references documentedly do NOT survive the trip (member-only matching). */
const EX_MEMBER = {
  id: "roundtrip-ex-member-id",
  name: "Departed Colleague",
  email: "departed-roundtrip@example.com",
};

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

// ---------------------------------------------------------------------------
// App/request helpers (export + import mounted on one handler-only app)
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono<AppEnv>();
  app.use("/*", fakeAuth(d1, TEST_USER));
  app.get("/workspaces/:workspaceId/export", exportWorkspace);
  app.post("/workspaces/:workspaceId/import", importWorkspaceData);
  return app;
}

async function req(app: Hono<AppEnv>, input: string | Request): Promise<Response> {
  return await app.request(input, undefined, {});
}

/** Export through the real endpoint and reassemble the FULL streamed body —
 *  the round trip must hold for the document clients actually download. */
async function exportDocument(app: Hono<AppEnv>, wsId: string): Promise<WorkspaceExport> {
  const res = await req(app, `/workspaces/${wsId}/export?includeActivity=true`);
  expect(res.status).toBe(200);
  return workspaceExportSchema.parse(JSON.parse(await res.text()));
}

function uploadRequest(url: string, doc: WorkspaceExport): Request {
  const formData = new FormData();
  formData.append(
    "file",
    new File([JSON.stringify(doc)], "export.json", { type: "application/json" }),
  );
  return new Request(`http://localhost${url}`, { method: "POST", body: formData });
}

function toSec(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

// ---------------------------------------------------------------------------
// Seed: workspace A — every exportable field exercised
// ---------------------------------------------------------------------------

/**
 * Builds the richest graph the format can carry:
 *
 * - 2 projects (statuses active/archived; theme, budget, icons, Unsplash
 *   cover, autoAssignCreator, descriptions; one uploaded project cover)
 * - groups incl. a completion group and a colored group
 * - 2 labels with task-label links
 * - tasks covering: start+due date span, sourceUid (ICS provenance),
 *   recurrenceRule + a parent/child instance pair sharing a series id,
 *   cost, coverUnsplash, every priority in use, completed with
 *   completedAt+completedBy, an uploaded task cover
 * - subtasks (mixed completion), comments (member + ex-member authors),
 *   an attachment manifest entry, activity rows
 * - workspace-level team/webhook/invitation (for the skip ledger)
 */
async function seedWorkspaceA(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = await seedWorkspace(d1, TEST_USER.id, {
    name: "Roundtrip Source",
    slug: `roundtrip-a-${suffix}`,
  });
  await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

  const teamId = await seedTeam(d1, wsId, { name: "Core Team" });
  await seedTeamMember(d1, teamId, TEST_USER.id, "lead");
  await seedWebhook(d1, wsId, { name: "CI Notifier" });
  await seedInvitation(d1, wsId, {
    email: "newcomer@example.com",
    token: `roundtrip-token-${suffix}`,
  });

  // --- Project 1: Alpha — the kitchen sink -------------------------------
  const p1 = await seedProject(d1, wsId, {
    name: "Alpha Project",
    description: "Primary project under round-trip test",
    icon: "rocket",
    theme: "sunset",
    budget: 500_000,
    coverUnsplash: sampleUnsplashPayload("alpha-project-cover"),
  });
  await d1
    .prepare("UPDATE project SET auto_assign_creator = 1 WHERE id = ?")
    .bind(p1)
    .run();
  // The importer must already be admin in the SOURCE too: import forces the
  // importing user to admin, so seeding anything else would assert a
  // documented divergence rather than the round trip.
  await seedProjectMember(d1, p1, TEST_USER.id, "admin");
  await seedProjectMember(d1, p1, TEST_USER_2.id, "viewer");

  const backlog = await seedTaskGroup(d1, p1, { name: "Backlog" });
  await d1.prepare("UPDATE task_group SET color = ? WHERE id = ?").bind("#aabbcc", backlog).run();
  const done = await seedTaskGroup(d1, p1, { name: "Done", isCompletionGroup: true });

  const labelBug = await seedLabel(d1, p1, "bug", "#ff0000");
  const labelFeature = await seedLabel(d1, p1, "feature", "#22c55e");

  // Task 1: date span, cost, icon, Unsplash cover, sourceUid, labels,
  // subtasks, comments (member + ex-member), attachment, activity.
  const rangeTask = await seedTask(d1, p1, backlog, {
    title: "Range task",
    description: "Has a start/due range and everything else",
    assigneeId: TEST_USER_2.id,
    priority: "urgent",
    startDate: new Date("2026-06-01T00:00:00Z"),
    dueDate: new Date("2026-06-15T00:00:00Z"),
    cost: 12_500,
    icon: "calendar",
    coverUnsplash: sampleUnsplashPayload("alpha-task-cover"),
  });
  await d1
    .prepare("UPDATE task SET source_uid = ? WHERE id = ?")
    .bind("ics-uid-roundtrip@example.com", rangeTask)
    .run();
  await seedSubtask(d1, rangeTask, { title: "Subtask done", completed: true });
  await seedSubtask(d1, rangeTask, { title: "Subtask open" });
  await seedComment(d1, rangeTask, TEST_USER.id, {
    body: "Comment by a member",
    createdAt: new Date("2026-01-01T10:00:00Z"),
  });
  await seedComment(d1, rangeTask, EX_MEMBER.id, {
    body: "Comment by the departed colleague",
    createdAt: new Date("2026-01-02T10:00:00Z"),
  });
  for (const labelId of [labelBug, labelFeature]) {
    await d1
      .prepare("INSERT INTO task_label (id, taskId, labelId, createdAt) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), rangeTask, labelId, toSec("2026-01-03T00:00:00Z"))
      .run();
  }
  const uploadId = crypto.randomUUID();
  const attachmentKey = `task-attachment/${TEST_USER.id}/${suffix}.pdf`;
  await d1
    .prepare(
      "INSERT INTO upload (id, userId, key, filename, mimeType, size, purpose, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(uploadId, TEST_USER.id, attachmentKey, "spec.pdf", "application/pdf", 34_567, "task-attachment", toSec("2026-01-04T00:00:00Z"))
    .run();
  await d1
    .prepare("INSERT INTO task_attachment (id, taskId, uploadId, createdAt) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), rangeTask, uploadId, toSec("2026-01-04T00:00:00Z"))
    .run();
  await seedTaskActivity(d1, rangeTask, TEST_USER.id, {
    action: "updated",
    field: "title",
    oldValue: "Old title",
    newValue: "Range task",
  });
  await seedTaskActivity(d1, rangeTask, EX_MEMBER.id, { action: "created" });

  // Tasks 2+3: recurrence parent/child instance pair sharing one series.
  const parentTask = await seedTask(d1, p1, backlog, {
    title: "Recurring parent",
    priority: "low",
  });
  await d1
    .prepare("UPDATE task SET recurrence_rule = ?, recurrence_series_id = ? WHERE id = ?")
    .bind(
      JSON.stringify({ frequency: "weekly", interval: 1, daysOfWeek: [1, 3] }),
      "series-roundtrip-1",
      parentTask,
    )
    .run();
  const childTask = await seedTask(d1, p1, done, {
    title: "Recurring child",
    priority: "low",
    completed: true,
  });
  await d1
    .prepare(
      "UPDATE task SET recurrence_parent_id = ?, recurrence_series_id = ?, completedAt = ?, completedBy = ? WHERE id = ?",
    )
    .bind(
      parentTask,
      "series-roundtrip-1",
      toSec("2026-05-01T08:00:00Z"),
      EX_MEMBER.id,
      childTask,
    )
    .run();

  // Task 4: reference to a user who is a member of NEITHER workspace.
  await seedTask(d1, p1, backlog, {
    title: "Assigned to departed",
    assigneeId: EX_MEMBER.id,
    priority: "high",
  });

  // Task 5: uploaded (binary) cover image — documentedly non-portable.
  await seedTask(d1, p1, backlog, {
    title: "Cover task",
    coverImageKey: `task-cover/${TEST_USER.id}/${suffix}.png`,
  });

  // --- Project 2: Beta — second project, archived, project-level cover ----
  const p2 = await seedProject(d1, wsId, {
    name: "Beta Project",
    description: "Secondary archived project",
    status: "archived",
    coverImageKey: `project-cover/${TEST_USER.id}/${suffix}.png`,
  });
  await seedProjectMember(d1, p2, TEST_USER.id, "admin");
  const stuff = await seedTaskGroup(d1, p2, { name: "Stuff" });
  await seedTask(d1, p2, stuff, {
    title: "Beta task",
    description: "Plain task in the second project",
  });

  return wsId;
}

// ---------------------------------------------------------------------------
// normalize(): the documented-portability projection
// ---------------------------------------------------------------------------

interface NormalizedTask {
  /** Group resolved to its NAME — group ids are reminted on import. */
  group: string;
  title: string;
  description: string | null;
  /** Refs resolved to emails — the format's own portable user key. */
  assignee: string | null;
  priority: ExportedTask["priority"];
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  startDate: string | null;
  dueDate: string | null;
  cost: number | null;
  icon: string | null;
  coverUnsplash: ExportedTask["coverUnsplash"];
  recurrenceRule: ExportedTask["recurrenceRule"];
  /** Parent resolved to its TITLE — task ids are reminted on import. */
  recurrenceParent: string | null;
  /** Series id replaced by a canonical grouping token (see JSDoc). */
  recurrenceSeries: string | null;
  sourceUid: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  /** Label links resolved to NAMES, sorted — label ids are reminted. */
  labels: string[];
  subtasks: Array<{ title: string; completed: boolean; position: string; createdAt: string }>;
  comments: Array<{ body: string; author: string | null; createdAt: string; updatedAt: string }>;
}

interface NormalizedProject {
  name: string;
  description: string | null;
  status: ExportedProject["status"];
  icon: string | null;
  coverUnsplash: ExportedProject["coverUnsplash"];
  theme: ExportedProject["theme"];
  budget: number | null;
  autoAssignCreator: boolean;
  members: Array<{ email: string; role: string }>;
  taskGroups: Array<{
    name: string;
    color: string | null;
    isCompletionGroup: boolean;
    position: string;
    createdAt: string;
    updatedAt: string;
  }>;
  labels: Array<{ name: string; color: string; createdAt: string }>;
  tasks: NormalizedTask[];
}

interface NormalizeOptions {
  /**
   * Emails of directory users who are NOT members of the import target.
   * Applied to the SOURCE side of the comparison: import resolves refs
   * only against target-workspace members (a deliberate security decision
   * — matching arbitrary platform users by email would leak account
   * existence), so references to these users become `null` (assignee/
   * completedBy/comment author) or are dropped (project members). That
   * loss is REPORTED via `unmatchedUsers`, asserted separately — encoding
   * it here keeps the deep-equal exact instead of skipping those fields.
   */
  unmatchableEmails?: ReadonlySet<string>;
}

/**
 * Project the `projects` subtree down to exactly the content the format
 * PROMISES survives an export → import → export trip, in a deterministic
 * order. Everything not listed below is kept verbatim and compared —
 * including all content timestamps (`createdAt`/`updatedAt`/`completedAt`
 * are user data; the executor preserves them from the file) and the
 * group/task/subtask `position` strings (reused verbatim on import, since
 * a fresh project is a fresh uniqueness namespace).
 *
 * Stripped / transformed, and WHY each cannot round-trip:
 *
 * - **Entity `id`s** (project/group/label/task): import mints fresh UUIDs —
 *   collision-freedom by construction is the design (plan decision 5).
 *   Identity is therefore STRUCTURAL: groups/labels resolve to names,
 *   `taskGroupId` → group name, `labelIds` → sorted label names,
 *   `recurrenceParentId` → the parent task's title.
 *
 * - **`recurrenceSeriesId`**: an opaque grouping UUID, reminted per
 *   distinct source value so imported series can never collide with the
 *   target instance's ids. The GROUPING is the data, so each distinct id is
 *   replaced by a canonical `series#N` token (numbered in sorted-task
 *   order); two tasks share a token after normalization iff they shared a
 *   series before.
 *
 * - **Project `position`**: import computes a fresh fractional key to
 *   append imported projects after the target's existing ones — ordering
 *   among OTHER projects in a different workspace is target-local state,
 *   not portable content.
 *
 * - **User refs → emails**: refs are source-instance user ids; email is
 *   the format's documented portable key (`ref → email → member`).
 *
 * - **`coverImage` (project + task)**: manifest for an UPLOADED binary that
 *   stays in the source instance's R2; import nulls it and the parse stage
 *   reports it via a warning (asserted separately).
 *
 * - **`attachments`**: manifest-only for the same binary reason; import
 *   skips them and reports `skipped.attachments` (asserted separately).
 *
 * - **`activity`**: exports for archival value but is NEVER replayed —
 *   recreating history rows would fabricate provenance; reported via
 *   `skipped.activity` (asserted separately).
 *
 * Arrays are sorted by stable CONTENT keys (project name, group name,
 * label name, task title, subtask position, comment createdAt+body) so the
 * comparison is order-insensitive where order is id-dependent, while
 * still asserting the portable ordering data (position strings) as values.
 */
function normalizeProjects(
  doc: WorkspaceExport,
  opts: NormalizeOptions = {},
): NormalizedProject[] {
  const emailByRef = new Map(doc.users.map((u) => [u.ref, u.email]));
  const resolveRef = (ref: string | null): string | null => {
    if (ref === null) return null;
    const email = emailByRef.get(ref);
    if (email === undefined) {
      // The export contract test pins that every used ref resolves; failing
      // loudly here means the DOCUMENT is broken, not the normalization.
      throw new Error(`Ref "${ref}" does not resolve in the users directory`);
    }
    return opts.unmatchableEmails?.has(email) ? null : email;
  };

  return doc.projects
    .map((p): NormalizedProject => {
      const groupNameById = new Map(p.taskGroups.map((g) => [g.id, g.name]));
      const labelNameById = new Map(p.labels.map((l) => [l.id, l.name]));
      const taskTitleById = new Map(p.tasks.map((t) => [t.id, t.title]));

      const sortedTasks = [...p.tasks].sort((a, b) => a.title.localeCompare(b.title));

      // Canonical series tokens, assigned in sorted-task order so both
      // documents number identical groupings identically.
      const seriesToken = new Map<string, string>();
      for (const t of sortedTasks) {
        if (t.recurrenceSeriesId !== null && !seriesToken.has(t.recurrenceSeriesId)) {
          seriesToken.set(t.recurrenceSeriesId, `series#${seriesToken.size}`);
        }
      }

      const requireName = (map: Map<string, string>, id: string, kind: string): string => {
        const name = map.get(id);
        if (name === undefined) {
          throw new Error(`${kind} "${id}" does not resolve inside its project`);
        }
        return name;
      };

      return {
        name: p.name,
        description: p.description,
        status: p.status,
        icon: p.icon,
        coverUnsplash: p.coverUnsplash,
        theme: p.theme,
        budget: p.budget,
        autoAssignCreator: p.autoAssignCreator,
        members: p.members
          // Unmatchable members are DROPPED (not nulled): a membership row
          // for nobody is unrepresentable, so import skips it.
          .flatMap((m) => {
            const email = resolveRef(m.userRef);
            return email === null ? [] : [{ email, role: m.role }];
          })
          .sort((a, b) => a.email.localeCompare(b.email)),
        taskGroups: [...p.taskGroups]
          .map((g) => ({
            name: g.name,
            color: g.color,
            isCompletionGroup: g.isCompletionGroup,
            position: g.position,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        labels: [...p.labels]
          .map((l) => ({ name: l.name, color: l.color, createdAt: l.createdAt }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        tasks: sortedTasks.map(
          (t): NormalizedTask => ({
            group: requireName(groupNameById, t.taskGroupId, "Task group"),
            title: t.title,
            description: t.description,
            assignee: resolveRef(t.assigneeRef),
            priority: t.priority,
            completed: t.completed,
            completedAt: t.completedAt,
            completedBy: resolveRef(t.completedByRef),
            startDate: t.startDate,
            dueDate: t.dueDate,
            cost: t.cost,
            icon: t.icon,
            coverUnsplash: t.coverUnsplash,
            recurrenceRule: t.recurrenceRule,
            recurrenceParent:
              t.recurrenceParentId !== null
                ? requireName(taskTitleById, t.recurrenceParentId, "Recurrence parent")
                : null,
            recurrenceSeries:
              t.recurrenceSeriesId !== null
                ? (seriesToken.get(t.recurrenceSeriesId) ?? null)
                : null,
            sourceUid: t.sourceUid,
            position: t.position,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            labels: t.labelIds
              .map((id) => requireName(labelNameById, id, "Label"))
              .sort((a, b) => a.localeCompare(b)),
            subtasks: [...t.subtasks]
              .map((s) => ({
                title: s.title,
                completed: s.completed,
                position: s.position,
                createdAt: s.createdAt,
              }))
              .sort((a, b) => a.position.localeCompare(b.position)),
            comments: [...t.comments]
              .map((cm) => ({
                body: cm.body,
                author: resolveRef(cm.authorRef),
                createdAt: cm.createdAt,
                updatedAt: cm.updatedAt,
              }))
              .sort(
                (a, b) =>
                  a.createdAt.localeCompare(b.createdAt) || a.body.localeCompare(b.body),
              ),
          }),
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe("export → import → export round trip", () => {
  it("preserves the full projects subtree and reports every documented non-round-trip item", async () => {
    const app = createApp();

    // --- Export workspace A (the real streamed endpoint) -----------------
    const wsA = await seedWorkspaceA();
    const docA = await exportDocument(app, wsA);

    // --- Import into workspace B (the real multipart endpoint) -----------
    const wsB = await seedWorkspace(d1, TEST_USER.id, {
      name: "Roundtrip Target",
      slug: `roundtrip-b-${crypto.randomUUID().slice(0, 8)}`,
    });
    await seedWorkspaceMember(d1, wsB, TEST_USER_2.id, "member");

    const importRes = await req(app, uploadRequest(`/workspaces/${wsB}/import`, docA));
    expect(importRes.status).toBe(200);
    const result = importResultSchema.parse(await importRes.json());

    // Nothing may fail: a rolled-back project would make the deep-equal
    // below meaningless.
    expect(result.failedProjects).toEqual([]);
    expect(result.counts).toEqual({
      projects: 2,
      taskGroups: 3,
      tasks: 6,
      labels: 2,
      subtasks: 2,
      comments: 2,
    });

    // --- Documented non-round-trip items are REPORTED, never silent ------
    expect(result.skipped.attachments).toBe(1);
    expect(result.skipped.activity).toBe(2);
    expect(result.skipped.webhooks).toBe(1);
    expect(result.skipped.teams).toBe(1);
    expect(result.skipped.invitations).toBe(1);
    // Uploaded covers (1 task + 1 project) surface as a warning.
    expect(result.warnings.some((w) => w.includes("2 uploaded cover images"))).toBe(true);
    // The departed colleague (member of neither workspace) is reported with
    // the distinct-task count: comment author + completedBy + assignee = 3.
    expect(result.unmatchedUsers).toEqual([
      { email: EX_MEMBER.email, name: EX_MEMBER.name, taskCount: 3 },
    ]);

    // --- Export workspace B and compare -----------------------------------
    const docB = await exportDocument(app, wsB);

    // Honest-cut spot checks on the re-export itself: binaries and history
    // did not sneak through as fabricated rows.
    const tasksB = docB.projects.flatMap((p) => p.tasks);
    expect(tasksB.flatMap((t) => t.attachments)).toEqual([]);
    expect(tasksB.flatMap((t) => t.activity ?? [])).toEqual([]);
    expect(tasksB.every((t) => t.coverImage === null)).toBe(true);
    expect(docB.projects.every((p) => p.coverImage === null)).toBe(true);

    // THE deep-equal: B's normalized subtree must equal A's, with A
    // additionally projected through the one documented reference loss
    // (the ex-member is unmatchable in B — reported above).
    const normalizedA = normalizeProjects(docA, {
      unmatchableEmails: new Set([EX_MEMBER.email]),
    });
    const normalizedB = normalizeProjects(docB);
    expect(normalizedB).toEqual(normalizedA);

    // Sanity on the property's bite: the comparison covered every project,
    // every task, and the high-loss-risk fields with REAL (non-null) values
    // — guards against a future normalize() bug that strips a field (or
    // empties the subtree) and trivially "passes".
    expect(normalizedA).toHaveLength(2);
    const tasksA = normalizedA.flatMap((p) => p.tasks);
    expect(tasksA).toHaveLength(6);
    const rangeTask = tasksA.find((t) => t.title === "Range task");
    expect(rangeTask).toMatchObject({
      assignee: TEST_USER_2.email,
      priority: "urgent",
      startDate: "2026-06-01T00:00:00.000Z",
      dueDate: "2026-06-15T00:00:00.000Z",
      cost: 12_500,
      icon: "calendar",
      sourceUid: "ics-uid-roundtrip@example.com",
      labels: ["bug", "feature"],
    });
    expect(rangeTask!.coverUnsplash?.id).toBe("alpha-task-cover");
    expect(rangeTask!.subtasks).toHaveLength(2);
    expect(rangeTask!.comments.map((cm) => cm.author)).toEqual([TEST_USER.email, null]);
    const child = tasksA.find((t) => t.title === "Recurring child");
    expect(child).toMatchObject({
      recurrenceParent: "Recurring parent",
      recurrenceSeries: "series#0",
      completed: true,
      completedAt: "2026-05-01T08:00:00.000Z",
      completedBy: null, // ex-member: the documented, reported loss
    });
    const parent = tasksA.find((t) => t.title === "Recurring parent");
    expect(parent!.recurrenceRule).toEqual({
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [1, 3],
    });
    expect(parent!.recurrenceSeries).toBe("series#0");
    const alpha = normalizedA.find((p) => p.name === "Alpha Project");
    expect(alpha).toMatchObject({ theme: "sunset", budget: 500_000, autoAssignCreator: true });
    expect(alpha!.taskGroups.map((g) => [g.name, g.color, g.isCompletionGroup])).toEqual([
      ["Backlog", "#aabbcc", false],
      ["Done", null, true],
    ]);
    expect(normalizedA.find((p) => p.name === "Beta Project")?.status).toBe("archived");
  });

  // Regression for a REAL user-reported failure: exporting a workspace and
  // re-importing it died with
  //   `projects[i].tasks[j].coverUnsplash.rawUrl: expected string, received undefined`.
  // Cause: `rawUrl` was added to the Unsplash payload AFTER the `cover_unsplash`
  // column shipped, so any cover picked before that lives in the DB without it.
  // Export emits the column verbatim, but the import/export schema reused the
  // STRICT apply-endpoint schema (rawUrl required), so the document the export
  // produced could not be parsed back. That made export/import wholly unusable
  // for any account with a pre-`rawUrl` cover — exactly the data this asserts.
  // The fix splits the schema: strict for the apply WRITE contract, lenient
  // ({@link storedUnsplashCoverPayloadSchema}) for the stored/round-trip path.
  it("round-trips a legacy Unsplash cover stored before rawUrl existed", async () => {
    const app = createApp();

    const wsA = await seedWorkspace(d1, TEST_USER.id, {
      name: "Legacy Cover Source",
      slug: `legacy-cover-a-${crypto.randomUUID().slice(0, 8)}`,
    });
    const p1 = await seedProject(d1, wsA, { name: "Legacy Cover Project" });
    await seedProjectMember(d1, p1, TEST_USER.id, "admin");
    const group = await seedTaskGroup(d1, p1, { name: "Todo" });
    const task = await seedTask(d1, p1, group, { title: "Has a pre-rawUrl cover" });

    // A faithful pre-`rawUrl` payload: every field the column ever stored
    // EXCEPT `rawUrl`. Written as raw JSON to bypass the (now strict) seed
    // helper type — this is precisely the on-disk shape the migration left.
    const legacyCover = {
      id: "legacy-photo",
      url: "https://images.unsplash.com/legacy?w=1080",
      thumbUrl: "https://images.unsplash.com/legacy?w=200",
      blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      color: "#262626",
      description: "A cover picked before rawUrl shipped",
      width: 4000,
      height: 3000,
      photoUrl: "https://unsplash.com/photos/legacy-photo",
      downloadLocation: "https://api.unsplash.com/photos/legacy-photo/download",
      user: {
        name: "Legacy Shooter",
        username: "legacyshooter",
        profileUrl: "https://unsplash.com/@legacyshooter",
      },
    };
    await d1
      .prepare("UPDATE task SET cover_unsplash = ? WHERE id = ?")
      .bind(JSON.stringify(legacyCover), task)
      .run();

    // Export must SUCCEED at schema parse — pre-fix this threw on the missing
    // `rawUrl` before import was even reached.
    const docA = await exportDocument(app, wsA);
    const exportedCover = docA.projects[0]?.tasks[0]?.coverUnsplash;
    expect(exportedCover?.id).toBe("legacy-photo");
    expect(exportedCover?.rawUrl).toBeUndefined();
    expect(exportedCover?.url).toBe(legacyCover.url);

    // Import the produced document into a fresh workspace — the path the user
    // actually exercised.
    const wsB = await seedWorkspace(d1, TEST_USER.id, {
      name: "Legacy Cover Target",
      slug: `legacy-cover-b-${crypto.randomUUID().slice(0, 8)}`,
    });
    const importRes = await req(app, uploadRequest(`/workspaces/${wsB}/import`, docA));
    expect(importRes.status).toBe(200);
    const result = importResultSchema.parse(await importRes.json());
    expect(result.failedProjects).toEqual([]);
    expect(result.counts.tasks).toBe(1);

    // The legacy cover survives the trip intact (still no rawUrl, prebaked
    // URLs preserved so the runtime fallback still renders it).
    const docB = await exportDocument(app, wsB);
    const importedCover = docB.projects[0]?.tasks[0]?.coverUnsplash;
    expect(importedCover).toEqual(legacyCover);
  });
});
