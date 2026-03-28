/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for task-group handler functions.
 *
 * Uses a real in-memory D1 database (via Miniflare) so that handler logic —
 * including Drizzle ORM queries and fractional-index position generation —
 * is exercised against actual SQL. This catches query-shape regressions that
 * mocks would miss.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTaskGroupSchema,
  reorderTaskGroupSchema,
  updateTaskGroupSchema,
} from "../../../shared/schemas/task-group";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
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
import {
  createTaskGroup,
  deleteTaskGroup,
  listTaskGroups,
  reorderTaskGroup,
  updateTaskGroup,
} from "./task-groups.handlers";

// ---------------------------------------------------------------------------
// Test-only user with no project access beyond viewer
// ---------------------------------------------------------------------------

const TEST_USER_3 = {
  id: "test-user-3-id",
  name: "Test User 3",
  email: "test3@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let emptyProjectId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  // Seed users — seedUser only accepts TEST_USER / TEST_USER_2, so seed
  // TEST_USER_3 via raw SQL to avoid type narrowing issues.
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  await d1
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      TEST_USER_3.id,
      TEST_USER_3.name,
      TEST_USER_3.email,
      TEST_USER_3.emailVerified ? 1 : 0,
      TEST_USER_3.image,
      Math.floor(TEST_USER_3.createdAt.getTime() / 1000),
      Math.floor(TEST_USER_3.updatedAt.getTime() / 1000),
    )
    .run();

  // Workspace with user1 as owner
  workspaceId = await seedWorkspace(d1, TEST_USER.id);

  // User2 as workspace member only (no project membership)
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

  // User3 as workspace member
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_3.id, "member");

  // Project with user1 as admin
  projectId = await seedProject(d1, workspaceId);
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");

  // User3 as project viewer
  await seedProjectMember(d1, projectId, TEST_USER_3.id, "viewer");

  // Empty project for listTaskGroups empty-array test
  emptyProjectId = await seedProject(d1, workspaceId, { name: "Empty Project" });
  await seedProjectMember(d1, emptyProjectId, TEST_USER.id, "admin");
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const adminAuth = () =>
  fakeAuth(d1, TEST_USER, {
    workspaceMembership: { id: "wm-1", role: "owner" },
  });

const noAccessAuth = () =>
  fakeAuth(d1, TEST_USER_2, {
    workspaceMembership: { id: "wm-2", role: "member" },
  });

const viewerAuth = () =>
  fakeAuth(d1, TEST_USER_3 as typeof TEST_USER, {
    workspaceMembership: { id: "wm-3", role: "member" },
  });

// =========================================================================
// createTaskGroup
// =========================================================================

describe("createTaskGroup", () => {
  it("creates a task group with auto-generated fractional-index position", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/task-groups",
      adminAuth(),
      validateBody(createTaskGroupSchema),
      createTaskGroup,
    );

    const res = await app.request(
      `/projects/${projectId}/task-groups`,
      jsonRequest("POST", `/projects/${projectId}/task-groups`, {
        name: "Backlog",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ taskGroup: { name: string; position: string } }>();
    expect(body.taskGroup.name).toBe("Backlog");
    expect(body.taskGroup.position).toBeTruthy();
    expect(typeof body.taskGroup.position).toBe("string");
  });

  it("sets color when provided", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/task-groups",
      adminAuth(),
      validateBody(createTaskGroupSchema),
      createTaskGroup,
    );

    const res = await app.request(
      `/projects/${projectId}/task-groups`,
      jsonRequest("POST", `/projects/${projectId}/task-groups`, {
        name: "In Progress",
        color: "#FF5733",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ taskGroup: { color: string | null } }>();
    expect(body.taskGroup.color).toBe("#FF5733");
  });

  it("sets color to null when not provided", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/task-groups",
      adminAuth(),
      validateBody(createTaskGroupSchema),
      createTaskGroup,
    );

    const res = await app.request(
      `/projects/${projectId}/task-groups`,
      jsonRequest("POST", `/projects/${projectId}/task-groups`, {
        name: "No Color Group",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ taskGroup: { color: string | null } }>();
    expect(body.taskGroup.color).toBeNull();
  });

  it("returns 201 status", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/task-groups",
      adminAuth(),
      validateBody(createTaskGroupSchema),
      createTaskGroup,
    );

    const res = await app.request(
      `/projects/${projectId}/task-groups`,
      jsonRequest("POST", `/projects/${projectId}/task-groups`, {
        name: "Status Check Group",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ taskGroup: { id: string; projectId: string; name: string; createdAt: string; updatedAt: string } }>();
    expect(body.taskGroup.id).toBeTruthy();
    expect(body.taskGroup.projectId).toBe(projectId);
    expect(body.taskGroup.name).toBe("Status Check Group");
    expect(body.taskGroup.createdAt).toBeTruthy();
    expect(body.taskGroup.updatedAt).toBeTruthy();
  });
});

