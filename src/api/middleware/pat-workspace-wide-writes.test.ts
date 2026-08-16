/// <reference types="@cloudflare/workers-types" />
/**
 * PAT policy on the workspace-level routes whose EFFECT reaches into projects.
 *
 * ## Why this file exists separately from `pat-workspace-scope.test.ts`
 *
 * That file covers the reads, where the policy is *filter*: a narrowed token
 * simply sees fewer rows. The three routes here could not be covered there for
 * two different reasons.
 *
 * Two of them are destructive — they delete a whole workspace, or revoke a
 * member across every project in one — so they cannot share that file's single
 * seeded fixture without demolishing it for the tests that follow. Each test
 * below seeds its own workspace.
 *
 * More importantly the policy is different, and the difference is the point:
 *
 * | Route | Policy | Why not filter |
 * | --- | --- | --- |
 * | `DELETE /workspaces/:id` | refuse | Deleting only the token's projects is not a smaller "delete the workspace" — it is a different operation, and it leaves the workspace behind. |
 * | `DELETE /workspaces/:id/members/:userId` | refuse | The cascade is one all-or-nothing batch. Narrowing it revokes some project rows and leaves the workspace membership standing — the half-revoked user that audit finding 01 exists to prevent. Filtering here would reintroduce the original vulnerability in a new place. |
 * | `GET /workspaces` | filter by WORKSPACE binding | Not project scope at all. Every PAT is bound to one workspace at mint time, so this restricts for `projectScope: "all"` tokens too. |
 *
 * The gap these close: `DELETE /workspaces/:id` is the exact mirror of the
 * workspace export, which already answers 403 to a narrowed token. Export is a
 * *read* of the whole workspace; this is its *destruction*, and it was allowed.
 * A token that may not read a project must not be able to delete it.
 *
 * ## Test shape
 *
 * Assertions are on PERSISTED STATE, never on status alone. A 403 that had
 * already deleted the rows passes a status check, and that is the failure mode
 * the audit behind this work repeatedly found. Every refusal below therefore
 * counts the rows that must have survived, and every permitted call counts the
 * rows that must have gone.
 *
 * All three callers are exercised on every route — narrowed PAT, `all`-scope
 * PAT, and cookie session — because a guard that fired for humans would be a
 * worse regression than the hole being closed.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ApiToken } from "../../db/schema";
import type { AppEnv } from "../env";
import type { EmailMessage, EmailSendResult } from "../lib/email/types";

// Member removal fires a webhook whose delivery path builds an email service.
// Stub it so the real handler logic runs without touching SMTP.
const mockEmailSend = vi.fn<(msg: EmailMessage) => Promise<EmailSendResult>>(
  () => Promise.resolve({ id: "test-email-id" }),
);
vi.mock("../lib/email", () => ({
  createEmailService: vi.fn(() => ({ send: mockEmailSend })),
}));

import workspaceRoutes from "../routes/workspaces/workspaces.routes";
import {
  createTestD1,
  fakeAuth,
  fakePat,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";

let d1: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
});

afterAll(async () => {
  await dispose();
});

/**
 * This file's PAT, bound to `workspaceId`. Everything except identity comes
 * from the shared `fakePat` fixture — including the full read+write scope set,
 * which is load-bearing for the reason that fixture documents: a scope failure
 * and a binding failure both answer 403, so a token that is narrow on the scope
 * axis would let a test asserting 403 pass with the project-scope guard removed
 * entirely.
 */
function pat(workspaceId: string, overrides: Partial<ApiToken>): ApiToken {
  return fakePat({
    id: "tok_ws_wide",
    workspaceId,
    name: "ws-wide-test",
    ...overrides,
  });
}

/**
 * Mounts the REAL workspaces router rather than the handler functions. The bug
 * class here is a wiring gap — a handler-level test with a hand-built context
 * can pass while the mounted route is still reachable.
 */
function appWith(token: ApiToken | null) {
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    fakeAuth(d1, TEST_USER, { apiToken: token, requestId: "pat-ws-wide-test" }),
  );
  app.route("/", workspaceRoutes);
  return app;
}

/**
 * A workspace owned by TEST_USER with two projects — one the narrowed token
 * selects, one it must never reach — each carrying a task, plus TEST_USER_2 as
 * a member of the workspace and of both projects.
 *
 * The second project is what makes the assertions meaningful: without it a
 * narrowed token's reach and the workspace's contents would be the same set.
 */
async function seedFixture(slug: string) {
  const workspaceId = await seedWorkspace(d1, TEST_USER.id, {
    name: `WS ${slug}`,
    slug,
  });
  // `seedWorkspace` already writes the owner's `workspace_member` row, so only
  // the second member is added here.
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

  const selected = await seedProject(d1, workspaceId, { name: "Selected" });
  const denied = await seedProject(d1, workspaceId, { name: "Denied" });
  for (const projectId of [selected, denied]) {
    const groupId = await seedTaskGroup(d1, projectId);
    await seedTask(d1, projectId, groupId, { title: `task in ${projectId}` });
    await seedProjectMember(d1, projectId, TEST_USER_2.id, "member");
  }
  return { workspaceId, selected, denied };
}

const narrow = (workspaceId: string, projectId: string) =>
  pat(workspaceId, {
    id: "tok_narrow",
    projectScope: "selected",
    projectIds: JSON.stringify([projectId]),
  });

const all = (workspaceId: string) => pat(workspaceId, { id: "tok_all" });

