/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for assignee membership validation across every task
 * assignment site.
 *
 * ## Why these tests exist
 *
 * `assigneeId` used to be persisted verbatim from the request body. Because the
 * resulting `task_assigned` notification carries the **task title** and the
 * **actor's name**, assigning a task to an arbitrary user id delivered both to
 * an account with no workspace, no project and no invitation — and the task then
 * appeared in that stranger's "My Tasks" list, which filters by assignee rather
 * than by membership. It was also an unbounded notification-spam primitive
 * against any known user id.
 *
 * Every case below asserts the **post-condition** — the stored row, and the
 * absence of a notification row for the outsider — never merely the HTTP status.
 * A status-only test is exactly the kind of test that let this ship: the audit
 * found the existing suite green while the hole was live.
 *
 * ## The regression trap
 *
 * The naive fix (look for a `project_member` row) silently breaks assigning work
 * to workspace **owners and admins**, who are elevated to project admin by
 * `resolveProjectAccess` *without* such a row — in a small workspace those are
 * the most likely assignees. `wsOwner` and `wsAdmin` below hold no
 * `project_member` row on purpose, and every "succeeds" case is duplicated for
 * them.
 *
 * Runs against a real Miniflare-backed D1 so the access join, the notification
 * insert and the recurrence spawn all execute as real SQL.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTaskSchema, updateTaskSchema } from "../../../shared/schemas/task";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  makeTestUser,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import { completeTask } from "./handlers/completion";
import { createTask, updateTask } from "./handlers/task-crud";
import { duplicateTask } from "./handlers/task-operations";

// ---------------------------------------------------------------------------
// Cast of users
//
// TEST_USER   — the actor. Plain workspace member, project ADMIN via a
//               project_member row. No route guards are mounted in this file
//               (see the app builders below), so that row is what the
//               handlers' own access resolution reads to grant them admin.
// TEST_USER_2 — ordinary project member. Valid assignee.
// wsOwner     — owns the workspace, NO project_member row. Valid assignee via
//               elevation (regression trap).
// wsAdmin     — workspace admin, NO project_member row. Valid assignee via
//               elevation (regression trap).
// plainMember — workspace member, NO project_member row. NOT a valid assignee:
//               they genuinely cannot open the project.
// stranger    — no workspace, no project, no invitation. NOT a valid assignee;
//               this is the account from the reported exploit.
// ---------------------------------------------------------------------------

/**
 * The four extra identities, whose whole purpose is the membership they do (and
 * do not) hold. Built with the shared `makeTestUser` and seeded with the shared
 * `seedUser`, both of which accept any `TestUserFixture` — the two canonical
 * fixtures are a convenience, not a ceiling on the cast a test may assemble.
 */
const WS_OWNER = makeTestUser("ws-owner-no-project-row", "Workspace Owner");
const WS_ADMIN = makeTestUser("ws-admin-no-project-row", "Workspace Admin");
const PLAIN_MEMBER = makeTestUser("ws-plain-member-no-project-row", "Plain Workspace Member");
const STRANGER = makeTestUser("total-stranger-no-relationship", "Total Stranger");

const WS_OWNER_ID = WS_OWNER.id;
const WS_ADMIN_ID = WS_ADMIN.id;
const PLAIN_MEMBER_ID = PLAIN_MEMBER.id;
const STRANGER_ID = STRANGER.id;

/** Every notification row addressed to `userId`, newest first. */
async function notificationsFor(
  d1: D1Database,
  userId: string,
): Promise<{ type: string; title: string; taskId: string | null }[]> {
  const { results } = await d1
    .prepare("SELECT type, title, taskId FROM notification WHERE userId = ? ORDER BY createdAt DESC")
    .bind(userId)
    .all<{ type: string; title: string; taskId: string | null }>();
  return results;
}

/** The stored `assigneeId` for a task, or `undefined` when the row is absent. */
async function storedAssignee(d1: D1Database, taskId: string): Promise<string | null | undefined> {
  const row = await d1
    .prepare("SELECT assigneeId FROM task WHERE id = ?")
    .bind(taskId)
    .first<{ assigneeId: string | null }>();
  return row === null ? undefined : row.assigneeId;
}