// =========================================================================
// listTaskGroups
// =========================================================================

describe("listTaskGroups", () => {
  it("returns task groups ordered by position ascending", async () => {
    // Seed groups with explicit positions so ordering is deterministic
    const groupA = await seedTaskGroup(d1, emptyProjectId, {
      name: "Second",
      position: "b0",
    });
    const groupB = await seedTaskGroup(d1, emptyProjectId, {
      name: "First",
      position: "a0",
    });

    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/task-groups", adminAuth(), listTaskGroups);

    const res = await app.request(
      `/projects/${emptyProjectId}/task-groups`,
      jsonRequest("GET", `/projects/${emptyProjectId}/task-groups`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ taskGroups: { id: string; position: string }[] }>();
    expect(body.taskGroups.length).toBeGreaterThanOrEqual(2);
    // Verify ascending position order
    for (let i = 1; i < body.taskGroups.length; i++) {
      expect(body.taskGroups[i].position >= body.taskGroups[i - 1].position).toBe(true);
    }
    // Verify First (a0) comes before Second (b0)
    const firstIdx = body.taskGroups.findIndex((g) => g.id === groupB);
    const secondIdx = body.taskGroups.findIndex((g) => g.id === groupA);
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("includes taskCount for each group", async () => {
    // Create a fresh project with a known group and tasks
    const countProjectId = await seedProject(d1, workspaceId, {
      name: "Count Project",
    });
    await seedProjectMember(d1, countProjectId, TEST_USER.id, "admin");

    const groupId = await seedTaskGroup(d1, countProjectId, {
      name: "Tasks Here",
      position: "a0",
    });
    await seedTask(d1, countProjectId, groupId, { title: "Task 1" });
    await seedTask(d1, countProjectId, groupId, { title: "Task 2" });
    await seedTask(d1, countProjectId, groupId, { title: "Task 3" });

    const emptyGroupId = await seedTaskGroup(d1, countProjectId, {
      name: "No Tasks",
      position: "b0",
    });

    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/task-groups", adminAuth(), listTaskGroups);

    const res = await app.request(
      `/projects/${countProjectId}/task-groups`,
      jsonRequest("GET", `/projects/${countProjectId}/task-groups`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ taskGroups: { id: string; taskCount: number }[] }>();

    const withTasks = body.taskGroups.find((g) => g.id === groupId);
    const withoutTasks = body.taskGroups.find((g) => g.id === emptyGroupId);
    expect(withTasks?.taskCount).toBe(3);
    expect(withoutTasks?.taskCount).toBe(0);
  });

  it("returns empty array for project with no groups", async () => {
    // Create a brand-new project with zero task groups
    const bareProjectId = await seedProject(d1, workspaceId, {
      name: "Bare Project",
    });
    await seedProjectMember(d1, bareProjectId, TEST_USER.id, "admin");

    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/task-groups", adminAuth(), listTaskGroups);

    const res = await app.request(
      `/projects/${bareProjectId}/task-groups`,
      jsonRequest("GET", `/projects/${bareProjectId}/task-groups`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ taskGroups: unknown[] }>();
    expect(body.taskGroups).toEqual([]);
  });
});

// =========================================================================
// updateTaskGroup
// =========================================================================

describe("updateTaskGroup", () => {
  let updateGroupId: string;

  beforeAll(async () => {
    updateGroupId = await seedTaskGroup(d1, projectId, {
      name: "Original Name",
      position: "u0",
    });
  });

  it("updates name", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId",
      adminAuth(),
      validateBody(updateTaskGroupSchema),
      updateTaskGroup,
    );

    const res = await app.request(
      `/task-groups/${updateGroupId}`,
      jsonRequest("PATCH", `/task-groups/${updateGroupId}`, {
        name: "Updated Name",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ taskGroup: { name: string } }>();
    expect(body.taskGroup.name).toBe("Updated Name");
  });

  it("updates color", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId",
      adminAuth(),
      validateBody(updateTaskGroupSchema),
      updateTaskGroup,
    );

    const res = await app.request(
      `/task-groups/${updateGroupId}`,
      jsonRequest("PATCH", `/task-groups/${updateGroupId}`, {
        color: "#00FF00",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ taskGroup: { color: string | null } }>();
    expect(body.taskGroup.color).toBe("#00FF00");
  });

  it("updates isCompletionGroup flag", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId",
      adminAuth(),
      validateBody(updateTaskGroupSchema),
      updateTaskGroup,
    );

    const res = await app.request(
      `/task-groups/${updateGroupId}`,
      jsonRequest("PATCH", `/task-groups/${updateGroupId}`, {
        isCompletionGroup: true,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ taskGroup: { isCompletionGroup: boolean | number } }>();
    // D1/SQLite may return 1 instead of true for boolean columns
    expect(body.taskGroup.isCompletionGroup).toBeTruthy();
  });

  it("returns 404 when task group does not exist", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId",
      adminAuth(),
      validateBody(updateTaskGroupSchema),
      updateTaskGroup,
    );

    const fakeId = crypto.randomUUID();
    const res = await app.request(
      `/task-groups/${fakeId}`,
      jsonRequest("PATCH", `/task-groups/${fakeId}`, {
        name: "Ghost",
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 404 when user has no project access", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId",
      noAccessAuth(),
      validateBody(updateTaskGroupSchema),
      updateTaskGroup,
    );

    const res = await app.request(
      `/task-groups/${updateGroupId}`,
      jsonRequest("PATCH", `/task-groups/${updateGroupId}`, {
        name: "Unauthorized",
      }),
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 when user role is insufficient", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId",
      viewerAuth(),
      validateBody(updateTaskGroupSchema),
      updateTaskGroup,
    );

    const res = await app.request(
      `/task-groups/${updateGroupId}`,
      jsonRequest("PATCH", `/task-groups/${updateGroupId}`, {
        name: "Viewer Attempt",
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/forbidden/i);
  });
});

// =========================================================================
// deleteTaskGroup
// =========================================================================

describe("deleteTaskGroup", () => {
  let deleteGroupId: string;
  let targetGroupId: string;
  beforeAll(async () => {
    deleteGroupId = await seedTaskGroup(d1, projectId, {
      name: "Delete Me",
      position: "d0",
    });
    targetGroupId = await seedTaskGroup(d1, projectId, {
      name: "Reassign Target",
      position: "d1",
    });
    await seedTask(d1, projectId, deleteGroupId, {
      title: "Task To Reassign",
    });
  });

  it("deletes group and reassigns tasks to target group", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/task-groups/:taskGroupId", adminAuth(), deleteTaskGroup);

    const res = await app.request(
      `/task-groups/${deleteGroupId}?targetGroupId=${targetGroupId}`,
      jsonRequest(
        "DELETE",
        `/task-groups/${deleteGroupId}?targetGroupId=${targetGroupId}`,
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify the task was reassigned by listing task groups for the project
    // and confirming the deleted group is gone
    const listApp = new Hono<AppEnv>();
    listApp.get("/projects/:projectId/task-groups", adminAuth(), listTaskGroups);
    const listRes = await listApp.request(
      `/projects/${projectId}/task-groups`,
      jsonRequest("GET", `/projects/${projectId}/task-groups`),
    );
    const listBody = await listRes.json<{ taskGroups: { id: string; taskCount: number }[] }>();
    // Deleted group should no longer exist
    expect(listBody.taskGroups.find((g) => g.id === deleteGroupId)).toBeUndefined();
    // Target group should have the reassigned task
    const target = listBody.taskGroups.find((g) => g.id === targetGroupId);
    expect(target).toBeDefined();
    expect(target!.taskCount).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 when targetGroupId query param is missing", async () => {
    const groupId = await seedTaskGroup(d1, projectId, {
      name: "No Target Param",
      position: "d2",
    });

    const app = new Hono<AppEnv>();
    app.delete("/task-groups/:taskGroupId", adminAuth(), deleteTaskGroup);

    const res = await app.request(
      `/task-groups/${groupId}`,
      jsonRequest("DELETE", `/task-groups/${groupId}`),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/targetGroupId/i);
  });

  it("returns 400 when targetGroupId equals the group being deleted", async () => {
    const groupId = await seedTaskGroup(d1, projectId, {
      name: "Self Target",
      position: "d3",
    });

    const app = new Hono<AppEnv>();
    app.delete("/task-groups/:taskGroupId", adminAuth(), deleteTaskGroup);

    const res = await app.request(
      `/task-groups/${groupId}?targetGroupId=${groupId}`,
      jsonRequest(
        "DELETE",
        `/task-groups/${groupId}?targetGroupId=${groupId}`,
      ),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/different/i);
  });

  it("returns 404 when target group does not exist", async () => {
    const groupId = await seedTaskGroup(d1, projectId, {
      name: "Good Source",
      position: "d4",
    });
    const fakeTargetId = crypto.randomUUID();

    const app = new Hono<AppEnv>();
    app.delete("/task-groups/:taskGroupId", adminAuth(), deleteTaskGroup);

    const res = await app.request(
      `/task-groups/${groupId}?targetGroupId=${fakeTargetId}`,
      jsonRequest(
        "DELETE",
        `/task-groups/${groupId}?targetGroupId=${fakeTargetId}`,
      ),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/target group not found/i);
  });

  it("returns 404 when target group is in a different project", async () => {
    const otherProjectId = await seedProject(d1, workspaceId, {
      name: "Other Project",
    });
    await seedProjectMember(d1, otherProjectId, TEST_USER.id, "admin");
    const otherGroupId = await seedTaskGroup(d1, otherProjectId, {
      name: "Wrong Project Group",
      position: "a0",
    });

    const groupId = await seedTaskGroup(d1, projectId, {
      name: "Cross Project Source",
      position: "d5",
    });

    const app = new Hono<AppEnv>();
    app.delete("/task-groups/:taskGroupId", adminAuth(), deleteTaskGroup);

    const res = await app.request(
      `/task-groups/${groupId}?targetGroupId=${otherGroupId}`,
      jsonRequest(
        "DELETE",
        `/task-groups/${groupId}?targetGroupId=${otherGroupId}`,
      ),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/target group not found/i);
  });

  it("returns 404 when task group does not exist", async () => {
    const validTarget = await seedTaskGroup(d1, projectId, {
      name: "Valid Target For 404",
      position: "d6",
    });
    const fakeId = crypto.randomUUID();

    const app = new Hono<AppEnv>();
    app.delete("/task-groups/:taskGroupId", adminAuth(), deleteTaskGroup);

    const res = await app.request(
      `/task-groups/${fakeId}?targetGroupId=${validTarget}`,
      jsonRequest(
        "DELETE",
        `/task-groups/${fakeId}?targetGroupId=${validTarget}`,
      ),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 403 when user is not admin", async () => {
    const groupId = await seedTaskGroup(d1, projectId, {
      name: "Viewer Delete Attempt",
      position: "d7",
    });
    const validTarget = await seedTaskGroup(d1, projectId, {
      name: "Viewer Target",
      position: "d8",
    });

    const app = new Hono<AppEnv>();
    app.delete("/task-groups/:taskGroupId", viewerAuth(), deleteTaskGroup);

    const res = await app.request(
      `/task-groups/${groupId}?targetGroupId=${validTarget}`,
      jsonRequest(
        "DELETE",
        `/task-groups/${groupId}?targetGroupId=${validTarget}`,
      ),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/forbidden/i);
  });
});

// =========================================================================
// reorderTaskGroup
// =========================================================================

describe("reorderTaskGroup", () => {
  let reorderGroupId: string;

  beforeAll(async () => {
    reorderGroupId = await seedTaskGroup(d1, projectId, {
      name: "Reorder Me",
      position: "r0",
    });
  });

  it("updates position to provided value", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId/reorder",
      adminAuth(),
      validateBody(reorderTaskGroupSchema),
      reorderTaskGroup,
    );

    const res = await app.request(
      `/task-groups/${reorderGroupId}/reorder`,
      jsonRequest("PATCH", `/task-groups/${reorderGroupId}/reorder`, {
        position: "m0",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ taskGroup: { id: string; position: string } }>();
    expect(body.taskGroup.id).toBe(reorderGroupId);
    expect(body.taskGroup.position).toBe("m0");
  });

  it("returns 404 when task group does not exist", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId/reorder",
      adminAuth(),
      validateBody(reorderTaskGroupSchema),
      reorderTaskGroup,
    );

    const fakeId = crypto.randomUUID();
    const res = await app.request(
      `/task-groups/${fakeId}/reorder`,
      jsonRequest("PATCH", `/task-groups/${fakeId}/reorder`, {
        position: "z0",
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 403 when user role is insufficient", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/task-groups/:taskGroupId/reorder",
      viewerAuth(),
      validateBody(reorderTaskGroupSchema),
      reorderTaskGroup,
    );

    const res = await app.request(
      `/task-groups/${reorderGroupId}/reorder`,
      jsonRequest("PATCH", `/task-groups/${reorderGroupId}/reorder`, {
        position: "z0",
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/forbidden/i);
  });
});
