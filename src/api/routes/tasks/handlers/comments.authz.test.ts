/// <reference types="@cloudflare/workers-types" />
/**
 * Authorization tests for the comment mutation handlers.
 *
 * ## Why this file exists separately from `tasks.handlers.test.ts`
 *
 * These cases have to *revoke* access — delete a `workspace_member` or
 * `project_member` row and then act as the revoked user. `tasks.handlers.test.ts`
 * builds one D1 fixture in a single `beforeAll` and shares it across every
 * describe block in the file, so mutating membership there would silently
 * change the access surface for unrelated tests further down. This file owns
 * its own database and its own throwaway users.
 *
 * ## Why these cases matter
 *
 * `deleteComment` and `updateComment` are reached at `/comments/:commentId`,
 * a URL that carries no `:projectId` or `:taskId`, so no route middleware can
 * resolve project access for them — the handlers must do it themselves. Three
 * route families in this API share that shape and that risk: `/comments/:id`,
 * `/subtasks/:subtaskId`, and `/task-groups/:taskGroupId` (see
 * `pat-project-binding.test.ts`, which enumerates all three). `deleteComment`
 * is the one that actually did forget: access resolution lived *inside* the
 * non-author branch, so a user removed from the workspace could still delete their own
 * comments (a write, which also bumps the parent task's `updatedAt` for
 * everyone still in the project) while `updateComment` correctly refused the
 * same user on the same comment.
 *
 * Every denial case therefore asserts POST-CONDITIONS, not just the status
 * code: the comment row must still exist and the parent task's `updatedAt`
 * must be untouched. A handler that deleted the row and then returned 403
 * would pass a status-only assertion.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiToken } from "../../../../db/schema";
import { updateCommentSchema } from "../../../../shared/schemas/comment";
import type { AppEnv } from "../../../env";
import { validateBody } from "../../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  fakePat,
  jsonRequest,
  makeTestUser,
  seedComment,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
  type TestUserFixture,
} from "../../../test-utils";
import { deleteComment, updateComment } from "../tasks.handlers";

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------

/**
 * The three throwaway identities whose access is revoked mid-test. They are
 * built with the shared `makeTestUser` and seeded with the shared `seedUser`,
 * both of which take any `TestUserFixture` — the two canonical fixtures are not
 * a limit on who a test may invent.
 */

/** Author who will lose their workspace membership mid-test. */
const EX_WORKSPACE_USER = makeTestUser("ex-workspace-user-id", "Ex Workspace User");
/** Author who will lose their project membership but stay in the workspace. */
const EX_PROJECT_USER = makeTestUser("ex-project-user-id", "Ex Project User");
/** Author with the weakest project role that still grants access. */
const VIEWER_USER = makeTestUser("viewer-user-id", "Viewer User");

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let taskGroupId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  await seedUser(d1, EX_WORKSPACE_USER);
  await seedUser(d1, EX_PROJECT_USER);
  await seedUser(d1, VIEWER_USER);

  // TEST_USER owns the workspace, so `resolveProjectAccess` elevates them to
  // project admin via the workspace — our non-author admin.
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);

  // Plain workspace members: no elevation, so their project role is what
  // actually decides access.
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
  await seedWorkspaceMember(d1, workspaceId, EX_WORKSPACE_USER.id, "member");
  await seedWorkspaceMember(d1, workspaceId, EX_PROJECT_USER.id, "member");
  await seedWorkspaceMember(d1, workspaceId, VIEWER_USER.id, "member");

  await seedProjectMember(d1, projectId, TEST_USER_2.id, "member");
  await seedProjectMember(d1, projectId, EX_WORKSPACE_USER.id, "member");
  await seedProjectMember(d1, projectId, EX_PROJECT_USER.id, "member");
  await seedProjectMember(d1, projectId, VIEWER_USER.id, "viewer");

  taskGroupId = await seedTaskGroup(d1, projectId, { name: "To Do" });
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mount `deleteComment` behind an auth context for the given principal. */
function deleteApp(user: TestUserFixture) {
  const app = new Hono<AppEnv>();
  app.delete("/comments/:commentId", fakeAuth(d1, user), deleteComment);
  return app;
}

/**
 * Mount `deleteComment` behind an auth context that also carries a PAT,
 * exactly as `middleware/auth.ts` primes a verified-token request.
 */
function deleteAppWithToken(user: TestUserFixture, token: ApiToken) {
  const app = new Hono<AppEnv>();
  app.delete("/comments/:commentId", fakeAuth(d1, user, { apiToken: token }), deleteComment);
  return app;
}

/**
 * A PAT row shaped as the auth middleware hands it downstream. Scopes are the
 * full task triple so a scope failure can never be confused with a binding
 * failure — these two tests are about the workspace half of the binding only.
 */
