/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for workspace handler functions.
 *
 * Uses a real in-memory D1 database (via Miniflare) so every handler exercises
 * actual SQL through Drizzle ORM.
 *
 * ## What each block mounts, and why it is not uniform
 *
 * Most describe blocks mount only the handler under test with minimal
 * middleware (`fakeAuth` + `validateBody` where needed) and deliberately OMIT
 * the authorization middleware. That omission is the test condition, not a
 * shortcut: these handlers must fail closed on their own, so the case worth
 * exercising is precisely a caller who reaches them without
 * `requireWorkspaceRole` having run — a route wired up wrong, a new mount, an
 * internal caller. The governance block below depends on it to drive a
 * non-member straight into the handler.
 *
 * Two blocks add something on top of that baseline. The access-revocation
 * block still mounts `removeMember` bare, but stands a SECOND route beside it
 * carrying the real `requireProjectAccess()` guard, so an offboarding that
 * fails to revoke access is caught at the middleware as well as at the
 * resolver. The concurrency block swaps in a D1 wrapper (`racingD1`) that
 * lands an interfering write between a handler's read and its write, which is
 * the only way to exercise the compare-and-swap predicates from the outside.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../../../db";
import {
  createWorkspaceSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from "../../../shared/schemas/workspace";
import type { AppEnv } from "../../env";
import { resolveProjectAccess, resolveTaskAccess } from "../../lib/access";
import { requireProjectAccess } from "../../middleware/authorize";
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
  seedTeam,
  seedTeamMember,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
  type TestUserFixture,
} from "../../test-utils";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  updateMemberRole,
  updateWorkspace,
} from "./workspaces.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;

/**
 * The governance tests below need more than the two exported fixtures — an
 * owner, two peer admins, a plain member, an outsider and a bystander, all in
 * one workspace — so they mint their own identities with the shared
 * `makeTestUser` and seed them with the shared `seedUser`. Both take any
 * `TestUserFixture`; the canonical pair is a convenience, not a ceiling.
 */

const OWNER = makeTestUser("gov-owner", "Gov Owner");
const ADMIN_A = makeTestUser("gov-admin-a", "Gov Admin A");
const ADMIN_B = makeTestUser("gov-admin-b", "Gov Admin B");
const PLAIN_MEMBER = makeTestUser("gov-member", "Gov Member");
const OUTSIDER = makeTestUser("gov-outsider", "Gov Outsider");
/**
 * An uninvolved colleague who shares a workspace, a project and a team with
 * `PLAIN_MEMBER`. Exists so the cascade delete has a bystander to spare: with
 * only one collaborator in the fixture, "delete this member's rows" and
 * "delete every member's rows" produce identical, passing assertions.
 */
const BYSTANDER = makeTestUser("gov-bystander", "Gov Bystander");

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  for (const u of [OWNER, ADMIN_A, ADMIN_B, PLAIN_MEMBER, OUTSIDER, BYSTANDER]) {
    await seedUser(d1, u);
  }
});

afterAll(async () => {
  await dispose();
});

/**
 * Helper to call `app.request()` while injecting an empty env object so that
 * `c.env` is not `undefined` when `fakeAuth` tries to set `c.env.DB`.
 * Hono's Context assigns `this.env = options.env` which overwrites the default
 * `{}` with `undefined` when no env is supplied to `app.request()`.
 */
async function req(
  app: Hono<AppEnv>,
  input: string | Request,
): Promise<Response> {
  if (typeof input === "string") {
    return await app.request(input, undefined, {});
  }
  return await app.request(input, undefined, {});
}

// ---------------------------------------------------------------------------
// createWorkspace
// ---------------------------------------------------------------------------

describe("POST /workspaces — createWorkspace", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, TEST_USER));
    app.post("/workspaces", validateBody(createWorkspaceSchema), createWorkspace);
    return app;
  }

  it("creates a workspace and adds the creator as owner", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("POST", "/workspaces", {
        name: "My Workspace",
        slug: "my-workspace",
        description: "A test workspace",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ workspace: { id: string; name: string; slug: string; description: string | null; ownerId: string } }>();
    expect(body.workspace.name).toBe("My Workspace");
    expect(body.workspace.slug).toBe("my-workspace");
    expect(body.workspace.description).toBe("A test workspace");
    expect(body.workspace.ownerId).toBe(TEST_USER.id);

    // Verify the owner was added as a workspace member
    const memberRows = await d1
      .prepare(
        "SELECT * FROM workspace_member WHERE workspaceId = ? AND userId = ?",
      )
      .bind(body.workspace.id, TEST_USER.id)
      .all();
    expect(memberRows.results.length).toBe(1);
    expect(memberRows.results[0].role).toBe("owner");
  });

  it("creates a workspace without optional description", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("POST", "/workspaces", {
        name: "No Desc",
        slug: "no-desc",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ workspace: { description: string | null } }>();
    expect(body.workspace.description).toBeNull();
  });

  it("returns 400 when name is missing", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("POST", "/workspaces", {
        slug: "valid-slug",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { path: string }[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d: { path: string }) => d.path === "name")).toBe(true);
  });

  it("returns 400 when slug is missing", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("POST", "/workspaces", {
        name: "Valid Name",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { path: string }[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d: { path: string }) => d.path === "slug")).toBe(true);
  });

  it("returns 400 when slug has invalid characters", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("POST", "/workspaces", {
        name: "Valid Name",
        slug: "INVALID SLUG!",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { path: string }[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d: { path: string }) => d.path === "slug")).toBe(true);
  });

  it("returns 400 when body is empty", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("POST", "/workspaces", {}),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });
});

// ---------------------------------------------------------------------------
// listWorkspaces
// ---------------------------------------------------------------------------

