import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../../../../db";
import { createDb } from "../../../../db";
import { label, taskLabel } from "../../../../db/schema/label";
import { project, projectMember } from "../../../../db/schema/project";
import { comment, subtask, task, taskGroup } from "../../../../db/schema/task";
import { createTestD1 } from "../../../test-utils/db-setup";
import { TEST_USER, TEST_USER_2 } from "../../../test-utils/fakes";
import {
  seedProject,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
} from "../../../test-utils/seed";
import {
  chunkRowsForInsert,
  chunkStatements,
  D1_SAFE_BOUND_PARAMS,
  executeImport,
  previewImport,
  rowsPerStatement,
} from "./executor";
import {
  ISO,
  makeComment,
  makeDoc,
  makeGroup,
  makeLabel,
  makeProject,
  makeSubtask,
  makeTask,
  makeUser,
} from "./test-fixtures";

/**
 * Executor tests run against REAL D1 (Miniflare) on purpose: the executor's
 * whole job is satisfying constraints Zod cannot see — UNIQUE indexes, FK
 * actions (restrict on task.taskGroupId, cascades everywhere else), D1's
 * bound-parameter limit — so mocking the DB would mock away exactly the
 * behavior under test. The compensating-delete test in particular is the
 * executable proof of the per-project all-or-nothing guarantee.
 */

/** `Array.find` that fails the test loudly instead of returning undefined —
 *  keeps assertions free of non-null assertions. */
function mustFind<T>(items: T[], predicate: (item: T) => boolean, what: string): T {
  const found = items.find(predicate);
  if (found === undefined) {
    throw new Error(`expected to find ${what}`);
  }
  return found;
}

function wideRow(columns: number, seed = 0): Record<string, unknown> {
  return Object.fromEntries(Array.from({ length: columns }, (_, i) => [`c${i}`, seed]));
}

describe("chunking math (pure)", () => {
  it("derives rows-per-statement from the row object's actual key count", () => {
    // floor(90 / 24) = 3 — the live task row's width.
    expect(rowsPerStatement(wideRow(24))).toBe(3);
    // floor(90 / 8) = 11.
    expect(rowsPerStatement(wideRow(8))).toBe(11);
  });

  it("never returns zero, even for rows wider than the param budget", () => {
    expect(rowsPerStatement(wideRow(120))).toBe(1);
  });

  it("chunks rows so no statement exceeds the bound-parameter budget", () => {
    const rows = Array.from({ length: 10 }, (_, i) => wideRow(24, i));
    const chunks = chunkRowsForInsert(rows);
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 3, 1]);
    for (const chunk of chunks) {
      expect(chunk.length * 24).toBeLessThanOrEqual(D1_SAFE_BOUND_PARAMS);
    }
  });

  it("produces no statements for no rows", () => {
    expect(chunkRowsForInsert([])).toEqual([]);
  });

  it("caps statements per batch at 100, preserving order", () => {
    const statements = Array.from({ length: 250 }, (_, i) => i);
    const groups = chunkStatements(statements);
    expect(groups.map((g) => g.length)).toEqual([100, 100, 50]);
    expect(groups[0][0]).toBe(0);
    expect(groups[2][49]).toBe(249);
  });
});