function pat(overrides: Partial<ApiToken>): ApiToken {
  return fakePat({
    id: "tok_comment_authz",
    workspaceId,
    name: "comment-authz-test",
    scopes: JSON.stringify(["task:read", "task:write", "task:delete"]),
    ...overrides,
  });
}

/** Mount `updateComment` behind an auth context for the given principal. */
function patchApp(user: TestUserFixture) {
  const app = new Hono<AppEnv>();
  app.patch(
    "/comments/:commentId",
    fakeAuth(d1, user),
    validateBody(updateCommentSchema),
    updateComment,
  );
  return app;
}

async function commentExists(commentId: string): Promise<boolean> {
  const row = await d1
    .prepare("SELECT id FROM comment WHERE id = ?")
    .bind(commentId)
    .first<{ id: string }>();
  return row !== null;
}

async function readCommentBody(commentId: string): Promise<string | null> {
  const row = await d1
    .prepare("SELECT body FROM comment WHERE id = ?")
    .bind(commentId)
    .first<{ body: string }>();
  return row?.body ?? null;
}

async function readTaskUpdatedAt(taskId: string): Promise<number | null> {
  const row = await d1
    .prepare("SELECT updatedAt FROM task WHERE id = ?")
    .bind(taskId)
    .first<{ updatedAt: number }>();
  return row?.updatedAt ?? null;
}

/**
 * Seed a task plus one comment on it, authored by `authorId`.
 *
 * The task's `updatedAt` is backdated to 2020 on purpose. `task.updatedAt` is
 * stored in whole seconds, so a handler that wrote during the same second as
 * the seed would leave a "did updatedAt change?" assertion unable to fail.
 * Backdating makes any write by the handler (which stamps `Date.now()`)
 * differ by years, so the post-condition is genuinely falsifiable.
 */
const BACKDATED_UPDATED_AT_SEC = Math.floor(new Date("2020-01-01T00:00:00.000Z").getTime() / 1000);

async function seedTaskWithComment(authorId: string, label: string) {
  const taskId = await seedTask(d1, projectId, taskGroupId, { title: label });
  await d1
    .prepare("UPDATE task SET updatedAt = ? WHERE id = ?")
    .bind(BACKDATED_UPDATED_AT_SEC, taskId)
    .run();
  const commentId = await seedComment(d1, taskId, authorId, { body: label });
  return { taskId, commentId };
}

/** Remove a user's workspace membership. Idempotent, so tests stay independent. */
async function revokeWorkspaceMembership(userId: string) {
  await d1
    .prepare("DELETE FROM workspace_member WHERE workspaceId = ? AND userId = ?")
    .bind(workspaceId, userId)
    .run();
}

/** Remove a user's project membership. Idempotent, so tests stay independent. */
async function revokeProjectMembership(userId: string) {
  await d1
    .prepare("DELETE FROM project_member WHERE projectId = ? AND userId = ?")
    .bind(projectId, userId)
    .run();
}

// =========================================================================
// deleteComment — the author path must not bypass authorization
// =========================================================================