describe("GET /workspaces — listWorkspaces", () => {
  function createApp(user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user));
    app.get("/workspaces", listWorkspaces);
    return app;
  }

  it("returns workspaces the user is a member of", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "List WS",
      slug: "list-ws",
    });

    const app = createApp();
    const res = await req(app, "/workspaces");

    expect(res.status).toBe(200);
    const body = await res.json<{ workspaces: { id: string; name: string; role: string }[] }>();
    expect(Array.isArray(body.workspaces)).toBe(true);
    const found = body.workspaces.find((ws: { id: string }) => ws.id === wsId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("List WS");
    expect(found!.role).toBe("owner");
  });

  it("does not return workspaces the user is not a member of", async () => {
    const privateWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Private WS",
      slug: "private-ws",
    });

    const app = createApp(TEST_USER_2);
    const res = await req(app, "/workspaces");

    expect(res.status).toBe(200);
    const body = await res.json<{ workspaces: { id: string }[] }>();
    const found = body.workspaces.find((ws: { id: string }) => ws.id === privateWsId);
    expect(found).toBeUndefined();
  });

  it("returns an empty list when user has no workspaces", async () => {
    const isolatedUserId = "isolated-user-id";
    await d1
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(isolatedUserId, "Isolated", "isolated@example.com", 0, Date.now(), Date.now())
      .run();

    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, {
        id: isolatedUserId,
        name: "Isolated",
        email: "isolated@example.com",
        emailVerified: false,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    app.get("/workspaces", listWorkspaces);

    const res = await req(app, "/workspaces");

    expect(res.status).toBe(200);
    const body = await res.json<{ workspaces: unknown[] }>();
    expect(body.workspaces).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getWorkspace
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId — getWorkspace", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-get", role: "owner" } }),
    );
    app.get("/workspaces/:workspaceId", getWorkspace);
    return app;
  }

  it("returns workspace details with member count", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Get WS",
      slug: "get-ws",
    });
    // Add a second member
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

    const app = createApp();
    const res = await req(app, `/workspaces/${wsId}`);

    expect(res.status).toBe(200);
    const body = await res.json<{ workspace: { id: string; name: string; memberCount: number } }>();
    expect(body.workspace.id).toBe(wsId);
    expect(body.workspace.name).toBe("Get WS");
    expect(body.workspace.memberCount).toBe(2);
  });

  it("returns 404 for a nonexistent workspace", async () => {
    const app = createApp();
    const res = await req(app, "/workspaces/nonexistent-id");

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Workspace not found");
  });
});

// ---------------------------------------------------------------------------
// updateWorkspace
// ---------------------------------------------------------------------------

describe("PATCH /workspaces/:workspaceId — updateWorkspace", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-update", role: "owner" } }),
    );
    app.patch(
      "/workspaces/:workspaceId",
      validateBody(updateWorkspaceSchema),
      updateWorkspace,
    );
    return app;
  }

  it("updates workspace name", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Old Name",
      slug: "old-name",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}`, {
        name: "New Name",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ workspace: { name: string } }>();
    expect(body.workspace.name).toBe("New Name");
  });

  it("updates workspace description", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Desc WS",
      slug: "desc-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}`, {
        description: "Updated description",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ workspace: { description: string | null } }>();
    expect(body.workspace.description).toBe("Updated description");
  });

  it("updates workspace slug", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Slug Update WS",
      slug: "slug-update-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}`, {
        slug: "new-slug",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ workspace: { slug: string } }>();
    expect(body.workspace.slug).toBe("new-slug");
  });

  it("returns 404 for a nonexistent workspace", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", "/workspaces/nonexistent-id", {
        name: "Doesn't matter",
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Workspace not found");
  });

  it("returns 400 for invalid slug format", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Bad Slug WS",
      slug: "bad-slug-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}`, {
        slug: "INVALID SLUG!!",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { path: string }[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d: { path: string }) => d.path === "slug")).toBe(true);
  });

  it("returns 400 when name is empty string", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Empty Name WS",
      slug: "empty-name-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}`, {
        name: "",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { path: string }[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d: { path: string }) => d.path === "name")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteWorkspace
// ---------------------------------------------------------------------------

