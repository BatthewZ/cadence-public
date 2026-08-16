/// <reference types="@cloudflare/workers-types" />
/**
 * End-to-end tests for the PAT binding policy on the routes that resolve
 * project access INLINE rather than through middleware.
 *
 * Why this file exists (multi-user audit, finding 09): three route families
 * carry neither `:projectId` nor `:taskId` in their URL —
 * `/subtasks/:subtaskId`, `/comments/:commentId` and
 * `/task-groups/:taskGroupId`. They therefore cannot mount
 * `requireProjectAccess` / `requireTaskAccess`, and used to discover the
 * owning project themselves via `resolveProjectAccess`, which answers only
 * "may this HUMAN reach this project?". They do mount the `task:*` scope
 * middleware, but capability scope is not project selection. The result was
 * that a Personal Access Token minted in workspace A and narrowed to a single
 * project could mutate subtasks, comments and task groups anywhere its owning
 * human happened to be a member — silently voiding the containment boundary
 * that is the whole reason to mint a narrow token, and contradicting the
 * invariant `authorize.ts` documents: the token is the workspace boundary,
 * not the user.
 *
 * These tests drive the REAL route modules (not just the handler functions)
 * against a real in-memory D1, because the bug was a wiring gap: a test that
 * called handlers directly with a hand-built context could pass while the
 * mounted route still leaked. The priming middleware below seeds exactly what
 * `middleware/auth.ts` seeds on a verified PAT request — `user`, `apiToken`
 * and `db` — and nothing else, so the routes run their own real guards.
 *
 * Every denial assertion is paired with a POST-CONDITION read: a 403 that
 * still wrote the row would be a worse bug than the one being fixed, and a
 * status-code-only assertion cannot tell the difference.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiToken } from "../../db/schema";
import type { AppEnv } from "../env";
import taskGroupRoutes from "../routes/task-groups/task-groups.routes";
import taskRoutes from "../routes/tasks/tasks.routes";
import {
  createTestD1,
  fakeAuth,
  fakePat,
  jsonRequest,
  seedComment,
  seedProject,
  seedProjectMember,
  seedSubtask,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;

/** Workspace A — TEST_USER is the owner. The token's home workspace. */
let wsA: string;
/** The one project workspace-A's narrow token is allowed to touch. */
let projSelected: string;
/** A sibling project in the SAME workspace, deliberately outside the list. */
let projSibling: string;

/** Workspace B — owned by TEST_USER_2, with TEST_USER as a member. */
let wsB: string;
/** A project in workspace B that TEST_USER administers. */
let projOther: string;

/** Task groups + parent tasks, one set per project. */
let groupSelected: string;
let groupSibling: string;
let groupOther: string;
let taskSelected: string;
let taskSibling: string;
let taskOther: string;