/** Rows in a project's task table matching a title — proves nothing was written. */
async function tasksTitled(d1: D1Database, projectId: string, title: string): Promise<number> {
  const row = await d1
    .prepare("SELECT COUNT(*) AS n FROM task WHERE projectId = ? AND title = ?")
    .bind(projectId, title)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let taskGroupId: string;
let completionGroupId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  for (const u of [WS_OWNER, WS_ADMIN, PLAIN_MEMBER, STRANGER]) {
    await seedUser(d1, u);
  }

  // seedWorkspace also writes the owner's workspace_member row.
  workspaceId = await seedWorkspace(d1, WS_OWNER_ID);
  await seedWorkspaceMember(d1, workspaceId, WS_ADMIN_ID, "admin");
  await seedWorkspaceMember(d1, workspaceId, TEST_USER.id, "member");
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
  await seedWorkspaceMember(d1, workspaceId, PLAIN_MEMBER_ID, "member");

  projectId = await seedProject(d1, workspaceId);
  // Only the actor and TEST_USER_2 get project_member rows. wsOwner/wsAdmin
  // deliberately do not — that is the whole point of the regression trap.
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  await seedProjectMember(d1, projectId, TEST_USER_2.id, "member");

  taskGroupId = await seedTaskGroup(d1, projectId, { name: "To Do" });
  completionGroupId = await seedTaskGroup(d1, projectId, {
    name: "Done",
    isCompletionGroup: true,
  });
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  // Notifications are the security post-condition; clear them so each case
  // asserts only what it caused.
  await d1.prepare("DELETE FROM notification").run();
});

// The real seeded workspace id is used rather than a literal: these handlers
// re-derive access from the DB and never read `workspaceMembership` today, but
// a context value that disagrees with the database is a trap waiting for the
// first handler that starts trusting it.
const auth = () =>
  fakeAuth(d1, TEST_USER, {
    workspaceMembership: { id: "wm-actor", workspaceId, role: "member" },
  });

/**
 * ExecutionContext whose `waitUntil` promises can be flushed.
 *
 * Notifications are created inside `deferWork`, which without an
 * ExecutionContext degrades to fire-and-forget — the assertions below would
 * then race the deferred DB writes and, worse, the "no notification was
 * created" cases would pass for the wrong reason (nothing had run *yet*).
 * Routing every request through this ctx and flushing makes both the positive
 * and the negative post-conditions deterministic.
 */
function createAwaitableExecutionCtx() {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
      passThroughOnException: () => {},
    } as ExecutionContext,
    flush: async () => {
      // A flushed promise may schedule further waitUntil work, so loop until
      // the queue stops growing.
      let awaited = 0;
      while (awaited < promises.length) {
        const batch = promises.slice(awaited);
        awaited = promises.length;
        await Promise.all(batch);
      }
    },
  };
}

/** Dispatch a request and settle all deferred work before returning. */
async function send(app: Hono<AppEnv>, path: string, req: Request): Promise<Response> {
  const { ctx, flush } = createAwaitableExecutionCtx();
  const res = await app.request(path, req, {}, ctx);
  await flush();
  return res;
}

function createApp() {
  const app = new Hono<AppEnv>();
  app.post("/projects/:projectId/tasks", auth(), validateBody(createTaskSchema), createTask);
  return app;
}

function updateApp() {
  const app = new Hono<AppEnv>();
  app.patch("/tasks/:taskId", auth(), validateBody(updateTaskSchema), updateTask);
  return app;
}

function postTask(body: Record<string, unknown>) {
  return send(
    createApp(),
    `/projects/${projectId}/tasks`,
    jsonRequest("POST", `/projects/${projectId}/tasks`, body),
  );
}

function patchTask(taskId: string, body: Record<string, unknown>) {
  return send(updateApp(), `/tasks/${taskId}`, jsonRequest("PATCH", `/tasks/${taskId}`, body));
}

// =========================================================================
// createTask
// =========================================================================

