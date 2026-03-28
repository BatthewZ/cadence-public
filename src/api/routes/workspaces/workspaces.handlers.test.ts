/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for workspace handler functions.
 *
 * Uses a real in-memory D1 database (via Miniflare) so every handler exercises
 * actual SQL through Drizzle ORM. Each describe block mounts only the handler
 * under test with minimal middleware (fakeAuth + validateBody where needed),
 * bypassing authorization middleware so we test handler logic in isolation.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createWorkspaceSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from "../../../shared/schemas/workspace";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
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
  function createApp(
    user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER,
    role: "owner" | "admin" | "member" = "owner",
  ) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user, { workspaceMembership: { id: "wm-remove", role } }));
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

  it("returns 403 when trying to remove the workspace owner", async () => {
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Cannot Remove Owner WS",
      slug: "cannot-remove-owner-ws",
    });

    const app = createApp();
    const res = await req(
      app,
      jsonRequest("DELETE", `/workspaces/${wsId}/members/${TEST_USER.id}`),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Cannot remove the workspace owner");
  });

  it("returns 400 when trying to remove yourself", async () => {
    // TEST_USER_2 is an admin trying to remove themselves
    const wsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Self Remove WS",
      slug: "self-remove-ws",
    });
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "admin");

    const app = createApp(TEST_USER_2, "admin");
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
