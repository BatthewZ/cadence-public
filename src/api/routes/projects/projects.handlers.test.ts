/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for project handler functions.
 *
 * These tests exercise real SQL queries against an in-memory D1 database via
 * Miniflare. By testing handler logic with actual database operations we catch
 * query bugs, constraint violations, and incorrect result shapes that unit
 * tests with mocks would miss.
 *
 * Authorization middleware (requireProjectAccess, requireProjectRole,
 * requireWorkspaceMember) is bypassed — the focus here is handler logic, not
 * auth policy enforcement which has its own test surface.
 *
 * Cover-image handlers (uploadProjectCover, deleteProjectCover) are excluded
 * because they depend on R2 storage which is not available in the test env.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addProjectMemberSchema,
  createProjectSchema,
  updateProjectSchema,
} from "../../../shared/schemas/project";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedProject,
  seedProjectMember,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  addMember,
  createProject,
  deleteProject,
  getProject,
  listMembers,
  listProjects,
  removeMember,
  updateProject,
} from "./projects.handlers";

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

describe("createProject", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.post(
      "/workspaces/:workspaceId/projects",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
      validateBody(createProjectSchema),
      createProject,
    );
    return app;
  }

  it("creates a project with default task groups and returns 201", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/projects`,
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, {
        name: "My New Project",
        description: "A test project",
      }),
    );

    expect(res.status).toBe(201);

    const body = await res.json<{ project: { id: string; name: string; description: string | null; workspaceId: string } }>();
    expect(body.project.name).toBe("My New Project");
    expect(body.project.description).toBe("A test project");
    expect(body.project.workspaceId).toBe(workspaceId);

    // Verify 3 default task groups were created
    const groups = await d1
      .prepare("SELECT * FROM task_group WHERE projectId = ? ORDER BY position")
      .bind(body.project.id)
      .all<{ name: string }>();
    expect(groups.results).toHaveLength(3);
    expect(groups.results.map((g) => g.name)).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ]);

    // Verify the creator was auto-added as an admin member
    const members = await d1
      .prepare(
        "SELECT * FROM project_member WHERE projectId = ? AND userId = ?",
      )
      .bind(body.project.id, TEST_USER.id)
      .all<{ role: string }>();
    expect(members.results).toHaveLength(1);
    expect(members.results[0].role).toBe("admin");
  });

  it("creates a project with only a name (no description)", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/projects`,
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, {
        name: "Minimal Project",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { name: string; description: string | null } }>();
    expect(body.project.name).toBe("Minimal Project");
    expect(body.project.description).toBeNull();
  });

  it("returns 400 for validation errors (empty name)", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/projects`,
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, {
        name: "",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: Array<unknown> }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("returns 400 when name exceeds max length", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/projects`,
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, {
        name: "x".repeat(101),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("creates a project with status, budget, and theme", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/projects`,
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, {
        name: "Full Options Project",
        status: "completed",
        budget: 50000,
        theme: "sunset",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{
      project: { name: string; status: string; budget: number; theme: string };
    }>();
    expect(body.project.status).toBe("completed");
    expect(body.project.budget).toBe(50000);
    expect(body.project.theme).toBe("sunset");
  });

  it("defaults status to active and budget/theme to null when not provided", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/projects`,
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, {
        name: "Defaults Project",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{
      project: { status: string; budget: number | null; theme: string | null };
    }>();
    expect(body.project.status).toBe("active");
    expect(body.project.budget).toBeNull();
    expect(body.project.theme).toBeNull();
  });

  it("rejects invalid status value", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/projects`,
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, {
        name: "Bad Status",
        status: "invalid",
      }),
    );

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// listProjects
// ---------------------------------------------------------------------------

describe("listProjects", () => {
  let listWorkspaceId: string;

  beforeAll(async () => {
    listWorkspaceId = await seedWorkspace(d1, TEST_USER.id, {
      name: "List WS",
      slug: "list-ws",
    });
    await seedWorkspaceMember(d1, listWorkspaceId, TEST_USER_2.id, "member");

    // Seed projects — one with TEST_USER_2 as member, one without
    const projA = await seedProject(d1, listWorkspaceId, {
      name: "Visible Project",
    });
    await seedProjectMember(d1, projA, TEST_USER_2.id, "member");
    await seedProject(d1, listWorkspaceId, { name: "Hidden Project" });
  });

  it("returns all projects for workspace owners", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/projects",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-owner", role: "owner" },
      }),
      listProjects,
    );

    const res = await app.request(
      `/workspaces/${listWorkspaceId}/projects`,
      jsonRequest("GET", `/workspaces/${listWorkspaceId}/projects`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ projects: Array<{ id: string }> }>();
    expect(body.projects.length).toBe(2);
  });

  it("returns only projects the member belongs to for non-elevated users", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/projects",
      fakeAuth(d1, TEST_USER_2, {
        workspaceMembership: { id: "wm-member", role: "member" },
      }),
      listProjects,
    );

    const res = await app.request(
      `/workspaces/${listWorkspaceId}/projects`,
      jsonRequest("GET", `/workspaces/${listWorkspaceId}/projects`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ projects: Array<{ name: string }> }>();
    expect(body.projects.length).toBe(1);
    expect(body.projects[0].name).toBe("Visible Project");
  });

  it("returns empty array when workspace has no projects", async () => {
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Empty WS",
      slug: "empty-ws",
    });

    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/projects",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-empty", role: "owner" },
      }),
      listProjects,
    );

    const res = await app.request(
      `/workspaces/${emptyWsId}/projects`,
      jsonRequest("GET", `/workspaces/${emptyWsId}/projects`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ projects: Array<unknown> }>();
    expect(body.projects).toEqual([]);
  });

  it("includes memberCount and taskGroupCount on each project", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/projects",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-counts", role: "owner" },
      }),
      listProjects,
    );

    const res = await app.request(
      `/workspaces/${listWorkspaceId}/projects`,
      jsonRequest("GET", `/workspaces/${listWorkspaceId}/projects`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ projects: Array<{ memberCount: number; taskGroupCount: number }> }>();
    for (const p of body.projects) {
      expect(typeof p.memberCount).toBe("number");
      expect(typeof p.taskGroupCount).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// getProject
// ---------------------------------------------------------------------------

describe("getProject", () => {
  let existingProjectId: string;

  beforeAll(async () => {
    existingProjectId = await seedProject(d1, workspaceId, {
      name: "Get Me",
    });
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.get(
      "/projects/:projectId",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-get", role: "owner" },
      }),
      getProject,
    );
    return app;
  }

  it("returns the project by id", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${existingProjectId}`,
      jsonRequest("GET", `/projects/${existingProjectId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ project: { id: string; name: string } }>();
    expect(body.project.id).toBe(existingProjectId);
    expect(body.project.name).toBe("Get Me");
  });

  it("returns 404 for a nonexistent project", async () => {
    const app = createApp();
    const res = await app.request(
      "/projects/nonexistent-id",
      jsonRequest("GET", "/projects/nonexistent-id"),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Project not found");
  });
});

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

describe("updateProject", () => {
  let updateProjectId: string;

  beforeAll(async () => {
    updateProjectId = await seedProject(d1, workspaceId, {
      name: "Before Update",
    });
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.patch(
      "/projects/:projectId",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-update", role: "owner" },
      }),
      validateBody(updateProjectSchema),
      updateProject,
    );
    return app;
  }

  it("updates name, description, and status", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${updateProjectId}`,
      jsonRequest("PATCH", `/projects/${updateProjectId}`, {
        name: "After Update",
        description: "Updated desc",
        status: "archived",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ project: { name: string; description: string | null; status: string } }>();
    expect(body.project.name).toBe("After Update");
    expect(body.project.description).toBe("Updated desc");
    expect(body.project.status).toBe("archived");
  });

  it("allows partial updates (only name)", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${updateProjectId}`,
      jsonRequest("PATCH", `/projects/${updateProjectId}`, {
        name: "Renamed Again",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ project: { name: string; status: string } }>();
    expect(body.project.name).toBe("Renamed Again");
    // status should remain from the previous update
    expect(body.project.status).toBe("archived");
  });

  it("returns 400 for invalid status value", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${updateProjectId}`,
      jsonRequest("PATCH", `/projects/${updateProjectId}`, {
        status: "invalid-status",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 when name is empty string", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${updateProjectId}`,
      jsonRequest("PATCH", `/projects/${updateProjectId}`, {
        name: "",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("can set description to null", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${updateProjectId}`,
      jsonRequest("PATCH", `/projects/${updateProjectId}`, {
        description: null,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ project: { description: string | null } }>();
    expect(body.project.description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteProject
// ---------------------------------------------------------------------------

describe("deleteProject", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.delete(
      "/projects/:projectId",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-delete", role: "owner" },
      }),
      deleteProject,
    );
    return app;
  }

  it("deletes a project and returns ok", async () => {
    const projId = await seedProject(d1, workspaceId, {
      name: "Delete Me",
    });
    const app = createApp();
    const res = await app.request(
      `/projects/${projId}`,
      jsonRequest("DELETE", `/projects/${projId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify project no longer exists
    const row = await d1
      .prepare("SELECT id FROM project WHERE id = ?")
      .bind(projId)
      .first();
    expect(row).toBeNull();
  });

  it("returns 404 for a nonexistent project", async () => {
    const app = createApp();
    const res = await app.request(
      "/projects/nonexistent-id",
      jsonRequest("DELETE", "/projects/nonexistent-id"),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Project not found");
  });

  it("deletes project even when it has tasks and task groups", async () => {
    const projId = await seedProject(d1, workspaceId, {
      name: "Delete With Tasks",
    });
    // Manually insert a task group and task so the cascade path is exercised
    const groupId = crypto.randomUUID();
    const now = Date.now();
    await d1
      .prepare(
        "INSERT INTO task_group (id, projectId, name, is_completion_group, position, createdAt, updatedAt) VALUES (?, ?, ?, 0, 'a0', ?, ?)",
      )
      .bind(groupId, projId, "Backlog", now, now)
      .run();
    await d1
      .prepare(
        "INSERT INTO task (id, projectId, taskGroupId, title, completed, priority, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, 'none', 'a0', ?, ?)",
      )
      .bind(crypto.randomUUID(), projId, groupId, "Some Task", now, now)
      .run();

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}`,
      jsonRequest("DELETE", `/projects/${projId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listMembers
// ---------------------------------------------------------------------------

describe("listMembers", () => {
  let memberProjectId: string;

  beforeAll(async () => {
    memberProjectId = await seedProject(d1, workspaceId, {
      name: "Member Project",
    });
    await seedProjectMember(d1, memberProjectId, TEST_USER.id, "admin");
    await seedProjectMember(d1, memberProjectId, TEST_USER_2.id, "member");
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.get(
      "/projects/:projectId/members",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-list-members", role: "owner" },
      }),
      listMembers,
    );
    return app;
  }

  it("returns project members with user details", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${memberProjectId}/members`,
      jsonRequest("GET", `/projects/${memberProjectId}/members`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ members: Array<{ userId: string; user: { name: string; email: string } }> }>();
    expect(body.members.length).toBe(2);

    const userIds = body.members.map((m) => m.userId).sort();
    expect(userIds).toEqual([TEST_USER.id, TEST_USER_2.id].sort());

    // Each member should have nested user details
    for (const m of body.members) {
      expect(m.user).toBeDefined();
      expect(typeof m.user.name).toBe("string");
      expect(typeof m.user.email).toBe("string");
    }
  });

  it("returns empty array for project with no members", async () => {
    const emptyProjId = await seedProject(d1, workspaceId, {
      name: "No Members",
    });
    const app = createApp();
    const res = await app.request(
      `/projects/${emptyProjId}/members`,
      jsonRequest("GET", `/projects/${emptyProjId}/members`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ members: Array<unknown> }>();
    expect(body.members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addMember
// ---------------------------------------------------------------------------

describe("addMember", () => {
  let addMemberProjectId: string;

  beforeAll(async () => {
    addMemberProjectId = await seedProject(d1, workspaceId, {
      name: "Add Member Project",
    });
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/members",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-add-member", role: "owner" },
      }),
      validateBody(addProjectMemberSchema),
      addMember,
    );
    return app;
  }

  it("adds a workspace member to the project and returns 201", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${addMemberProjectId}/members`,
      jsonRequest("POST", `/projects/${addMemberProjectId}/members`, {
        userId: TEST_USER_2.id,
        role: "member",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ member: { projectId: string; userId: string; role: string } }>();
    expect(body.member.projectId).toBe(addMemberProjectId);
    expect(body.member.userId).toBe(TEST_USER_2.id);
    expect(body.member.role).toBe("member");
  });

  it("returns 409 when adding a duplicate member", async () => {
    const app = createApp();
    // TEST_USER_2 was already added in the previous test
    const res = await app.request(
      `/projects/${addMemberProjectId}/members`,
      jsonRequest("POST", `/projects/${addMemberProjectId}/members`, {
        userId: TEST_USER_2.id,
        role: "member",
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("User is already a project member");
  });

  it("returns 400 when user is not a workspace member", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${addMemberProjectId}/members`,
      jsonRequest("POST", `/projects/${addMemberProjectId}/members`, {
        userId: "non-workspace-user-id",
        role: "member",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("User is not a member of the workspace");
  });

  it("returns 400 for invalid role", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${addMemberProjectId}/members`,
      jsonRequest("POST", `/projects/${addMemberProjectId}/members`, {
        userId: TEST_USER.id,
        role: "superadmin",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 when userId is missing", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${addMemberProjectId}/members`,
      jsonRequest("POST", `/projects/${addMemberProjectId}/members`, {
        role: "member",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("creates a notification for the added user", async () => {
    // Seed a fresh project so we have a clean state
    const notifProjId = await seedProject(d1, workspaceId, {
      name: "Notif Project",
    });

    const app = createApp();
    await app.request(
      `/projects/${notifProjId}/members`,
      jsonRequest("POST", `/projects/${notifProjId}/members`, {
        userId: TEST_USER_2.id,
        role: "viewer",
      }),
    );

    // Verify notification was created
    const row = await d1
      .prepare(
        "SELECT * FROM notification WHERE userId = ? AND type = 'project_member_added' AND projectId = ?",
      )
      .bind(TEST_USER_2.id, notifProjId)
      .first();
    expect(row).not.toBeNull();
    expect(row!.type).toBe("project_member_added");
  });
});

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe("removeMember", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.delete(
      "/projects/:projectId/members/:userId",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-remove-member", role: "owner" },
      }),
      removeMember,
    );
    return app;
  }

  it("removes a member from the project", async () => {
    const projId = await seedProject(d1, workspaceId, {
      name: "Remove Member Project",
    });
    await seedProjectMember(d1, projId, TEST_USER_2.id, "member");

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/members/${TEST_USER_2.id}`,
      jsonRequest(
        "DELETE",
        `/projects/${projId}/members/${TEST_USER_2.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify the membership row is gone
    const row = await d1
      .prepare(
        "SELECT id FROM project_member WHERE projectId = ? AND userId = ?",
      )
      .bind(projId, TEST_USER_2.id)
      .first();
    expect(row).toBeNull();
  });

  it("returns 404 for a nonexistent membership", async () => {
    const projId = await seedProject(d1, workspaceId, {
      name: "Remove 404 Project",
    });

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/members/nonexistent-user-id`,
      jsonRequest(
        "DELETE",
        `/projects/${projId}/members/nonexistent-user-id`,
      ),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Member not found");
  });

  it("is idempotent — removing already-removed member returns 404", async () => {
    const projId = await seedProject(d1, workspaceId, {
      name: "Idempotent Remove",
    });
    await seedProjectMember(d1, projId, TEST_USER_2.id, "viewer");

    const app = createApp();

    // First removal succeeds
    const res1 = await app.request(
      `/projects/${projId}/members/${TEST_USER_2.id}`,
      jsonRequest(
        "DELETE",
        `/projects/${projId}/members/${TEST_USER_2.id}`,
      ),
    );
    expect(res1.status).toBe(200);

    // Second removal returns 404
    const res2 = await app.request(
      `/projects/${projId}/members/${TEST_USER_2.id}`,
      jsonRequest(
        "DELETE",
        `/projects/${projId}/members/${TEST_USER_2.id}`,
      ),
    );
    expect(res2.status).toBe(404);
  });
});