beforeAll(async () => {
  ({ d1, dispose } = await createTestD1());

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);

  // --- Workspace A: TEST_USER owns it, so they are elevated to admin on
  // every project in it. That elevation is exactly what made the bug
  // exploitable — the human check always passes here.
  wsA = await seedWorkspace(d1, TEST_USER.id, { name: "Workspace A" });
  projSelected = await seedProject(d1, wsA, { name: "Selected Project" });
  projSibling = await seedProject(d1, wsA, { name: "Sibling Project" });

  // --- Workspace B: a DIFFERENT workspace the same human also belongs to.
  // A token bound to workspace A must not reach in here, even though the
  // human's cookie session may.
  wsB = await seedWorkspace(d1, TEST_USER_2.id, { name: "Workspace B" });
  await seedWorkspaceMember(d1, wsB, TEST_USER.id, "member");
  projOther = await seedProject(d1, wsB, { name: "Other-Workspace Project" });
  await seedProjectMember(d1, projOther, TEST_USER.id, "admin");

  groupSelected = await seedTaskGroup(d1, projSelected, { name: "G-selected" });
  groupSibling = await seedTaskGroup(d1, projSibling, { name: "G-sibling" });
  groupOther = await seedTaskGroup(d1, projOther, { name: "G-other" });

  taskSelected = await seedTask(d1, projSelected, groupSelected);
  taskSibling = await seedTask(d1, projSibling, groupSibling);
  taskOther = await seedTask(d1, projOther, groupOther);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Token + app helpers
// ---------------------------------------------------------------------------

/**
 * Build a PAT row as `middleware/auth.ts` would hand it to downstream
 * middleware after a successful verification. Scopes are always the full
 * task triple so a scope failure can never be mistaken for a binding
 * failure — these tests are about project selection and workspace binding
 * only, and both denials share the same 403 status.
 */
function pat(overrides: Partial<ApiToken>): ApiToken {
  return fakePat({
    id: "tok_binding_test",
    workspaceId: wsA,
    name: "binding-test",
    scopes: JSON.stringify(["task:read", "task:write", "task:delete"]),
    ...overrides,
  });
}

/** A token bound to workspace A and narrowed to `projSelected` alone. */
const narrowToken = () =>
  pat({
    workspaceId: wsA,
    projectScope: "selected",
    projectIds: JSON.stringify([projSelected]),
  });

/** A token bound to workspace A with no project narrowing at all. */
const workspaceAToken = () => pat({ workspaceId: wsA, projectScope: "all" });

/**
 * Mount the real task + task-group route modules behind a middleware that
 * primes only what the auth middleware primes. `token: null` reproduces a
 * cookie session exactly (`auth.ts` always writes `apiToken: null` on the
 * session branch, so `null` means "this is a human").
 */
function appWith(token: ApiToken | null) {
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    fakeAuth(d1, TEST_USER, { apiToken: token, requestId: "pat-binding-test" }),
  );
  app.route("/", taskRoutes);
  app.route("/", taskGroupRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Post-condition readers — a 403 that still wrote is not a fix.
// ---------------------------------------------------------------------------

async function readSubtaskTitle(id: string): Promise<string | null> {
  const row = await d1
    .prepare("SELECT title FROM subtask WHERE id = ?")
    .bind(id)
    .first<{ title: string }>();
  return row?.title ?? null;
}

async function readCommentBody(id: string): Promise<string | null> {
  const row = await d1
    .prepare("SELECT body FROM comment WHERE id = ?")
    .bind(id)
    .first<{ body: string }>();
  return row?.body ?? null;
}

async function readGroupName(id: string): Promise<string | null> {
  const row = await d1
    .prepare("SELECT name FROM task_group WHERE id = ?")
    .bind(id)
    .first<{ name: string }>();
  return row?.name ?? null;
}

// ---------------------------------------------------------------------------
// Project selection: same workspace, project outside the token's list
// ---------------------------------------------------------------------------

describe("PAT project selection on inline-resolving routes", () => {
  it("refuses to PATCH a subtask in a project outside the token's selected list", async () => {
    const subtaskId = await seedSubtask(d1, taskSibling, { title: "untouched" });

    const res = await appWith(narrowToken()).request(
      `/subtasks/${subtaskId}`,
      jsonRequest("PATCH", `/subtasks/${subtaskId}`, { title: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await res.json<{ error: string }>()).toMatchObject({ error: "Forbidden" });
    // Post-condition: the write must not have landed.
    expect(await readSubtaskTitle(subtaskId)).toBe("untouched");
  });

  it("refuses to DELETE a subtask in a project outside the token's selected list", async () => {
    const subtaskId = await seedSubtask(d1, taskSibling, { title: "survivor" });

    const res = await appWith(narrowToken()).request(`/subtasks/${subtaskId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(await readSubtaskTitle(subtaskId)).toBe("survivor");
  });

  it("refuses to PATCH a comment in a project outside the token's selected list", async () => {
    // Authored by the token's OWN user — the author check passes, so only the
    // binding guard can stop this.
    const commentId = await seedComment(d1, taskSibling, TEST_USER.id, {
      body: "original",
    });

    const res = await appWith(narrowToken()).request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await readCommentBody(commentId)).toBe("original");
  });

  it("refuses to DELETE a comment the token's own user authored in an unselected project", async () => {
    // `deleteComment` once let the comment's own author skip the human project
    // check; that short-circuit is gone, but the author path is still the one a
    // naive PAT fix would miss, because it is the branch with the fewest human
    // checks left in front of the credential guard.
    const commentId = await seedComment(d1, taskSibling, TEST_USER.id, {
      body: "survivor",
    });

    const res = await appWith(narrowToken()).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(await readCommentBody(commentId)).toBe("survivor");
  });

  it("refuses to PATCH a task group in a project outside the token's selected list", async () => {
    const groupId = await seedTaskGroup(d1, projSibling, { name: "untouched" });

    const res = await appWith(narrowToken()).request(
      `/task-groups/${groupId}`,
      jsonRequest("PATCH", `/task-groups/${groupId}`, { name: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await readGroupName(groupId)).toBe("untouched");
  });

  it("refuses to reorder a task group in a project outside the token's selected list", async () => {
    const groupId = await seedTaskGroup(d1, projSibling, { name: "fixed", position: "a5" });

    const res = await appWith(narrowToken()).request(
      `/task-groups/${groupId}/reorder`,
      jsonRequest("PATCH", `/task-groups/${groupId}/reorder`, { position: "zz" }),
    );

    expect(res.status).toBe(403);
    const row = await d1
      .prepare("SELECT position FROM task_group WHERE id = ?")
      .bind(groupId)
      .first<{ position: string }>();
    expect(row?.position).toBe("a5");
  });

  it("refuses to DELETE a task group in a project outside the token's selected list", async () => {
    const groupId = await seedTaskGroup(d1, projSibling, { name: "survivor" });
    const target = await seedTaskGroup(d1, projSibling, { name: "target" });

    const res = await appWith(narrowToken()).request(
      `/task-groups/${groupId}?targetGroupId=${target}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(403);
    expect(await readGroupName(groupId)).toBe("survivor");
  });
});

// ---------------------------------------------------------------------------
// Workspace binding: token from workspace A, resource in workspace B
// ---------------------------------------------------------------------------

describe("PAT workspace binding on inline-resolving routes", () => {
  it("refuses a workspace-A token on a subtask in workspace B", async () => {
    // `projectScope: "all"` means "all projects in MY workspace". The human
    // IS a project admin in workspace B, so nothing but the workspace binding
    // can produce this denial.
    const subtaskId = await seedSubtask(d1, taskOther, { title: "untouched" });

    const res = await appWith(workspaceAToken()).request(
      `/subtasks/${subtaskId}`,
      jsonRequest("PATCH", `/subtasks/${subtaskId}`, { title: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await readSubtaskTitle(subtaskId)).toBe("untouched");
  });

  it("refuses a workspace-A token on a comment in workspace B", async () => {
    const commentId = await seedComment(d1, taskOther, TEST_USER.id, {
      body: "original",
    });

    const res = await appWith(workspaceAToken()).request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await readCommentBody(commentId)).toBe("original");
  });

  it("refuses a workspace-A token on a task group in workspace B", async () => {
    const groupId = await seedTaskGroup(d1, projOther, { name: "untouched" });

    const res = await appWith(workspaceAToken()).request(
      `/task-groups/${groupId}`,
      jsonRequest("PATCH", `/task-groups/${groupId}`, { name: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await readGroupName(groupId)).toBe("untouched");
  });
});

// ---------------------------------------------------------------------------
// The guard must not be a blanket deny
// ---------------------------------------------------------------------------

describe("a correctly scoped PAT still works", () => {
  it("PATCHes a subtask inside the token's selected project", async () => {
    const subtaskId = await seedSubtask(d1, taskSelected, { title: "before" });

    const res = await appWith(narrowToken()).request(
      `/subtasks/${subtaskId}`,
      jsonRequest("PATCH", `/subtasks/${subtaskId}`, { title: "after" }),
    );

    expect(res.status).toBe(200);
    expect(await readSubtaskTitle(subtaskId)).toBe("after");
  });

  it("PATCHes a comment inside the token's selected project", async () => {
    const commentId = await seedComment(d1, taskSelected, TEST_USER.id, {
      body: "before",
    });

    const res = await appWith(narrowToken()).request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "after" }),
    );

    expect(res.status).toBe(200);
    expect(await readCommentBody(commentId)).toBe("after");
  });

  it("PATCHes a task group inside the token's selected project", async () => {
    const groupId = await seedTaskGroup(d1, projSelected, { name: "before" });

    const res = await appWith(narrowToken()).request(
      `/task-groups/${groupId}`,
      jsonRequest("PATCH", `/task-groups/${groupId}`, { name: "after" }),
    );

    expect(res.status).toBe(200);
    expect(await readGroupName(groupId)).toBe("after");
  });

  it("DELETEs a subtask inside the token's selected project", async () => {
    const subtaskId = await seedSubtask(d1, taskSelected, { title: "doomed" });

    const res = await appWith(narrowToken()).request(`/subtasks/${subtaskId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await readSubtaskTitle(subtaskId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cookie sessions must be completely unaffected
// ---------------------------------------------------------------------------

describe("cookie sessions are unaffected by the PAT binding policy", () => {
  it("PATCHes a subtask in a project no token was ever scoped to", async () => {
    const subtaskId = await seedSubtask(d1, taskSibling, { title: "before" });

    const res = await appWith(null).request(
      `/subtasks/${subtaskId}`,
      jsonRequest("PATCH", `/subtasks/${subtaskId}`, { title: "after" }),
    );

    expect(res.status).toBe(200);
    expect(await readSubtaskTitle(subtaskId)).toBe("after");
  });

  it("PATCHes a comment in another workspace the human belongs to", async () => {
    const commentId = await seedComment(d1, taskOther, TEST_USER.id, {
      body: "before",
    });

    const res = await appWith(null).request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "after" }),
    );

    expect(res.status).toBe(200);
    expect(await readCommentBody(commentId)).toBe("after");
  });

  it("PATCHes and DELETEs a task group in another workspace the human belongs to", async () => {
    const groupId = await seedTaskGroup(d1, projOther, { name: "before" });

    const patchRes = await appWith(null).request(
      `/task-groups/${groupId}`,
      jsonRequest("PATCH", `/task-groups/${groupId}`, { name: "after" }),
    );
    expect(patchRes.status).toBe(200);
    expect(await readGroupName(groupId)).toBe("after");

    const deleteRes = await appWith(null).request(
      `/task-groups/${groupId}?targetGroupId=${groupOther}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);
    expect(await readGroupName(groupId)).toBeNull();
  });

  it("DELETEs a comment the human authored, with no token in play", async () => {
    const commentId = await seedComment(d1, taskSibling, TEST_USER.id, {
      body: "doomed",
    });

    const res = await appWith(null).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await readCommentBody(commentId)).toBeNull();
  });
});