describe("DELETE /workspaces/:workspaceId — deleteWorkspace", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-delete", role: "owner" } }),
    );
    app.delete("/workspaces/:workspaceId", deleteWorkspace);
    return app;
  }

  it("deletes a workspace", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Delete Me",
      slug: "delete-me",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("DELETE", `/workspaces/${wsId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify workspace is actually deleted
    const row = await d1
      .prepare("SELECT * FROM workspace WHERE id = ?")
      .bind(wsId)
      .first();
    expect(row).toBeNull();
  });

  /**
   * The delete against a workspace that actually contains something — the only
   * shape in which the handler's pre-delete of tasks does any work at all.
   *
   * `task.taskGroupId` is declared `onDelete: "restrict"`. Deleting a workspace
   * cascades workspace → project → task_group, and that cascade is BLOCKED the
   * moment a surviving task still points at one of those groups, so the handler
   * removes the workspace's tasks first, in the same batch, as a precondition
   * for the cascade rather than as a convenience. Against an empty workspace
   * that pre-delete is a no-op, which means a test that deletes an empty
   * workspace proves nothing about it: remove the `db.delete(task)` statement,
   * or reorder the batch so it runs after the workspace delete, and the suite
   * stays green while every real workspace — every workspace with a single
   * task in it — 500s on delete with SQLITE_CONSTRAINT. That is the account
   * closure path, and it would be broken for every customer who has ever used
   * the product.
   *
   * The child rows are then counted individually rather than inferred from the
   * 200. An orphaned `project_member` row is not inert: `resolveProjectAccess`
   * joins it against workspace membership, and a half-cascade that leaves
   * `project_member` behind while dropping `workspace_member` leaves rows that
   * a later re-invite could reanimate into access on a project the deleted
   * workspace used to own. "It returned 200" cannot see any of that.
   */
  it("deletes a populated workspace and every row beneath it", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Populated Delete",
      slug: "populated-delete",
    });
    // A second member, so the fixture has both a `workspace_member` and a
    // `project_member` row that are not the owner's.
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

    const projId = await seedProject(d1, wsId, { name: "Doomed Project" });
    await seedProjectMember(d1, projId, TEST_USER.id, "admin");
    await seedProjectMember(d1, projId, TEST_USER_2.id, "member");

    const groupId = await seedTaskGroup(d1, projId, { name: "To Do" });
    // The row that arms `onDelete: "restrict"` and makes this test different
    // from the empty-workspace one above.
    const taskId = await seedTask(d1, projId, groupId, { title: "Doomed Task" });

    // A second project, so the delete is exercised against the `inArray` of
    // project ids rather than a single-project special case.
    const otherProjId = await seedProject(d1, wsId, { name: "Doomed Project 2" });
    const otherGroupId = await seedTaskGroup(d1, otherProjId, { name: "Backlog" });
    await seedTask(d1, otherProjId, otherGroupId, { title: "Doomed Task 2" });

    const app = createApp();
    const res = await req(app, jsonRequest("DELETE", `/workspaces/${wsId}`));

    expect(res.status).toBe(200);
    expect((await res.json<{ ok: boolean }>()).ok).toBe(true);

    async function countRows(sql: string, ...binds: string[]): Promise<number> {
      const row = await d1.prepare(sql).bind(...binds).first<{ n: number }>();
      return row!.n;
    }

    expect(await countRows("SELECT COUNT(*) AS n FROM workspace WHERE id = ?", wsId)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ?", wsId)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM project WHERE workspaceId = ?", wsId)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM task_group WHERE projectId IN (?, ?)", projId, otherProjId)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM task WHERE projectId IN (?, ?)", projId, otherProjId)).toBe(0);
    // Counted explicitly: an orphan here still satisfies a membership join.
    expect(await countRows("SELECT COUNT(*) AS n FROM project_member WHERE projectId IN (?, ?)", projId, otherProjId)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM task WHERE id = ?", taskId)).toBe(0);
  });

  it("returns 200 even for nonexistent workspace (idempotent delete)", async () => {
    const app = createApp();
    const res = await req(
      app,
      jsonRequest("DELETE", "/workspaces/nonexistent-id"),
    );

    // The handler does a blind delete without checking existence first
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listMembers
// ---------------------------------------------------------------------------

describe("GET /workspaces/:workspaceId/members — listMembers", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-list", role: "owner" } }),
    );
    app.get("/workspaces/:workspaceId/members", listMembers);
    return app;
  }

  it("returns all members of the workspace with user details", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Members WS",
      slug: "members-ws",
    });
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

    const app = createApp();
    const res = await req(app, `/workspaces/${wsId}/members`);

    expect(res.status).toBe(200);
    const body = await res.json<{ members: { userId: string; role: string; user: { name: string; email: string } }[] }>();
    expect(body.members.length).toBe(2);

    const owner = body.members.find((m: { userId: string }) => m.userId === TEST_USER.id);
    expect(owner).toBeDefined();
    expect(owner!.role).toBe("owner");
    expect(owner!.user.name).toBe(TEST_USER.name);
    expect(owner!.user.email).toBe(TEST_USER.email);

    const member = body.members.find((m: { userId: string }) => m.userId === TEST_USER_2.id);
    expect(member).toBeDefined();
    expect(member!.role).toBe("member");
    expect(member!.user.name).toBe(TEST_USER_2.name);
  });

  it("returns an empty array for a workspace with no members", async () => {
    // Insert a workspace row directly without any members
    const wsId = crypto.randomUUID();
    await d1
      .prepare(
        "INSERT INTO workspace (id, name, slug, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(wsId, "Empty Members WS", "empty-members-ws", TEST_USER.id, Date.now(), Date.now())
      .run();

    const app = createApp();
    const res = await req(app, `/workspaces/${wsId}/members`);

    expect(res.status).toBe(200);
    const body = await res.json<{ members: unknown[] }>();
    expect(body.members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateMemberRole
// ---------------------------------------------------------------------------

describe("PATCH /workspaces/:workspaceId/members/:userId — updateMemberRole", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-role", role: "owner" } }),
    );
    app.patch(
      "/workspaces/:workspaceId/members/:userId",
      validateBody(updateMemberRoleSchema),
      updateMemberRole,
    );
    return app;
  }

  it("changes a member's role from member to admin", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Role Change WS",
      slug: "role-change-ws",
    });
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}/members/${TEST_USER_2.id}`, {
        role: "admin",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ member: { role: string; userId: string } }>();
    expect(body.member.role).toBe("admin");
    expect(body.member.userId).toBe(TEST_USER_2.id);
  });

  it("changes a member's role from admin to member", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Admin Demote WS",
      slug: "admin-demote-ws",
    });
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "admin");

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}/members/${TEST_USER_2.id}`, {
        role: "member",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ member: { role: string } }>();
    expect(body.member.role).toBe("member");
  });

  it("returns 403 when trying to change the owner's role", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Owner Role WS",
      slug: "owner-role-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}/members/${TEST_USER.id}`, {
        role: "admin",
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Cannot change the owner's role");
  });

  it("returns 404 when the target user is not a member", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Not Member WS",
      slug: "not-member-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}/members/nonexistent-user-id`, {
        role: "admin",
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Member not found");
  });

  it("returns 400 for an invalid role value", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Bad Role WS",
      slug: "bad-role-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}/members/${TEST_USER_2.id}`, {
        role: "superadmin",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { path: string }[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d: { path: string }) => d.path === "role")).toBe(true);
  });

  it("returns 400 when role is missing", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Missing Role WS",
      slug: "missing-role-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("PATCH", `/workspaces/${wsId}/members/${TEST_USER_2.id}`, {}),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });
});

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe("DELETE /workspaces/:workspaceId/members/:userId — removeMember", () => {
  /**
   * No `workspaceMembership` override is passed to `fakeAuth`: `removeMember`
   * resolves the actor's role from the database, deliberately, so that the
   * hierarchy cannot be spoofed by a context value a middleware forgot to
   * set. Seeding the row is what decides the actor's rank here.
   */
  function createApp(user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user));
    app.delete("/workspaces/:workspaceId/members/:userId", removeMember);
    return app;
  }

  it("removes a member from the workspace", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Remove Member WS",
      slug: "remove-member-ws",
    });
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("DELETE", `/workspaces/${wsId}/members/${TEST_USER_2.id}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify member was actually removed
    const row = await d1
      .prepare(
        "SELECT * FROM workspace_member WHERE workspaceId = ? AND userId = ?",
      )
      .bind(wsId, TEST_USER_2.id)
      .first();
    expect(row).toBeNull();
  });

  it("returns 403 when an admin tries to remove the workspace owner", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Cannot Remove Owner WS",
      slug: "cannot-remove-owner-ws",
    });
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "admin");

    const app = createApp(TEST_USER_2);
    const res = await req(
      app,
      jsonRequest("DELETE", `/workspaces/${wsId}/members/${TEST_USER.id}`),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Cannot remove the workspace owner");

    // Post-condition: the sole owner is still there. A workspace with no
    // owner row is unrecoverable — `workspace.ownerId` is never reassigned.
    const ownerRow = await d1
      .prepare("SELECT * FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, TEST_USER.id)
      .first();
    expect(ownerRow).not.toBeNull();
  });

  /**
   * Ordering regression: self-removal is reported before the owner guard.
   * Both conditions hold when an owner targets their own row, and the owner
   * message ("Cannot remove the workspace owner") is the wrong explanation
   * for it — the reason is that nobody may remove themselves. The owner is
   * still not removed either way, which the row assertion pins.
   */
  it("tells an owner removing themselves it is self-removal, not owner protection", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Owner Self Remove WS",
      slug: "owner-self-remove-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("DELETE", `/workspaces/${wsId}/members/${TEST_USER.id}`),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Cannot remove yourself from the workspace");

    const ownerRow = await d1
      .prepare("SELECT * FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, TEST_USER.id)
      .first();
    expect(ownerRow).not.toBeNull();
  });

  it("returns 400 when trying to remove yourself", async () => {
    // TEST_USER_2 is an admin trying to remove themselves
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Self Remove WS",
      slug: "self-remove-ws",
    });
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "admin");

    const app = createApp(TEST_USER_2);
    const res = await req(
      app,
      jsonRequest("DELETE", `/workspaces/${wsId}/members/${TEST_USER_2.id}`),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Cannot remove yourself from the workspace");
  });

  it("returns 404 when the target user is not a member", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Not Found Remove WS",
      slug: "not-found-remove-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("DELETE", `/workspaces/${wsId}/members/nonexistent-user-id`),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Member not found");
  });
});

// ---------------------------------------------------------------------------
// removeMember — access revocation post-conditions
// ---------------------------------------------------------------------------

/**
 * These are the tests the audit asked for by name.
 *
 * The pre-existing removeMember tests all asserted the mutation returned 200
 * and that the `workspace_member` row was gone — and every one of them passed
 * while a removed user still had full read, write and CSV export on every
 * project they belonged to. Status codes and the row that was explicitly
 * deleted are the two things a broken offboarding path gets right. So these
 * assert the *post-condition* instead: after the removal, does the access
 * layer still let this person in?
 *
 * `resolveProjectAccess` / `resolveTaskAccess` are checked directly (they are
 * the single source of truth every protected endpoint funnels through) AND
 * through a route mounted with the real `requireProjectAccess()` guard, so a
 * regression that only reopens the middleware path is caught too.
 */
describe("DELETE /workspaces/:workspaceId/members/:userId — revokes downstream access", () => {
  function removeApp(actor: TestUserFixture) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, actor));
    app.delete("/workspaces/:workspaceId/members/:userId", removeMember);
    return app;
  }

  /** A project route carrying the production authorization guard. */
  function guardedProjectApp(actor: TestUserFixture) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, actor));
    app.get("/projects/:projectId", requireProjectAccess(), (c) => c.json({ ok: true }));
    return app;
  }

  /**
   * A collaborator wired up the way a real one is: in the workspace, on a
   * project (with a task), and in a team.
   */
  async function seedCollaborator(name: string) {
    const workspaceId = await seedWorkspace(d1, OWNER.id, { name });
    const projectId = await seedProject(d1, workspaceId, { name: `${name} Project` });
    const taskGroupId = await seedTaskGroup(d1, projectId);
    const taskId = await seedTask(d1, projectId, taskGroupId);
    const teamId = await seedTeam(d1, workspaceId, { name: `${name} Team` });

    await seedWorkspaceMember(d1, workspaceId, PLAIN_MEMBER.id, "member");
    await seedProjectMember(d1, projectId, PLAIN_MEMBER.id, "member");
    await seedTeamMember(d1, teamId, PLAIN_MEMBER.id);

    return { workspaceId, projectId, taskId, teamId };
  }

  async function countRow(sql: string, ...binds: string[]): Promise<number> {
    const row = await d1.prepare(sql).bind(...binds).first<{ n: number }>();
    return row?.n ?? 0;
  }

  it("leaves the removed member with no project access, no task access and no team membership", async () => {
    const { workspaceId, projectId, taskId, teamId } = await seedCollaborator("Offboarding WS");
    const db = createDb(d1);

    // Baseline. Without this the post-conditions could pass for the wrong
    // reason — a mistyped id also resolves to "no access".
    expect(await resolveProjectAccess(db, projectId, PLAIN_MEMBER.id)).not.toBeNull();
    const beforeRoute = await guardedProjectApp(PLAIN_MEMBER).request(
      `/projects/${projectId}`,
      undefined,
      {},
    );
    expect(beforeRoute.status).toBe(200);

    const res = await req(
      removeApp(OWNER),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );
    expect(res.status).toBe(200);

    // The access layer. Note the layer attribution: these two assertions are
    // satisfied by the `access.ts` guard ALONE, so they stay green even with
    // the cascade deletes reverted. It is the row counts further down that
    // kill a broken cascade. Both are kept deliberately — together they pin
    // the two independent layers this fix is built from.
    expect(await resolveProjectAccess(db, projectId, PLAIN_MEMBER.id)).toBeNull();
    expect(await resolveTaskAccess(db, taskId, PLAIN_MEMBER.id)).toEqual({
      found: true,
      access: null,
    });

    // The guard as mounted in production.
    const afterRoute = await guardedProjectApp(PLAIN_MEMBER).request(
      `/projects/${projectId}`,
      undefined,
      {},
    );
    expect(afterRoute.status).toBe(403);

    // And the rows themselves are gone, so the ex-member also stops showing
    // up in team rosters and member counts (finding 11).
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM project_member WHERE projectId = ? AND userId = ?",
        projectId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(0);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM team_member WHERE teamId = ? AND userId = ?",
        teamId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(0);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ? AND userId = ?",
        workspaceId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(0);
  });

  it("does not touch the same user's memberships in other workspaces", async () => {
    const removed = await seedCollaborator("Blast Radius WS A");
    const kept = await seedCollaborator("Blast Radius WS B");
    const db = createDb(d1);

    const res = await req(
      removeApp(OWNER),
      jsonRequest("DELETE", `/workspaces/${removed.workspaceId}/members/${PLAIN_MEMBER.id}`),
    );
    expect(res.status).toBe(200);

    expect(await resolveProjectAccess(db, removed.projectId, PLAIN_MEMBER.id)).toBeNull();

    // The second workspace is untouched — the subquery scoping is what makes
    // this true, and a `DELETE … WHERE userId = ?` without it would not.
    const stillThere = await resolveProjectAccess(db, kept.projectId, PLAIN_MEMBER.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.role).toBe("member");
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM team_member WHERE teamId = ? AND userId = ?",
        kept.teamId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(1);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ? AND userId = ?",
        kept.workspaceId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(1);
  });

  it("removes a member cleanly from a workspace that has no projects or teams", async () => {
    // The cascade deletes run against empty subqueries here; a batch that
    // errors on the empty case would break ordinary offboarding.
    const workspaceId = await seedWorkspace(d1, OWNER.id, { name: "Bare WS" });
    await seedWorkspaceMember(d1, workspaceId, PLAIN_MEMBER.id, "member");

    const res = await req(
      removeApp(OWNER),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );

    expect(res.status).toBe(200);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ? AND userId = ?",
        workspaceId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(0);
  });

  /**
   * The scoping half of the cascade, which every other test above is blind to.
   *
   * Those tests all seed exactly one collaborator, so "delete this member's
   * project and team rows" and "delete EVERY member's project and team rows in
   * this workspace" produce identical results. That is not hypothetical: a
   * refuter mutated the handler to drop `eq(projectMember.userId, …)` and
   * `eq(teamMember.userId, …)`, turning one offboarding into a workspace-wide
   * wipe of project and team membership, and all 43 tests still passed.
   *
   * A bystander is the only thing that can tell the two apart. `BYSTANDER`
   * shares the workspace, the project and the team with the member being
   * removed, and must come through it with every row and every grant intact —
   * asserted through `resolveProjectAccess` and the real `requireProjectAccess`
   * guard as well as the raw rows, because a wipe that the resolver silently
   * papered over would be just as much a regression.
   */
  it("leaves a bystander on the same project and team untouched", async () => {
    const { workspaceId, projectId, teamId } = await seedCollaborator("Bystander WS");
    await seedWorkspaceMember(d1, workspaceId, BYSTANDER.id, "member");
    await seedProjectMember(d1, projectId, BYSTANDER.id, "member");
    await seedTeamMember(d1, teamId, BYSTANDER.id);
    const db = createDb(d1);

    // Baseline, so a passing post-condition cannot be the result of the
    // bystander never having had access in the first place.
    expect(await resolveProjectAccess(db, projectId, BYSTANDER.id)).not.toBeNull();

    const res = await req(
      removeApp(OWNER),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );
    expect(res.status).toBe(200);

    // The member actually targeted is gone — otherwise this test could pass
    // against a handler that deletes nothing at all.
    expect(await resolveProjectAccess(db, projectId, PLAIN_MEMBER.id)).toBeNull();

    // …and the bystander still has every row and every grant.
    const bystanderAccess = await resolveProjectAccess(db, projectId, BYSTANDER.id);
    expect(bystanderAccess).not.toBeNull();
    expect(bystanderAccess!.role).toBe("member");

    const guarded = await guardedProjectApp(BYSTANDER).request(
      `/projects/${projectId}`,
      undefined,
      {},
    );
    expect(guarded.status).toBe(200);

    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM project_member WHERE projectId = ? AND userId = ?",
        projectId,
        BYSTANDER.id,
      ),
    ).toBe(1);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM team_member WHERE teamId = ? AND userId = ?",
        teamId,
        BYSTANDER.id,
      ),
    ).toBe(1);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ? AND userId = ?",
        workspaceId,
        BYSTANDER.id,
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Member governance — actor/target role hierarchy
// ---------------------------------------------------------------------------

/**
 * `requireWorkspaceRole("owner", "admin")` asks "is the caller privileged?",
 * never "is the caller more privileged than their target?". Without the rank
 * comparison any admin could demote or remove any peer admin, so one freshly
 * promoted admin could strip every other admin with no owner involvement.
 *
 * Each test asserts the stored role or row as well as the status, because a
 * handler that returns 403 and mutates anyway is the failure mode a
 * status-only assertion cannot see.
 */
describe("member governance — actor must outrank target", () => {
  function govApp(actor: TestUserFixture) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, actor));
    app.patch(
      "/workspaces/:workspaceId/members/:userId",
      validateBody(updateMemberRoleSchema),
      updateMemberRole,
    );
    app.delete("/workspaces/:workspaceId/members/:userId", removeMember);
    return app;
  }

  /** Owner + two peer admins + one plain member, all in one workspace. */
  async function seedGovWorkspace(name: string): Promise<string> {
    const workspaceId = await seedWorkspace(d1, OWNER.id, { name });
    await seedWorkspaceMember(d1, workspaceId, ADMIN_A.id, "admin");
    await seedWorkspaceMember(d1, workspaceId, ADMIN_B.id, "admin");
    await seedWorkspaceMember(d1, workspaceId, PLAIN_MEMBER.id, "member");
    return workspaceId;
  }

  async function storedRole(workspaceId: string, userId: string): Promise<string | null> {
    const row = await d1
      .prepare("SELECT role FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(workspaceId, userId)
      .first<{ role: string }>();
    return row?.role ?? null;
  }

  it("rejects an admin demoting a peer admin", async () => {
    const workspaceId = await seedGovWorkspace("Peer Demote WS");

    const res = await req(
      govApp(ADMIN_A),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${ADMIN_B.id}`, {
        role: "member",
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Only the workspace owner can change an admin's role");
    expect(await storedRole(workspaceId, ADMIN_B.id)).toBe("admin");
  });

  it("rejects an admin removing a peer admin", async () => {
    const workspaceId = await seedGovWorkspace("Peer Remove WS");

    const res = await req(
      govApp(ADMIN_A),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${ADMIN_B.id}`),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Only the workspace owner can remove an admin");
    expect(await storedRole(workspaceId, ADMIN_B.id)).toBe("admin");
  });

  it("rejects an admin changing their own role", async () => {
    const workspaceId = await seedGovWorkspace("Self Role WS");

    const res = await req(
      govApp(ADMIN_A),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${ADMIN_A.id}`, {
        role: "member",
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json<{ error: string }>()).error).toBe(
      "Only the workspace owner can change an admin's role",
    );
    expect(await storedRole(workspaceId, ADMIN_A.id)).toBe("admin");
  });

  /**
   * The creation side of the admin tier, which the rank comparison alone does
   * not cover.
   *
   * `outranks` stops an admin from demoting a peer admin, so only the owner
   * can take the role away. If an admin could still hand it out, that is not a
   * hierarchy — it is a one-way ratchet: every admin they mint is immediately
   * immune to every admin including their creator, and only the owner can
   * reverse any of it. This test is the one that fails if promotion is ever
   * reopened to admins, and it asserts the STORED role because a handler that
   * returns 403 and writes anyway is precisely what a status-only assertion
   * cannot see.
   */
  it("rejects an admin promoting a plain member to admin", async () => {
    const workspaceId = await seedGovWorkspace("Admin Cannot Mint Admin WS");

    const promote = await req(
      govApp(ADMIN_A),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`, {
        role: "admin",
      }),
    );

    expect(promote.status).toBe(403);
    expect((await promote.json<{ error: string }>()).error).toBe(
      "Only the workspace owner can grant the admin role",
    );
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("member");

    // And the target is still an ordinary member afterwards, so the admin can
    // still remove them: the failed promotion gained the target no protection
    // it did not already have, and left the admin's existing powers intact.
    const removeStillAllowed = await req(
      govApp(ADMIN_A),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );
    expect(removeStillAllowed.status).toBe(200);
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBeNull();
  });

  /**
   * Pins the ORDER of the two 403s, which is a real UX decision and not an
   * accident of how the file reads.
   *
   * The members UI pre-selects the target's current role, so an admin who
   * opens the role dialog on a peer admin and submits it unchanged sends
   * `role: "admin"` — a request that trips both rules at once. Whichever check
   * runs first decides what they are told. The binding constraint on that
   * caller is that they may not touch an admin at all, not that they may not
   * hand out the role, so the rank comparison must answer first. Without this
   * test, moving the grant guard one block earlier is an invisible regression
   * in the only message the user ever sees.
   */
  it("tells an admin submitting the unchanged role on a peer admin the rule that actually binds them", async () => {
    const workspaceId = await seedGovWorkspace("Peer Admin Message WS");

    const res = await req(
      govApp(ADMIN_A),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${ADMIN_B.id}`, {
        role: "admin",
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json<{ error: string }>()).error).toBe(
      "Only the workspace owner can change an admin's role",
    );
    expect(await storedRole(workspaceId, ADMIN_B.id)).toBe("admin");
  });

  it("lets the owner promote a plain member to admin", async () => {
    // The counterpart to the test above: the capability moved to the owner,
    // it did not disappear. Without this, deleting the promotion path
    // entirely would also pass.
    const workspaceId = await seedGovWorkspace("Owner Mints Admin WS");

    const promote = await req(
      govApp(OWNER),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`, {
        role: "admin",
      }),
    );

    expect(promote.status).toBe(200);
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("admin");

    // …and the freshly minted admin is off-limits to peer admins, which is
    // the whole point of the hierarchy.
    const removeNowPeer = await req(
      govApp(ADMIN_A),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );
    expect(removeNowPeer.status).toBe(403);
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("admin");
  });

  it("still lets an admin write the member role onto a plain member", async () => {
    // The `admin`-grant guard must key on the role being GRANTED, not fire on
    // every role write an admin makes. `member` is the only value left in the
    // enum, so if this regressed to a blanket "admins cannot PATCH roles" the
    // check would be indistinguishable from the rank comparison.
    const workspaceId = await seedGovWorkspace("Admin Writes Member Role WS");

    const res = await req(
      govApp(ADMIN_A),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`, {
        role: "member",
      }),
    );

    expect(res.status).toBe(200);
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("member");
  });

  it("lets an admin remove a plain member", async () => {
    const workspaceId = await seedGovWorkspace("Admin Removes Member WS");

    const res = await req(
      govApp(ADMIN_A),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );

    expect(res.status).toBe(200);
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBeNull();
  });

  it("keeps every owner power intact: demote an admin, remove an admin, remove a member", async () => {
    const workspaceId = await seedGovWorkspace("Owner Powers WS");
    const owner = govApp(OWNER);

    const demote = await req(
      owner,
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${ADMIN_A.id}`, {
        role: "member",
      }),
    );
    expect(demote.status).toBe(200);
    expect(await storedRole(workspaceId, ADMIN_A.id)).toBe("member");

    const removeAdmin = await req(
      owner,
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${ADMIN_B.id}`),
    );
    expect(removeAdmin.status).toBe(200);
    expect(await storedRole(workspaceId, ADMIN_B.id)).toBeNull();

    const removeMemberRes = await req(
      owner,
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );
    expect(removeMemberRes.status).toBe(200);
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBeNull();
  });

  it("still refuses to demote or remove the sole owner", async () => {
    const workspaceId = await seedGovWorkspace("Owner Protection WS");

    const demote = await req(
      govApp(ADMIN_A),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${OWNER.id}`, {
        role: "member",
      }),
    );
    expect(demote.status).toBe(403);
    expect((await demote.json<{ error: string }>()).error).toBe(
      "Cannot change the owner's role",
    );

    const remove = await req(
      govApp(ADMIN_A),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${OWNER.id}`),
    );
    expect(remove.status).toBe(403);
    expect((await remove.json<{ error: string }>()).error).toBe(
      "Cannot remove the workspace owner",
    );

    expect(await storedRole(workspaceId, OWNER.id)).toBe("owner");
  });

  it("fails closed for a caller who holds no membership in the workspace", async () => {
    // Unreachable behind `requireWorkspaceRole`, which these handler-only
    // tests deliberately omit — that omission is exactly why the handler must
    // not rely on the middleware having run.
    const workspaceId = await seedGovWorkspace("No Membership Actor WS");

    const patch = await req(
      govApp(OUTSIDER),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`, {
        role: "admin",
      }),
    );
    expect(patch.status).toBe(403);
    expect((await patch.json<{ error: string }>()).error).toBe("Forbidden");
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("member");

    const del = await req(
      govApp(OUTSIDER),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );
    expect(del.status).toBe(403);
    expect((await del.json<{ error: string }>()).error).toBe("Forbidden");
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("member");
  });

  /**
   * The fail-closed check runs BEFORE the owner guard in both handlers. If it
   * ran after, a non-member would get "Cannot change the owner's role" /
   * "Cannot remove the workspace owner" — which confirms to an outsider which
   * account owns the workspace. Same 403 either way, so only the message
   * distinguishes the correct ordering; asserting it is the whole point.
   */
  it("tells a non-member nothing about the roster, even when targeting the owner", async () => {
    const workspaceId = await seedGovWorkspace("Outsider Targets Owner WS");

    const patch = await req(
      govApp(OUTSIDER),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${OWNER.id}`, {
        role: "member",
      }),
    );
    expect(patch.status).toBe(403);
    expect((await patch.json<{ error: string }>()).error).toBe("Forbidden");

    const del = await req(
      govApp(OUTSIDER),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${OWNER.id}`),
    );
    expect(del.status).toBe(403);
    expect((await del.json<{ error: string }>()).error).toBe("Forbidden");

    expect(await storedRole(workspaceId, OWNER.id)).toBe("owner");
  });
});

// ---------------------------------------------------------------------------
// Member governance — compare-and-swap under a concurrent role change
// ---------------------------------------------------------------------------

/**
 * Wraps a D1 binding so that an interfering write lands between the FIRST
 * statement a caller executes and the moment that statement's result is
 * handed back.
 *
 * ## Why the test needs this at all
 *
 * Both member handlers read the actor's and target's roles in one statement,
 * decide, and then write. The write carries the observed role as a predicate
 * so the decision cannot be applied to a row that has since moved. Nothing
 * reachable from outside the handler can exercise that predicate: seeded data
 * never changes mid-request, so every existing test hits the happy path where
 * the role is exactly what was read. A mutant that deletes the predicate
 * passes the whole suite. This wrapper is the seam that makes the race
 * deterministic rather than timing-dependent — the interfering write is
 * *guaranteed* to commit inside the window, on every run, on one thread.
 *
 * ## Why it stops wrapping after the first statement
 *
 * `prepare` is only intercepted while the interference is still pending. Once
 * it has fired, statements come back unwrapped, so the statements Drizzle
 * hands to `D1Database.batch()` are the real objects that implementation
 * expects — a batch of Proxies is not something worth betting the test suite
 * on. The first statement a handler runs is always `loadActorAndTarget`'s
 * SELECT, which is exactly the read the race must invalidate.
 */
function racingD1(base: D1Database, interfere: () => Promise<void>): D1Database {
  let fired = false;

  async function fire(): Promise<void> {
    if (fired) return;
    fired = true;
    await interfere();
  }

  function wrapStatement(stmt: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(stmt, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        const fn = (value as (...args: unknown[]) => unknown).bind(target);
        // `bind` returns another statement, which must stay wrapped; every
        // other method is an execution, after which the interference fires.
        if (prop === "bind") {
          return (...args: unknown[]) =>
            wrapStatement(fn(...args) as D1PreparedStatement);
        }
        return async (...args: unknown[]) => {
          const result = await fn(...args);
          await fire();
          return result;
        };
      },
    });
  }

  return new Proxy(base, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = (value as (...args: unknown[]) => unknown).bind(target);
      if (prop === "prepare" && !fired) {
        return (query: string) =>
          wrapStatement(fn(query) as D1PreparedStatement);
      }
      return fn;
    },
  });
}

/**
 * The race these tests reproduce, in both handlers:
 *
 *   1. an admin starts demoting / removing a plain member;
 *   2. the handler reads the roster and sees `member`, so the rank check passes;
 *   3. before the write lands, the OWNER promotes that same person to `admin`;
 *   4. the write must now refuse — an admin may not act on a peer admin.
 *
 * Step 4 is the whole test. Every assertion is on the stored row, because the
 * pre-fix failure mode returned a perfectly ordinary 200.
 *
 * The fixtures deliberately contain a SECOND plain member with project and
 * team rows. `removeMember` gates its cascade on an `EXISTS` sub-select, and
 * an `EXISTS` that lost its `userId` predicate would still find *some* row
 * with the expected role and let the cascade fire while the membership delete
 * no-opped — a half-revoked bystander. Only a second member of the same role
 * can catch that.
 */
describe("member governance — a role change mid-request cannot be raced", () => {
  function racingApp(actor: TestUserFixture, interfere: () => Promise<void>) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, actor));
    app.use("/*", async (c, next) => {
      c.set("db", createDb(racingD1(d1, interfere)));
      await next();
    });
    app.patch(
      "/workspaces/:workspaceId/members/:userId",
      validateBody(updateMemberRoleSchema),
      updateMemberRole,
    );
    app.delete("/workspaces/:workspaceId/members/:userId", removeMember);
    return app;
  }

  /** Owner + one admin + two plain members, one of them on a project and team. */
  async function seedRaceWorkspace(name: string) {
    const workspaceId = await seedWorkspace(d1, OWNER.id, { name });
    const projectId = await seedProject(d1, workspaceId, { name: `${name} Project` });
    const teamId = await seedTeam(d1, workspaceId, { name: `${name} Team` });

    await seedWorkspaceMember(d1, workspaceId, ADMIN_A.id, "admin");
    await seedWorkspaceMember(d1, workspaceId, PLAIN_MEMBER.id, "member");
    await seedWorkspaceMember(d1, workspaceId, BYSTANDER.id, "member");
    await seedProjectMember(d1, projectId, PLAIN_MEMBER.id, "member");
    await seedProjectMember(d1, projectId, BYSTANDER.id, "member");
    await seedTeamMember(d1, teamId, PLAIN_MEMBER.id);
    await seedTeamMember(d1, teamId, BYSTANDER.id);

    return { workspaceId, projectId, teamId };
  }

  /** The concurrent write: the owner promotes the target to admin. */
  function promoteToAdmin(workspaceId: string, userId: string) {
    return async () => {
      await d1
        .prepare(
          "UPDATE workspace_member SET role = 'admin' WHERE workspaceId = ? AND userId = ?",
        )
        .bind(workspaceId, userId)
        .run();
    };
  }

  async function storedRole(workspaceId: string, userId: string): Promise<string | null> {
    const row = await d1
      .prepare("SELECT role FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(workspaceId, userId)
      .first<{ role: string }>();
    return row?.role ?? null;
  }

  async function countRow(sql: string, ...binds: string[]): Promise<number> {
    const row = await d1.prepare(sql).bind(...binds).first<{ n: number }>();
    return row?.n ?? 0;
  }

  it("refuses a role change whose target was promoted after the rank check", async () => {
    const { workspaceId } = await seedRaceWorkspace("Race Role WS");

    const res = await req(
      racingApp(ADMIN_A, promoteToAdmin(workspaceId, PLAIN_MEMBER.id)),
      jsonRequest("PATCH", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`, {
        role: "member",
      }),
    );

    expect(res.status).toBe(409);
    // The post-condition, not the status: the admin's demotion did NOT land on
    // the row that had become a peer admin.
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("admin");
  });

  it("refuses a removal whose target was promoted after the rank check, and revokes nothing", async () => {
    const { workspaceId, projectId, teamId } = await seedRaceWorkspace("Race Remove WS");

    const res = await req(
      racingApp(ADMIN_A, promoteToAdmin(workspaceId, PLAIN_MEMBER.id)),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );

    expect(res.status).toBe(409);

    // All three statements must have no-opped together. A cascade that fired
    // while the membership delete refused would leave a workspace member with
    // no project or team access and no way to notice — worse than the race.
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBe("admin");
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM project_member WHERE projectId = ? AND userId = ?",
        projectId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(1);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM team_member WHERE teamId = ? AND userId = ?",
        teamId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(1);

    // And the other plain member — whose role the EXISTS guard could match if
    // it were not scoped to the target — is untouched as well.
    expect(await storedRole(workspaceId, BYSTANDER.id)).toBe("member");
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM project_member WHERE projectId = ? AND userId = ?",
        projectId,
        BYSTANDER.id,
      ),
    ).toBe(1);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM team_member WHERE teamId = ? AND userId = ?",
        teamId,
        BYSTANDER.id,
      ),
    ).toBe(1);
  });

  it("still completes normally when nothing interferes", async () => {
    // The control. Without it, a handler that answered 409 unconditionally
    // would satisfy both tests above.
    const { workspaceId, projectId, teamId } = await seedRaceWorkspace("Race Control WS");
    const noInterference = async () => {};

    const res = await req(
      racingApp(ADMIN_A, noInterference),
      jsonRequest("DELETE", `/workspaces/${workspaceId}/members/${PLAIN_MEMBER.id}`),
    );

    expect(res.status).toBe(200);
    expect(await storedRole(workspaceId, PLAIN_MEMBER.id)).toBeNull();
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM project_member WHERE projectId = ? AND userId = ?",
        projectId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(0);
    expect(
      await countRow(
        "SELECT COUNT(*) AS n FROM team_member WHERE teamId = ? AND userId = ?",
        teamId,
        PLAIN_MEMBER.id,
      ),
    ).toBe(0);
  });
});