/** Count rows so a refusal can be checked against state, not just status. */
async function counts(workspaceId: string) {
  const one = async (sql: string, ...binds: string[]) =>
    ((await d1.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0);
  return {
    workspaces: await one("SELECT COUNT(*) AS n FROM workspace WHERE id = ?", workspaceId),
    projects: await one(
      "SELECT COUNT(*) AS n FROM project WHERE workspaceId = ?",
      workspaceId,
    ),
    tasks: await one(
      "SELECT COUNT(*) AS n FROM task WHERE projectId IN (SELECT id FROM project WHERE workspaceId = ?)",
      workspaceId,
    ),
  };
}

describe("DELETE /workspaces/:workspaceId", () => {
  it("refuses a project-narrowed token, destroying nothing", async () => {
    const { workspaceId, selected } = await seedFixture("del-narrow");

    const res = await appWith(narrow(workspaceId, selected)).request(
      `/workspaces/${workspaceId}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(403);
    // The point of the finding: export already refused this token, while this
    // route — which destroys the same data — did not. Assert the data.
    expect(await counts(workspaceId)).toEqual({
      workspaces: 1,
      projects: 2,
      tasks: 2,
    });
  });

  it("still lets an all-scope token delete the workspace", async () => {
    const { workspaceId } = await seedFixture("del-all");

    const res = await appWith(all(workspaceId)).request(`/workspaces/${workspaceId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await counts(workspaceId)).toEqual({
      workspaces: 0,
      projects: 0,
      tasks: 0,
    });
  });

  it("still lets a cookie session delete the workspace", async () => {
    const { workspaceId } = await seedFixture("del-cookie");

    const res = await appWith(null).request(`/workspaces/${workspaceId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await counts(workspaceId)).toEqual({
      workspaces: 0,
      projects: 0,
      tasks: 0,
    });
  });
});

describe("DELETE /workspaces/:workspaceId/members/:userId", () => {
  /** The member's project rows across the WHOLE workspace, plus membership. */
  async function memberRows(workspaceId: string) {
    const one = async (sql: string, ...binds: string[]) =>
      ((await d1.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0);
    return {
      workspaceMember: await one(
        "SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ? AND userId = ?",
        workspaceId,
        TEST_USER_2.id,
      ),
      projectMember: await one(
        "SELECT COUNT(*) AS n FROM project_member WHERE userId = ? AND projectId IN (SELECT id FROM project WHERE workspaceId = ?)",
        TEST_USER_2.id,
        workspaceId,
      ),
    };
  }

  it("refuses a project-narrowed token, revoking nothing anywhere", async () => {
    const { workspaceId, selected } = await seedFixture("rm-narrow");

    const res = await appWith(narrow(workspaceId, selected)).request(
      `/workspaces/${workspaceId}/members/${TEST_USER_2.id}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(403);
    // Both project rows must survive — including the one INSIDE the token's
    // own selection. A partial cascade is the half-revoked state finding 01
    // was fixed to eliminate, so "revoked only the selected project" would be
    // a failure here, not a partial success.
    expect(await memberRows(workspaceId)).toEqual({
      workspaceMember: 1,
      projectMember: 2,
    });
  });

  it("still lets an all-scope token revoke across every project", async () => {
    const { workspaceId } = await seedFixture("rm-all");

    const res = await appWith(all(workspaceId)).request(
      `/workspaces/${workspaceId}/members/${TEST_USER_2.id}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    expect(await memberRows(workspaceId)).toEqual({
      workspaceMember: 0,
      projectMember: 0,
    });
  });

  it("still lets a cookie session revoke across every project", async () => {
    const { workspaceId } = await seedFixture("rm-cookie");

    const res = await appWith(null).request(
      `/workspaces/${workspaceId}/members/${TEST_USER_2.id}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    expect(await memberRows(workspaceId)).toEqual({
      workspaceMember: 0,
      projectMember: 0,
    });
  });
});

describe("GET /workspaces", () => {
  /**
   * The workspace binding, not project scope — so it must restrict an
   * `all`-scope token exactly as it restricts a narrowed one. That is why both
   * token cases are asserted rather than just the narrowed one: a fix applied
   * inside the project-scope helper would pass the narrowed case and leak on
   * `all`, which is the commoner token.
   */
  it("shows a token only the workspace it is bound to, whatever its project scope", async () => {
    const bound = await seedFixture("list-bound");
    const other = await seedFixture("list-other");

    for (const token of [narrow(bound.workspaceId, bound.selected), all(bound.workspaceId)]) {
      const res = await appWith(token).request("/workspaces");
      expect(res.status).toBe(200);
      const body = await res.json<{ workspaces: { id: string; name: string }[] }>();

      expect(body.workspaces.map((w) => w.id)).toEqual([bound.workspaceId]);
      // Names are the actual disclosure — another tenant's workspace name is
      // the thing a bound credential should never have been able to read.
      expect(JSON.stringify(body)).not.toContain(other.workspaceId);
      expect(JSON.stringify(body)).not.toContain("WS list-other");
    }
  });

  it("still shows a cookie session every workspace it belongs to", async () => {
    const a = await seedFixture("list-cookie-a");
    const b = await seedFixture("list-cookie-b");

    const res = await appWith(null).request("/workspaces");

    expect(res.status).toBe(200);
    const body = await res.json<{ workspaces: { id: string; memberCount: number }[] }>();
    const ids = body.workspaces.map((w) => w.id);
    expect(ids).toContain(a.workspaceId);
    expect(ids).toContain(b.workspaceId);
    // memberCount comes from a second query that is deliberately NOT filtered;
    // it is safe only because it is read by id from the filtered rows. Assert
    // it still resolves, so that reasoning stays exercised rather than assumed.
    expect(body.workspaces.find((w) => w.id === a.workspaceId)?.memberCount).toBe(2);
  });
});