describe("createTask — assignee validation", () => {
  it("assigns to a direct project member", async () => {
    const res = await postTask({
      title: "Assigned to a project member",
      taskGroupId,
      assigneeId: TEST_USER_2.id,
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBe(TEST_USER_2.id);
    expect(await storedAssignee(d1, body.task.id)).toBe(TEST_USER_2.id);

    const notes = await notificationsFor(d1, TEST_USER_2.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe("task_assigned");
  });

  /**
   * THE REGRESSION TRAP. The workspace owner has no `project_member` row; a
   * membership-row check would 400 here and make the owner unassignable.
   */
  it("assigns to the workspace OWNER even with no project_member row", async () => {
    const res = await postTask({
      title: "Assigned to the workspace owner",
      taskGroupId,
      assigneeId: WS_OWNER_ID,
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBe(WS_OWNER_ID);
    expect(await storedAssignee(d1, body.task.id)).toBe(WS_OWNER_ID);
    expect(await notificationsFor(d1, WS_OWNER_ID)).toHaveLength(1);
  });

  it("assigns to a workspace ADMIN even with no project_member row", async () => {
    const res = await postTask({
      title: "Assigned to a workspace admin",
      taskGroupId,
      assigneeId: WS_ADMIN_ID,
    });

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBe(WS_ADMIN_ID);
    expect(await storedAssignee(d1, body.task.id)).toBe(WS_ADMIN_ID);
    expect(await notificationsFor(d1, WS_ADMIN_ID)).toHaveLength(1);
  });

  /**
   * The exploit from the audit, verbatim: a stranger must get a 400, no task
   * row, and — the part that actually matters — no notification carrying the
   * title.
   */
  it("rejects a total stranger with 400 and creates NO task and NO notification", async () => {
    const title = "SECRET: Q4 layoffs list - legal review";
    const res = await postTask({ title, taskGroupId, assigneeId: STRANGER_ID });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/assignee must have access to this project/i);

    expect(await tasksTitled(d1, projectId, title)).toBe(0);
    expect(await notificationsFor(d1, STRANGER_ID)).toEqual([]);
  });

  it("rejects a plain workspace member who is not on the project", async () => {
    const title = "Not for a non-project workspace member";
    const res = await postTask({ title, taskGroupId, assigneeId: PLAIN_MEMBER_ID });

    expect(res.status).toBe(400);
    expect(await tasksTitled(d1, projectId, title)).toBe(0);
    expect(await notificationsFor(d1, PLAIN_MEMBER_ID)).toEqual([]);
  });

  it("rejects a user id that does not exist at all", async () => {
    const title = "Assigned to nobody real";
    const res = await postTask({ title, taskGroupId, assigneeId: "no-such-user-id" });

    expect(res.status).toBe(400);
    expect(await tasksTitled(d1, projectId, title)).toBe(0);
  });

  it("creates an unassigned task when assigneeId is omitted", async () => {
    const res = await postTask({ title: "Unassigned on create", taskGroupId });

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBeNull();
    expect(await storedAssignee(d1, body.task.id)).toBeNull();
  });

  it("creates an unassigned task when assigneeId is explicitly null", async () => {
    const res = await postTask({ title: "Explicit null on create", taskGroupId, assigneeId: null });

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBeNull();
  });

  it("still self-assigns the creator when the project has autoAssignCreator", async () => {
    const autoProjectId = await seedProject(d1, workspaceId, { autoAssignCreator: true });
    await seedProjectMember(d1, autoProjectId, TEST_USER.id, "admin");
    const autoGroupId = await seedTaskGroup(d1, autoProjectId, { name: "Auto" });

    const res = await send(
      createApp(),
      `/projects/${autoProjectId}/tasks`,
      jsonRequest("POST", `/projects/${autoProjectId}/tasks`, {
        title: "Auto assigned",
        taskGroupId: autoGroupId,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBe(TEST_USER.id);
  });
});

// =========================================================================
// updateTask
// =========================================================================

describe("updateTask — assignee validation", () => {
  it("reassigns to a project member", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, { title: "Reassign me" });

    const res = await patchTask(taskId, { assigneeId: TEST_USER_2.id });

    expect(res.status).toBe(200);
    expect(await storedAssignee(d1, taskId)).toBe(TEST_USER_2.id);
    expect(await notificationsFor(d1, TEST_USER_2.id)).toHaveLength(1);
  });

  /** Same regression trap as on create — elevation must be honoured on PATCH. */
  it("reassigns to the workspace OWNER with no project_member row", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, { title: "Owner takes this" });

    const res = await patchTask(taskId, { assigneeId: WS_OWNER_ID });

    expect(res.status).toBe(200);
    expect(await storedAssignee(d1, taskId)).toBe(WS_OWNER_ID);
    expect(await notificationsFor(d1, WS_OWNER_ID)).toHaveLength(1);
  });

  it("reassigns to a workspace ADMIN with no project_member row", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, { title: "Admin takes this" });

    const res = await patchTask(taskId, { assigneeId: WS_ADMIN_ID });

    expect(res.status).toBe(200);
    expect(await storedAssignee(d1, taskId)).toBe(WS_ADMIN_ID);
  });

  it("rejects a stranger with 400, leaves the stored assignee untouched, notifies nobody", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "CONFIDENTIAL: acquisition terms",
      assigneeId: TEST_USER_2.id,
    });

    const res = await patchTask(taskId, { assigneeId: STRANGER_ID });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/assignee must have access to this project/i);

    expect(await storedAssignee(d1, taskId)).toBe(TEST_USER_2.id);
    expect(await notificationsFor(d1, STRANGER_ID)).toEqual([]);
  });

  it("rejects a plain workspace member who is not on the project", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, { title: "Nope" });

    const res = await patchTask(taskId, { assigneeId: PLAIN_MEMBER_ID });

    expect(res.status).toBe(400);
    expect(await storedAssignee(d1, taskId)).toBeNull();
    expect(await notificationsFor(d1, PLAIN_MEMBER_ID)).toEqual([]);
  });

  it("clears the assignee when assigneeId is null", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Unassign me",
      assigneeId: TEST_USER_2.id,
    });

    const res = await patchTask(taskId, { assigneeId: null });

    expect(res.status).toBe(200);
    expect(await storedAssignee(d1, taskId)).toBeNull();
  });

  it("leaves the assignee alone when the field is absent from the payload", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Title only edit",
      assigneeId: TEST_USER_2.id,
    });

    const res = await patchTask(taskId, { title: "Retitled" });

    expect(res.status).toBe(200);
    expect(await storedAssignee(d1, taskId)).toBe(TEST_USER_2.id);
  });

  /**
   * Clients (including this app's own web UI) PATCH whole task objects, so an
   * unchanged `assigneeId` must stay a no-op. If it were re-validated, a task
   * whose assignee was offboarded after assignment would 400 on every later
   * edit — an unrelated membership change bricking the task.
   */
  it("accepts re-sending the CURRENT assignee even when that assignee is now stale", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Legacy assignment",
      assigneeId: STRANGER_ID,
    });

    const res = await patchTask(taskId, { assigneeId: STRANGER_ID, title: "Legacy assignment v2" });

    expect(res.status).toBe(200);
    expect(await storedAssignee(d1, taskId)).toBe(STRANGER_ID);
    // Unchanged assignee ⇒ no new assignment notification either.
    expect(await notificationsFor(d1, STRANGER_ID)).toEqual([]);
  });

  it("self-assignment by the caller succeeds", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, { title: "Mine now" });

    const res = await patchTask(taskId, { assigneeId: TEST_USER.id });

    expect(res.status).toBe(200);
    expect(await storedAssignee(d1, taskId)).toBe(TEST_USER.id);
  });
});