describe("import executor (Miniflare D1)", () => {
  let d1: D1Database;
  let db: Database;
  let dispose: () => Promise<void>;
  let workspaceId: string;

  beforeEach(async () => {
    ({ d1, dispose } = await createTestD1());
    db = createDb(d1);
    await seedUser(d1, TEST_USER);
    workspaceId = await seedWorkspace(d1, TEST_USER.id);
  });

  afterEach(async () => {
    await dispose();
  });

  it("imports a full graph: every id reminted, every FK resolving to a created row", async () => {
    const rule = { frequency: "weekly" as const, interval: 1, daysOfWeek: [1] };
    const docProject = makeProject({
      name: "Full Graph",
      description: "round-trip",
      budget: 500_000,
      taskGroups: [
        makeGroup({ id: "g1", name: "Backlog" }),
        makeGroup({ id: "g2", name: "Done", isCompletionGroup: true, color: "#22c55e" }),
      ],
      labels: [
        makeLabel({ id: "l1", name: "bug", color: "#ef4444" }),
        makeLabel({ id: "l2", name: "ui", color: "#3b82f6" }),
      ],
      tasks: [
        makeTask("g1", {
          id: "t-parent",
          title: "Recurring parent",
          recurrenceRule: rule,
          recurrenceSeriesId: "series-1",
          dueDate: "2026-02-01T00:00:00.000Z",
          labelIds: ["l1"],
        }),
        makeTask("g1", {
          id: "t-child",
          title: "Recurring child",
          recurrenceRule: rule,
          recurrenceParentId: "t-parent",
          recurrenceSeriesId: "series-1",
          dueDate: "2026-02-08T00:00:00.000Z",
        }),
        makeTask("g2", {
          id: "t-done",
          title: "Done task",
          completed: true,
          completedAt: ISO,
          cost: 1250,
          sourceUid: "ics-uid-1",
          labelIds: ["l1", "l2"],
          subtasks: [makeSubtask({ title: "s1" }), makeSubtask({ title: "s2", completed: true })],
          comments: [makeComment({ body: "ship it" })],
        }),
      ],
    });
    const doc = makeDoc([docProject]);

    const report = await executeImport(db, workspaceId, TEST_USER.id, doc);

    expect(report.failedProjects).toEqual([]);
    expect(report.counts).toEqual({
      projects: 1,
      taskGroups: 2,
      tasks: 3,
      labels: 2,
      subtasks: 2,
      comments: 1,
    });

    const projects = await db.select().from(project).where(eq(project.workspaceId, workspaceId));
    expect(projects).toHaveLength(1);
    const created = projects[0];
    expect(created.id).not.toBe(docProject.id); // fresh UUID, never the source id
    expect(created.name).toBe("Full Graph");
    expect(created.budget).toBe(500_000);
    expect(created.position).not.toBeNull();
    // Content timestamps are preserved from the file — creation dates are data.
    expect(created.createdAt.getTime()).toBe(new Date(ISO).getTime());

    const groups = await db.select().from(taskGroup).where(eq(taskGroup.projectId, created.id));
    expect(groups).toHaveLength(2);
    const groupIds = new Set(groups.map((g) => g.id));
    expect(groupIds.has("g1")).toBe(false);

    const tasks = await db.select().from(task).where(eq(task.projectId, created.id));
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(groupIds.has(t.taskGroupId)).toBe(true); // FKs resolve to created groups
    }

    // Recurrence remap spot-check: parent link points at the NEW parent id,
    // and the shared series id is one fresh UUID common to both tasks.
    const newParent = mustFind(tasks, (t) => t.title === "Recurring parent", "parent task");
    const newChild = mustFind(tasks, (t) => t.title === "Recurring child", "child task");
    expect(newChild.recurrenceParentId).toBe(newParent.id);
    expect(newParent.recurrenceSeriesId).not.toBeNull();
    expect(newParent.recurrenceSeriesId).toBe(newChild.recurrenceSeriesId);
    expect(newParent.recurrenceSeriesId).not.toBe("series-1");
    // Rule serialization matches the app's own write path (JSON text).
    expect(newParent.recurrenceRule).toBe(JSON.stringify(rule));

    const doneTask = mustFind(tasks, (t) => t.title === "Done task", "done task");
    expect(doneTask.completed).toBe(true);
    expect(doneTask.cost).toBe(1250);
    expect(doneTask.sourceUid).toBe("ics-uid-1");

    const labels = await db.select().from(label).where(eq(label.projectId, created.id));
    expect(labels).toHaveLength(2);
    const labelIds = new Set(labels.map((l) => l.id));
    const taskIds = new Set(tasks.map((t) => t.id));
    const links = (await db.select().from(taskLabel)).filter((l) => taskIds.has(l.taskId));
    expect(links).toHaveLength(3); // parent:1 + done:2
    for (const link of links) {
      expect(labelIds.has(link.labelId)).toBe(true);
    }

    const subtasks = (await db.select().from(subtask)).filter((s) => taskIds.has(s.taskId));
    expect(subtasks).toHaveLength(2);
    const comments = (await db.select().from(comment)).filter((c) => taskIds.has(c.taskId));
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("ship it");
  });

  it("assigns email-matched workspace members (case-insensitively) and nulls + reports unmatched users", async () => {
    await seedUser(d1, TEST_USER_2);
    await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

    const doc = makeDoc(
      [
        makeProject({
          taskGroups: [makeGroup({ id: "g1" })],
          tasks: [
            makeTask("g1", { title: "Assigned", assigneeRef: "u-member" }),
            makeTask("g1", {
              title: "Orphan assignee",
              assigneeRef: "u-stranger",
              comments: [makeComment({ body: "by stranger", authorRef: "u-stranger" })],
            }),
            makeTask("g1", {
              title: "Orphan completer",
              completed: true,
              completedAt: ISO,
              completedByRef: "u-stranger",
            }),
          ],
        }),
      ],
      [
        // Uppercased on purpose: a restore must not unassign a workspace
        // because two instances disagreed on email casing.
        makeUser("u-member", TEST_USER_2.email.toUpperCase()),
        makeUser("u-stranger", "stranger@example.com", "Stray Stranger"),
      ],
    );

    const report = await executeImport(db, workspaceId, TEST_USER.id, doc);

    const tasks = await db.select().from(task);
    expect(mustFind(tasks, (t) => t.title === "Assigned", "assigned task").assigneeId).toBe(
      TEST_USER_2.id,
    );
    const orphanAssignee = mustFind(tasks, (t) => t.title === "Orphan assignee", "orphan task");
    expect(orphanAssignee.assigneeId).toBeNull();
    const orphanCompleter = mustFind(
      tasks,
      (t) => t.title === "Orphan completer",
      "orphan completer",
    );
    expect(orphanCompleter.completedBy).toBeNull();
    expect(orphanCompleter.completed).toBe(true); // the FACT survives, the ref doesn't

    const comments = await db.select().from(comment);
    expect(comments).toHaveLength(1);
    expect(comments[0].authorId).toBeNull();

    // Distinct-task counting: "Orphan assignee" references the stranger
    // twice (assignee + comment author) but counts once.
    expect(report.unmatchedUsers).toEqual([
      { email: "stranger@example.com", name: "Stray Stranger", taskCount: 2 },
    ]);
  });

  it("NEVER matches a platform user who is not a workspace member (account-existence guard)", async () => {
    // TEST_USER_2 exists on the platform with this exact email — but is NOT
    // a member of the target workspace. Matching them would leak account
    // existence and hand workspace content references to an outsider.
    await seedUser(d1, TEST_USER_2);

    const doc = makeDoc(
      [
        makeProject({
          taskGroups: [makeGroup({ id: "g1" })],
          tasks: [makeTask("g1", { title: "Probe", assigneeRef: "u1" })],
        }),
      ],
      [makeUser("u1", TEST_USER_2.email, TEST_USER_2.name)],
    );

    const report = await executeImport(db, workspaceId, TEST_USER.id, doc);

    const tasks = await db.select().from(task);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBeNull();
    expect(report.unmatchedUsers).toEqual([
      { email: TEST_USER_2.email, name: TEST_USER_2.name, taskCount: 1 },
    ]);
  });

  it("appends imported projects after the workspace's existing projects, in file order", async () => {
    const existingId = await seedProject(d1, workspaceId, { name: "Existing" });
    await d1.prepare("UPDATE project SET position = ? WHERE id = ?").bind("a5", existingId).run();

    const doc = makeDoc([makeProject({ name: "Imp A" }), makeProject({ name: "Imp B" })]);
    const report = await executeImport(db, workspaceId, TEST_USER.id, doc);
    expect(report.counts.projects).toBe(2);

    const rows = await db.select().from(project).where(eq(project.workspaceId, workspaceId));
    expect(rows).toHaveLength(3);
    const posA = mustFind(rows, (r) => r.name === "Imp A", "Imp A").position;
    const posB = mustFind(rows, (r) => r.name === "Imp B", "Imp B").position;
    if (posA === null || posB === null) {
      throw new Error("imported projects must receive fractional-index positions");
    }
    // Fractional-index keys order lexicographically.
    expect(posA > "a5").toBe(true);
    expect(posB > posA).toBe(true);
  });

  it("forces the importing user as project admin and maps only member-matched file members", async () => {
    await seedUser(d1, TEST_USER_2);
    await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

    const doc = makeDoc(
      [
        makeProject({
          members: [
            { userRef: "me", role: "viewer" }, // file demotes the importer — must not stick
            { userRef: "them", role: "member" },
            { userRef: "ghost", role: "admin" }, // unmatched — must not be added
          ],
        }),
      ],
      [
        makeUser("me", TEST_USER.email),
        makeUser("them", TEST_USER_2.email),
        makeUser("ghost", "ghost@example.com"),
      ],
    );

    await executeImport(db, workspaceId, TEST_USER.id, doc);

    const members = await db.select().from(projectMember);
    expect(members).toHaveLength(2);
    expect(mustFind(members, (m) => m.userId === TEST_USER.id, "importer membership").role).toBe(
      "admin",
    );
    expect(mustFind(members, (m) => m.userId === TEST_USER_2.id, "member membership").role).toBe(
      "member",
    );
  });

  it("lands every row when tasks span multiple INSERT statements (chunking exercised)", async () => {
    const taskCount = 10;
    const doc = makeDoc([
      makeProject({
        taskGroups: [makeGroup({ id: "g1" })],
        tasks: Array.from({ length: taskCount }, (_, i) =>
          makeTask("g1", { title: `Task ${i}` }),
        ),
      }),
    ]);

    const report = await executeImport(db, workspaceId, TEST_USER.id, doc);
    expect(report.failedProjects).toEqual([]);
    expect(report.counts.tasks).toBe(taskCount);

    const rows = await db.select().from(task);
    expect(rows).toHaveLength(taskCount);
    // Prove the scenario actually exercised chunking: the live task row is
    // wide enough that 10 rows cannot fit one 90-param statement.
    const taskColumnCount = Object.keys(rows[0]).length;
    expect(taskCount).toBeGreaterThan(Math.floor(D1_SAFE_BOUND_PARAMS / taskColumnCount));

    const titles = new Set(rows.map((r) => r.title));
    for (let i = 0; i < taskCount; i++) {
      expect(titles.has(`Task ${i}`)).toBe(true);
    }
  });

  it("rolls back a failed project completely (no orphans) and still imports the rest", async () => {
    // Failure injection Zod cannot see: two tasks share (taskGroupId,
    // position) — a UNIQUE index violation that fires in write phase 2,
    // AFTER phase 1 (project/member/group/label) has committed. Exactly the
    // cross-batch partial state the compensating delete exists for.
    const bad = makeProject({
      name: "Bad Project",
      taskGroups: [makeGroup({ id: "gb" })],
      labels: [makeLabel({ id: "lb", name: "doomed" })],
      tasks: [
        makeTask("gb", {
          title: "Dup 1",
          position: "a1",
          subtasks: [makeSubtask()],
          comments: [makeComment()],
        }),
        makeTask("gb", { title: "Dup 2", position: "a1" }),
      ],
    });
    const good = makeProject({
      name: "Good Project",
      taskGroups: [makeGroup({ id: "gg" })],
      tasks: [makeTask("gg", { title: "Survivor" })],
    });
    // Bad project FIRST — proves the loop continues past a failure.
    const doc = makeDoc([bad, good]);

    const report = await executeImport(db, workspaceId, TEST_USER.id, doc);

    expect(report.failedProjects).toHaveLength(1);
    expect(report.failedProjects[0].name).toBe("Bad Project");
    expect(report.failedProjects[0].error.length).toBeGreaterThan(0);
    // Counts reflect only what actually exists.
    expect(report.counts).toEqual({
      projects: 1,
      taskGroups: 1,
      tasks: 1,
      labels: 0,
      subtasks: 0,
      comments: 0,
    });

    // NO orphan rows for the failed project — phase-1 rows (project,
    // member, group, label) must be gone via the compensating delete.
    const projects = await db.select().from(project).where(eq(project.workspaceId, workspaceId));
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Good Project");

    expect(await db.select().from(taskGroup)).toHaveLength(1); // Good's only
    expect(await db.select().from(label)).toHaveLength(0); // "doomed" rolled back

    const members = await db.select().from(projectMember);
    expect(members).toHaveLength(1);
    expect(members[0].projectId).toBe(projects[0].id);

    const tasks = await db.select().from(task);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Survivor");
    expect(await db.select().from(subtask)).toHaveLength(0);
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  it("nulls dangling recurrence parents and drops dangling/duplicate label links, with matching preview warnings", async () => {
    const doc = makeDoc([
      makeProject({
        name: "Repairs",
        taskGroups: [makeGroup({ id: "g1" })],
        labels: [makeLabel({ id: "l1", name: "real" })],
        tasks: [
          makeTask("g1", {
            title: "Orphan recurrence",
            recurrenceParentId: "not-in-file",
            labelIds: ["ghost-label", "l1", "l1"],
          }),
        ],
      }),
    ]);

    // Preview and execute share the repair pass — the warnings a user
    // confirms in the dry run are the warnings the commit acts on.
    const preview = await previewImport(db, workspaceId, doc);
    expect(preview.warnings.some((w) => w.includes("Orphan recurrence") && w.includes("recurrence"))).toBe(true);
    expect(preview.warnings.some((w) => w.includes("label"))).toBe(true);

    const report = await executeImport(db, workspaceId, TEST_USER.id, doc);
    expect(report.failedProjects).toEqual([]);
    expect(report.warnings).toEqual(preview.warnings);

    const tasks = await db.select().from(task);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].recurrenceParentId).toBeNull();

    // Dangling link dropped, duplicate deduped: exactly one link to "real".
    const links = await db.select().from(taskLabel);
    expect(links).toHaveLength(1);
    const labels = await db.select().from(label);
    expect(labels).toHaveLength(1);
    expect(links[0].labelId).toBe(labels[0].id);
  });

  it("previewImport reports counts and unmatched users with ZERO writes", async () => {
    const doc = makeDoc(
      [
        makeProject({
          taskGroups: [makeGroup({ id: "g1" }), makeGroup({ id: "g2" })],
          labels: [makeLabel({ id: "l1" })],
          tasks: [
            makeTask("g1", {
              assigneeRef: "u1",
              subtasks: [makeSubtask()],
              comments: [makeComment(), makeComment({ body: "two" })],
            }),
            makeTask("g2", {}),
          ],
        }),
        makeProject({ taskGroups: [makeGroup({ id: "g3" })], tasks: [makeTask("g3", {})] }),
      ],
      [makeUser("u1", "nobody@example.com")],
    );

    const preview = await previewImport(db, workspaceId, doc);

    expect(preview.counts).toEqual({
      projects: 2,
      taskGroups: 3,
      tasks: 3,
      labels: 1,
      subtasks: 1,
      comments: 2,
    });
    expect(preview.unmatchedUsers).toEqual([
      { email: "nobody@example.com", name: "User u1", taskCount: 1 },
    ]);

    // Zero writes — dry run is stateless by design.
    expect(await db.select().from(project)).toHaveLength(0);
    expect(await db.select().from(task)).toHaveLength(0);
    expect(await db.select().from(taskGroup)).toHaveLength(0);
    expect(await db.select().from(label)).toHaveLength(0);
    expect(await db.select().from(projectMember)).toHaveLength(0);
  });

  it("handles an empty document (no projects) without writing or failing", async () => {
    const report = await executeImport(db, workspaceId, TEST_USER.id, makeDoc([]));
    expect(report.counts).toEqual({
      projects: 0,
      taskGroups: 0,
      tasks: 0,
      labels: 0,
      subtasks: 0,
      comments: 0,
    });
    expect(report.failedProjects).toEqual([]);
    expect(report.unmatchedUsers).toEqual([]);
    expect(await db.select().from(project)).toHaveLength(0);
  });
});