describe("deleteComment authorization", () => {
  it("allows an author who still has project access to delete their own comment", async () => {
    // The permissive half of the contract. A fix that simply denied more would
    // pass every negative case below; this pins that ordinary use still works.
    const { commentId } = await seedTaskWithComment(TEST_USER_2.id, "member deletes own");

    const res = await deleteApp(TEST_USER_2).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await commentExists(commentId)).toBe(false);
  });

  it("allows a project VIEWER to delete their own comment", async () => {
    // Deliberate anti-over-block check: `updateComment` lets any access level
    // edit their own words, so delete must not silently require member/admin
    // for authors. Viewer is the weakest role that still resolves to access.
    const { commentId } = await seedTaskWithComment(VIEWER_USER.id, "viewer deletes own");

    const res = await deleteApp(VIEWER_USER).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await commentExists(commentId)).toBe(false);
  });

  it("denies an author who has been removed from the workspace", async () => {
    // The reported hole, end to end: the `project_member` row survives the
    // removal (it is only cascaded on *user* deletion), so authorship plus a
    // stale project row was enough to delete before the fix.
    const { taskId, commentId } = await seedTaskWithComment(
      EX_WORKSPACE_USER.id,
      "ex-workspace author",
    );
    const updatedAtBefore = await readTaskUpdatedAt(taskId);

    await revokeWorkspaceMembership(EX_WORKSPACE_USER.id);

    const res = await deleteApp(EX_WORKSPACE_USER).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    // Post-conditions: nothing was written on the way to the refusal.
    expect(await commentExists(commentId)).toBe(true);
    expect(await readTaskUpdatedAt(taskId)).toBe(updatedAtBefore);
  });

  it("denies an author who has been removed from the project but is still in the workspace", async () => {
    // Narrower revocation than above, and the one a workspace-membership-only
    // check would miss: the user is a legitimate workspace member, just no
    // longer entitled to this project.
    const { taskId, commentId } = await seedTaskWithComment(
      EX_PROJECT_USER.id,
      "ex-project author",
    );
    const updatedAtBefore = await readTaskUpdatedAt(taskId);

    await revokeProjectMembership(EX_PROJECT_USER.id);

    const res = await deleteApp(EX_PROJECT_USER).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(await commentExists(commentId)).toBe(true);
    expect(await readTaskUpdatedAt(taskId)).toBe(updatedAtBefore);
  });

  it("allows a non-author project admin to delete someone else's comment", async () => {
    // Moderation must survive the fix. TEST_USER is the workspace owner and so
    // resolves to project admin.
    const { commentId } = await seedTaskWithComment(TEST_USER_2.id, "admin moderates");

    const res = await deleteApp(TEST_USER).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await commentExists(commentId)).toBe(false);
  });

  it("denies a non-author project member deleting someone else's comment", async () => {
    const { taskId, commentId } = await seedTaskWithComment(TEST_USER.id, "member cannot moderate");
    const updatedAtBefore = await readTaskUpdatedAt(taskId);

    const res = await deleteApp(TEST_USER_2).request(`/comments/${commentId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(await commentExists(commentId)).toBe(true);
    expect(await readTaskUpdatedAt(taskId)).toBe(updatedAtBefore);
  });
});

// =========================================================================
// deleteComment — the PAT guard still receives the right project identity
// =========================================================================

/**
 * The fix stopped joining `project` for `workspaceId` and now passes
 * `accessResult.project` straight to `enforceTokenProjectBinding`. Both values
 * are `project.workspaceId` for the same row, but nothing in the existing
 * suite pinned the workspace half of the binding on the DELETE path — the
 * cross-workspace comment test in `pat-project-binding.test.ts` exercises
 * PATCH only, and its DELETE test covers project *selection*, not workspace.
 *
 * The positive case below is the load-bearing one: a token whose workspace
 * genuinely matches must still be allowed, so a `workspaceId` that had been
 * dropped, blanked, or mis-sourced by the refactor would surface here as a
 * false 403. The negative case alone could pass for the wrong reason, since
 * any incorrect value would also fail to match.
 */
describe("deleteComment PAT workspace binding", () => {
  it("allows a token bound to the comment's own workspace", async () => {
    const { commentId } = await seedTaskWithComment(TEST_USER.id, "pat same workspace");

    const res = await deleteAppWithToken(TEST_USER, pat({ workspaceId })).request(
      `/comments/${commentId}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    expect(await commentExists(commentId)).toBe(false);
  });

  it("refuses a token bound to a different workspace", async () => {
    const { taskId, commentId } = await seedTaskWithComment(TEST_USER.id, "pat other workspace");
    const updatedAtBefore = await readTaskUpdatedAt(taskId);

    const res = await deleteAppWithToken(
      TEST_USER,
      pat({ workspaceId: "some-other-workspace-id" }),
    ).request(`/comments/${commentId}`, { method: "DELETE" });

    expect(res.status).toBe(403);
    expect(await commentExists(commentId)).toBe(true);
    expect(await readTaskUpdatedAt(taskId)).toBe(updatedAtBefore);
  });
});

// =========================================================================
// updateComment — the control that proved the asymmetry; keep it honest
// =========================================================================

describe("updateComment authorization", () => {
  it("denies an author who has been removed from the workspace", async () => {
    // This handler was already correct; the test locks that in so the pair
    // cannot drift apart again from the other direction.
    const { taskId, commentId } = await seedTaskWithComment(
      EX_WORKSPACE_USER.id,
      "ex-workspace author patch",
    );
    const updatedAtBefore = await readTaskUpdatedAt(taskId);

    // Re-assert the revocation rather than inheriting it from the describe
    // above — the helper is idempotent, and a test that only passes because of
    // an earlier test's side effect is not a test.
    await revokeWorkspaceMembership(EX_WORKSPACE_USER.id);

    const res = await patchApp(EX_WORKSPACE_USER).request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await readCommentBody(commentId)).toBe("ex-workspace author patch");
    expect(await readTaskUpdatedAt(taskId)).toBe(updatedAtBefore);
  });

  it("denies an author who has been removed from the project", async () => {
    const { taskId, commentId } = await seedTaskWithComment(
      EX_PROJECT_USER.id,
      "ex-project author patch",
    );
    const updatedAtBefore = await readTaskUpdatedAt(taskId);

    await revokeProjectMembership(EX_PROJECT_USER.id);

    const res = await patchApp(EX_PROJECT_USER).request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "hijacked" }),
    );

    expect(res.status).toBe(403);
    expect(await readCommentBody(commentId)).toBe("ex-project author patch");
    expect(await readTaskUpdatedAt(taskId)).toBe(updatedAtBefore);
  });
});