// =========================================================================
// duplicateTask
// =========================================================================

describe("duplicateTask — inherited assignee", () => {
  function duplicateApp() {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);
    return app;
  }

  it("carries a valid assignee onto the copy and notifies them", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Duplicate with valid assignee",
      assigneeId: TEST_USER_2.id,
    });

    const res = await send(
      duplicateApp(),
      `/tasks/${taskId}/duplicate`,
      jsonRequest("POST", `/tasks/${taskId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBe(TEST_USER_2.id);
    expect(await storedAssignee(d1, body.task.id)).toBe(TEST_USER_2.id);
    expect(await notificationsFor(d1, TEST_USER_2.id)).toHaveLength(1);
  });

  it("carries a workspace-owner assignee (no project_member row) onto the copy", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Duplicate owned by the workspace owner",
      assigneeId: WS_OWNER_ID,
    });

    const res = await send(
      duplicateApp(),
      `/tasks/${taskId}/duplicate`,
      jsonRequest("POST", `/tasks/${taskId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBe(WS_OWNER_ID);
  });

  /**
   * A stale assignee must not be handed a brand-new task (nor its title). The
   * duplicate still succeeds — the person clicking Duplicate is not at fault
   * for someone else's offboarding — but the copy comes out unassigned.
   */
  it("drops a stale assignee from the copy and sends no notification", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "SECRET: board deck",
      assigneeId: STRANGER_ID,
    });

    const res = await send(
      duplicateApp(),
      `/tasks/${taskId}/duplicate`,
      jsonRequest("POST", `/tasks/${taskId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; assigneeId: string | null } }>();
    expect(body.task.assigneeId).toBeNull();
    expect(await storedAssignee(d1, body.task.id)).toBeNull();
    expect(await notificationsFor(d1, STRANGER_ID)).toEqual([]);
    // The source task is untouched — this path cleans the copy, not history.
    expect(await storedAssignee(d1, taskId)).toBe(STRANGER_ID);
  });
});

// =========================================================================
// completeTask (+ recurring spawn)
// =========================================================================

describe("completeTask — assignee notification", () => {
  function completeApp() {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/complete", auth(), completeTask);
    return app;
  }

  function complete(taskId: string) {
    return send(
      completeApp(),
      `/tasks/${taskId}/complete`,
      jsonRequest("POST", `/tasks/${taskId}/complete`),
    );
  }

  /** Marks a task as recurring; `seedTask` has no recurrence knob. */
  async function makeRecurring(taskId: string): Promise<void> {
    await d1
      .prepare("UPDATE task SET recurrence_rule = ?, recurrence_series_id = ? WHERE id = ?")
      .bind(JSON.stringify({ frequency: "daily", interval: 1 }), crypto.randomUUID(), taskId)
      .run();
  }

  async function spawnedChildOf(d1db: D1Database, taskId: string) {
    return d1db
      .prepare("SELECT id, assigneeId, title FROM task WHERE recurrence_parent_id = ?")
      .bind(taskId)
      .first<{ id: string; assigneeId: string | null; title: string }>();
  }

  it("notifies a valid assignee that their task was completed", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Complete me",
      assigneeId: TEST_USER_2.id,
    });

    expect((await complete(taskId)).status).toBe(200);

    const notes = await notificationsFor(d1, TEST_USER_2.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe("task_completed");
  });

  it("notifies a workspace-owner assignee with no project_member row", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Owner's task completed",
      assigneeId: WS_OWNER_ID,
    });

    expect((await complete(taskId)).status).toBe(200);
    expect(await notificationsFor(d1, WS_OWNER_ID)).toHaveLength(1);
  });

  it("sends no completion notification to a stale assignee", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "SECRET: severance schedule",
      assigneeId: STRANGER_ID,
    });

    expect((await complete(taskId)).status).toBe(200);
    expect(await notificationsFor(d1, STRANGER_ID)).toEqual([]);
  });

  it("carries a valid assignee onto a spawned recurring instance and notifies them", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Recurring standup",
      assigneeId: TEST_USER_2.id,
      dueDate: new Date("2026-01-01"),
    });
    await makeRecurring(taskId);

    expect((await complete(taskId)).status).toBe(200);

    const child = await spawnedChildOf(d1, taskId);
    expect(child?.assigneeId).toBe(TEST_USER_2.id);

    const notes = await notificationsFor(d1, TEST_USER_2.id);
    // task_completed for the finished instance + task_assigned for the new one.
    expect(notes.map((n) => n.type).sort()).toEqual(["task_assigned", "task_completed"]);
  });

  /**
   * A recurring series outlives membership changes. Without filtering, an
   * offboarded assignee would be handed a fresh task — and its title — on every
   * cycle, forever.
   */
  it("spawns the next recurring instance UNASSIGNED when the assignee is stale, notifying nobody", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "SECRET: weekly layoff review",
      assigneeId: STRANGER_ID,
      dueDate: new Date("2026-01-01"),
    });
    await makeRecurring(taskId);

    expect((await complete(taskId)).status).toBe(200);

    const child = await spawnedChildOf(d1, taskId);
    expect(child).not.toBeNull();
    expect(child?.assigneeId).toBeNull();
    expect(await notificationsFor(d1, STRANGER_ID)).toEqual([]);
  });

  it("keeps the completion group move and spawn working while filtering (regression guard)", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Recurring with owner assignee",
      assigneeId: WS_OWNER_ID,
      dueDate: new Date("2026-01-01"),
    });
    await makeRecurring(taskId);

    const res = await complete(taskId);
    expect(res.status).toBe(200);
    const body = await res.json<{ task: { taskGroupId: string; completed: boolean } }>();
    expect(body.task.completed).toBe(true);
    expect(body.task.taskGroupId).toBe(completionGroupId);

    const child = await spawnedChildOf(d1, taskId);
    expect(child?.assigneeId).toBe(WS_OWNER_ID);
  });
});
