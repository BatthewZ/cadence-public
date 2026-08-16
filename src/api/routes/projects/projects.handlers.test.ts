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
 * Cover-image upload/delete handlers require R2 storage; the Unsplash-apply
 * handler also exercises the storage-cleanup path when swapping sources. Those
 * tests provision an in-memory R2 bucket via Miniflare (see the
 * `coverMiniflare` block) so the real shared `cover-image.ts` helpers can run
 * end-to-end.
 */
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../../db";
import {
  addProjectMemberSchema,
  createProjectSchema,
  duplicateProjectSchema,
  updateProjectMemberRoleSchema,
  updateProjectSchema,
} from "../../../shared/schemas/project";
import type {
  StoredUnsplashCoverPayload,
  UnsplashCoverPayload,
} from "../../../shared/schemas/unsplash";
import { unsplashCoverPayloadSchema } from "../../../shared/schemas/unsplash";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  createTestD1WithR2,
  fakeAuth,
  fakeCoverPngFile,
  installFetchSpy,
  jsonRequest,
  makeTestUser,
  sampleUnsplashPayload,
  seedLabel,
  seedProject,
  seedProjectMember,
  seedTaskGroup,
  seedUser,
  seedWebhook,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  addMember,
  applyProjectUnsplashCover,
  createProject,
  deleteProject,
  deleteProjectCover,
  duplicateProject,
  getProject,
  listMembers,
  listProjects,
  removeMember,
  updateMemberRole,
  updateProject,
  uploadProjectCover,
} from "./projects.handlers";

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;

/**
 * A live member of a SECOND workspace, and never a `workspace_member` of
 * `workspaceId`.
 *
 * Distinct from the orphan fixture used by the duplication tests: an orphan has
 * no `workspace_member` row anywhere, so it is refused by the "is a member"
 * half of the rule alone. This principal is genuinely a member — of somebody
 * else's tenant — so only the "of THIS workspace" half can refuse them. That is
 * the difference between a test that pins a tenancy boundary and a test that
 * pins account existence.
 *
 * Individual tests DO give them `project_member` rows under `workspaceId`, and
 * that is the point rather than a contradiction: an orphaned project row held
 * by a real member of another tenant is precisely the state that must confer
 * nothing here.
 */
const FOREIGN_WORKSPACE_USER = makeTestUser(
  "foreign-workspace-user-id",
  "Foreign Tenant User",
);
const FOREIGN_WORKSPACE_USER_ID = FOREIGN_WORKSPACE_USER.id;
let foreignWorkspaceId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

  await seedUser(d1, FOREIGN_WORKSPACE_USER);
  foreignWorkspaceId = await seedWorkspace(d1, FOREIGN_WORKSPACE_USER_ID, {
    name: "Foreign Tenant Workspace",
    slug: "foreign-tenant-workspace",
  });
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

  // `updateProject` assigns columns field-by-field rather than spreading the
  // request body, so that the set of client-writable columns is visible at the
  // write site and `coverImageKey` cannot creep back in. The cost of that
  // choice is that a field present in `updateProjectSchema` but forgotten in the
  // handler would be silently ignored — a PATCH that returns 200 and changes
  // nothing. This test is the guard: it drives EVERY field the schema still
  // permits through one request and reads the stored row back.
  it("writes every field the update schema permits", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "All Fields" });

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}`,
      jsonRequest("PATCH", `/projects/${projId}`, {
        name: "All Fields Updated",
        description: "Every writable column",
        status: "completed",
        icon: "sparkles",
        coverImagePosition: 73,
        theme: "ocean",
        budget: 12345,
        autoAssignCreator: true,
      }),
    );

    expect(res.status).toBe(200);

    const row = await d1
      .prepare(
        "SELECT name, description, status, icon, cover_image_position AS pos, theme, budget, auto_assign_creator AS auto FROM project WHERE id = ?",
      )
      .bind(projId)
      .first<Record<string, unknown>>();

    expect(row).toMatchObject({
      name: "All Fields Updated",
      description: "Every writable column",
      status: "completed",
      icon: "sparkles",
      pos: 73,
      theme: "ocean",
      budget: 12345,
      auto: 1,
    });

    // Every schema key is exercised above — if someone adds a field to the
    // schema without adding it here, this fails and forces the decision.
    expect(Object.keys(updateProjectSchema.shape).sort()).toEqual([
      "autoAssignCreator",
      "budget",
      "coverImagePosition",
      "description",
      "icon",
      "name",
      "status",
      "theme",
    ]);
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

  // -------------------------------------------------------------------------
  // `coverImageKey` is NOT client-writable through this endpoint.
  //
  // Why this matters: `serveUpload` authorizes a `project-cover` download by
  // finding the project whose `cover_image_key` equals the requested R2 key. If
  // a client could write that column, "which project owns this object" would be
  // client-declared — a user could point their OWN project at another
  // workspace's cover key and read the image back through their own legitimate
  // project access. The field is therefore absent from `updateProjectSchema`,
  // and `updateProject` assigns columns field-by-field (never `...body`) so a
  // future schema addition cannot silently re-open the hole.
  //
  // These tests assert the STORED ROW, not the response echo: a handler that
  // returned the requested key while writing nothing, or wrote it while
  // returning the old one, must both be caught.
  // -------------------------------------------------------------------------
  describe("coverImageKey is not writable via PATCH", () => {
    /** Read `cover_image_key` straight from SQLite, bypassing the handler. */
    async function storedCoverKey(projectIdParam: string): Promise<string | null> {
      const row = await d1
        .prepare("SELECT cover_image_key AS k FROM project WHERE id = ?")
        .bind(projectIdParam)
        .first<{ k: string | null }>();
      return row?.k ?? null;
    }

    it("is absent from updateProjectSchema", () => {
      expect(Object.keys(updateProjectSchema.shape)).not.toContain("coverImageKey");
      expect(Object.keys(updateProjectSchema.shape)).not.toContain("coverUnsplash");
      // The framing offset stays patchable — it carries no authorization meaning.
      expect(Object.keys(updateProjectSchema.shape)).toContain("coverImagePosition");
    });

    it("leaves an existing cover key untouched when a PATCH tries to overwrite it", async () => {
      const victimKey = "project-cover/victim-user/secret.jpg";
      const projId = await seedProject(d1, workspaceId, {
        name: "Has A Cover",
        coverImageKey: victimKey,
      });

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}`,
        jsonRequest("PATCH", `/projects/${projId}`, {
          coverImageKey: "project-cover/attacker/forged.jpg",
        }),
      );

      expect(res.status).toBe(200);
      expect(await storedCoverKey(projId)).toBe(victimKey);
      const body = await res.json<{ project: { coverImageKey: string | null } }>();
      expect(body.project.coverImageKey).toBe(victimKey);
    });

    it("does not let a project with no cover claim someone else's key (the forge case)", async () => {
      const projId = await seedProject(d1, workspaceId, { name: "No Cover" });

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}`,
        jsonRequest("PATCH", `/projects/${projId}`, {
          coverImageKey: "project-cover/other-workspace-user/private.jpg",
        }),
      );

      expect(res.status).toBe(200);
      expect(await storedCoverKey(projId)).toBeNull();
    });

    it("ignores a null coverImageKey — a PATCH cannot clear someone's cover either", async () => {
      const victimKey = "project-cover/victim-user/keep-me.jpg";
      const projId = await seedProject(d1, workspaceId, {
        name: "Clear Attempt",
        coverImageKey: victimKey,
      });

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}`,
        jsonRequest("PATCH", `/projects/${projId}`, { coverImageKey: null }),
      );

      expect(res.status).toBe(200);
      expect(await storedCoverKey(projId)).toBe(victimKey);
    });

    it("still applies legitimate fields sent alongside coverImageKey", async () => {
      // The field is STRIPPED by zod, not rejected — a client that PATCHes a
      // whole project object must keep working, just without cover authority.
      const victimKey = "project-cover/victim-user/alongside.jpg";
      const projId = await seedProject(d1, workspaceId, {
        name: "Mixed Patch",
        coverImageKey: victimKey,
      });

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}`,
        jsonRequest("PATCH", `/projects/${projId}`, {
          name: "Mixed Patch Renamed",
          coverImagePosition: 42,
          coverImageKey: "project-cover/attacker/forged.jpg",
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json<{ project: { name: string; coverImagePosition: number | null } }>();
      expect(body.project.name).toBe("Mixed Patch Renamed");
      expect(body.project.coverImagePosition).toBe(42);
      expect(await storedCoverKey(projId)).toBe(victimKey);
    });
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

  it("deletes project-scoped webhooks when archiving a project", async () => {
    // Create a fresh active project with a project-scoped webhook
    const projId = await seedProject(d1, workspaceId, { name: "Archive Webhook Test" });
    await seedWebhook(d1, workspaceId, {
      name: "Project Webhook",
      projectId: projId,
      events: JSON.stringify(["task.created"]),
    });
    // Also seed a workspace-scoped webhook (no projectId) — should NOT be deleted
    const wsHook = await seedWebhook(d1, workspaceId, {
      name: "Workspace Webhook",
      events: JSON.stringify(["task.created"]),
    });

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}`,
      jsonRequest("PATCH", `/projects/${projId}`, { status: "archived" }),
    );
    expect(res.status).toBe(200);

    // Project-scoped webhook should be gone
    const projectHooks = await d1
      .prepare("SELECT id FROM webhook WHERE projectId = ?")
      .bind(projId)
      .all();
    expect(projectHooks.results).toHaveLength(0);

    // Workspace-scoped webhook should still exist
    const wsHookRow = await d1
      .prepare("SELECT id FROM webhook WHERE id = ?")
      .bind(wsHook.id)
      .first();
    expect(wsHookRow).not.toBeNull();
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
// duplicateProject
// ---------------------------------------------------------------------------

describe("duplicateProject", () => {
  function createApp(authUser = TEST_USER) {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/duplicate",
      fakeAuth(d1, authUser, {
        workspaceMembership: { id: "wm-dup", role: "owner" },
      }),
      validateBody(duplicateProjectSchema),
      duplicateProject,
    );
    return app;
  }

  it("duplicates project settings with correct defaults", async () => {
    const projId = await seedProject(d1, workspaceId, {
      name: "Original",
      description: "A test description",
      icon: "rocket",
      theme: "blue",
      budget: 50000,
      autoAssignCreator: true,
      status: "archived",
    });

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, {}),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: Record<string, unknown> }>();
    const p = body.project;
    expect(p.name).toBe("Original (copy)");
    expect(p.description).toBe("A test description");
    expect(p.icon).toBe("rocket");
    expect(p.theme).toBe("blue");
    expect(p.budget).toBe(50000);
    expect(p.autoAssignCreator).toBe(true);
    expect(p.status).toBe("active"); // always active regardless of source
    expect(p.coverImageKey).toBeNull();
    expect(p.coverImagePosition).toBeNull();
    expect(p.coverUnsplash).toBeNull();
    expect(p.id).not.toBe(projId);
  });

  it("duplicates task groups with attributes preserved", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Group Source" });
    await seedTaskGroup(d1, projId, { name: "Backlog", position: "a0" });
    await seedTaskGroup(d1, projId, { name: "In Progress", position: "a1" });
    await seedTaskGroup(d1, projId, { name: "Done", position: "a2", isCompletionGroup: true });

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, {}),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { id: string } }>();
    const newProjId = body.project.id;

    const groups = await d1
      .prepare("SELECT name, position, is_completion_group FROM task_group WHERE projectId = ? ORDER BY position")
      .bind(newProjId)
      .all();

    expect(groups.results).toHaveLength(3);
    expect(groups.results[0]).toMatchObject({ name: "Backlog", position: "a0", is_completion_group: 0 });
    expect(groups.results[1]).toMatchObject({ name: "In Progress", position: "a1", is_completion_group: 0 });
    expect(groups.results[2]).toMatchObject({ name: "Done", position: "a2", is_completion_group: 1 });
  });

  it("duplicates labels with name and color", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Label Source" });
    await seedLabel(d1, projId, "Bug", "#ef4444");
    await seedLabel(d1, projId, "Feature", "#22c55e");

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, {}),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { id: string } }>();

    const labels = await d1
      .prepare("SELECT name, color FROM label WHERE projectId = ? ORDER BY name")
      .bind(body.project.id)
      .all();

    expect(labels.results).toHaveLength(2);
    expect(labels.results[0]).toMatchObject({ name: "Bug", color: "#ef4444" });
    expect(labels.results[1]).toMatchObject({ name: "Feature", color: "#22c55e" });
  });

  it("adds duplicating user as admin by default (no members copied)", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "No Members" });
    await seedProjectMember(d1, projId, TEST_USER.id, "admin");
    await seedProjectMember(d1, projId, TEST_USER_2.id, "member");

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, {}),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { id: string } }>();

    const members = await d1
      .prepare("SELECT userId, role FROM project_member WHERE projectId = ?")
      .bind(body.project.id)
      .all();

    expect(members.results).toHaveLength(1);
    expect(members.results[0]).toMatchObject({ userId: TEST_USER.id, role: "admin" });
  });

  it("copies members when includeMembers is true", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "With Members" });
    await seedProjectMember(d1, projId, TEST_USER.id, "admin");
    await seedProjectMember(d1, projId, TEST_USER_2.id, "viewer");

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, { includeMembers: true }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { id: string }; skippedMemberIds: string[] }>();

    const members = await d1
      .prepare("SELECT userId, role FROM project_member WHERE projectId = ? ORDER BY role")
      .bind(body.project.id)
      .all();

    expect(members.results).toHaveLength(2);
    // duplicating user is always admin, not duplicated
    expect(members.results).toContainEqual(expect.objectContaining({ userId: TEST_USER.id, role: "admin" }));
    expect(members.results).toContainEqual(expect.objectContaining({ userId: TEST_USER_2.id, role: "viewer" }));
    // Nobody was dropped — the workspace-membership filter must not be a
    // blanket "copy nobody".
    expect(body.skippedMemberIds).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Orphaned `project_member` rows must not propagate through duplication.
  //
  // When a user is removed from a workspace their `project_member` rows are
  // left behind. Such a row confers no access on its own, but copying it
  // forward mints a FRESH stale row on a brand-new project — duplication would
  // be actively spreading exactly the state that has to be treated as
  // meaningless. `addMember` already refuses to create a `project_member` row
  // for a non-workspace-member ("User is not a member of the workspace", 400);
  // duplication performs the same write and consults the same authority
  // (`workspace_member`), so the two can never drift apart.
  //
  // It SKIPS rather than refuses: a departed teammate is routine and invisible
  // to whoever clicks Duplicate, so a 400 would permanently brick duplication
  // of any project someone ever left. The drop is made visible instead, via
  // `skippedMemberIds` on the 201 — that field is the whole reason skipping is
  // an acceptable choice, so it is asserted here rather than left implicit.
  // -------------------------------------------------------------------------
  describe("orphaned project members", () => {
    const ORPHAN_USER = makeTestUser("dup-orphan-user-id", "Offboarded User");
    const ORPHAN_USER_ID = ORPHAN_USER.id;

    beforeAll(async () => {
      // A real user row with NO `workspace_member` row for `workspaceId` —
      // exactly the state left behind by removing someone from the workspace.
      await seedUser(d1, ORPHAN_USER);
    });

    it("does not copy a source member who is no longer a workspace member", async () => {
      const projId = await seedProject(d1, workspaceId, { name: "Has Orphan" });
      await seedProjectMember(d1, projId, TEST_USER.id, "admin");
      await seedProjectMember(d1, projId, TEST_USER_2.id, "viewer");
      await seedProjectMember(d1, projId, ORPHAN_USER_ID, "member");

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}/duplicate`,
        jsonRequest("POST", `/projects/${projId}/duplicate`, { includeMembers: true }),
      );

      expect(res.status).toBe(201);
      const body = await res.json<{ project: { id: string }; skippedMemberIds: string[] }>();

      const members = await d1
        .prepare("SELECT userId, role FROM project_member WHERE projectId = ?")
        .bind(body.project.id)
        .all<{ userId: string; role: string }>();
      const copiedIds = members.results.map((m) => m.userId);

      // The orphan is gone from the copy...
      expect(copiedIds).not.toContain(ORPHAN_USER_ID);
      // ...and the genuine member is still there (the filter is not "copy nobody").
      expect(members.results).toContainEqual(expect.objectContaining({ userId: TEST_USER_2.id, role: "viewer" }));
      expect(members.results).toContainEqual(expect.objectContaining({ userId: TEST_USER.id, role: "admin" }));
      expect(members.results).toHaveLength(2);

      // The drop is reported, not silent.
      expect(body.skippedMemberIds).toEqual([ORPHAN_USER_ID]);

      // The source project is untouched — duplication cleans the COPY, it does
      // not retroactively repair the original.
      const sourceMembers = await d1
        .prepare("SELECT userId FROM project_member WHERE projectId = ?")
        .bind(projId)
        .all<{ userId: string }>();
      expect(sourceMembers.results.map((m) => m.userId)).toContain(ORPHAN_USER_ID);
    });

    it("still produces a usable project when every source member is orphaned", async () => {
      const projId = await seedProject(d1, workspaceId, { name: "All Orphans" });
      await seedProjectMember(d1, projId, ORPHAN_USER_ID, "admin");

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}/duplicate`,
        jsonRequest("POST", `/projects/${projId}/duplicate`, { includeMembers: true }),
      );

      expect(res.status).toBe(201);
      const body = await res.json<{ project: { id: string }; skippedMemberIds: string[] }>();

      const members = await d1
        .prepare("SELECT userId, role FROM project_member WHERE projectId = ?")
        .bind(body.project.id)
        .all<{ userId: string; role: string }>();

      // The duplicating user is still admin — the guard must never strand a
      // project with no one able to administer it.
      expect(members.results).toEqual([
        expect.objectContaining({ userId: TEST_USER.id, role: "admin" }),
      ]);
      expect(body.skippedMemberIds).toEqual([ORPHAN_USER_ID]);
    });

    it("never copies orphans when includeMembers is false, and reports nothing skipped", async () => {
      const projId = await seedProject(d1, workspaceId, { name: "Orphan No Include" });
      await seedProjectMember(d1, projId, ORPHAN_USER_ID, "member");
      await seedProjectMember(d1, projId, TEST_USER_2.id, "viewer");

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}/duplicate`,
        jsonRequest("POST", `/projects/${projId}/duplicate`, {}),
      );

      expect(res.status).toBe(201);
      const body = await res.json<{ project: { id: string }; skippedMemberIds: string[] }>();

      const members = await d1
        .prepare("SELECT userId FROM project_member WHERE projectId = ?")
        .bind(body.project.id)
        .all<{ userId: string }>();

      expect(members.results.map((m) => m.userId)).toEqual([TEST_USER.id]);
      // Nothing was "skipped" — members simply weren't requested. Reporting the
      // orphan here would be a false alarm on every non-member duplicate.
      expect(body.skippedMemberIds).toEqual([]);
    });

    /**
     * Same helper, second caller, and the half of it the orphan cases above
     * cannot reach.
     *
     * Every principal in the orphan tests belongs to no workspace at all, so
     * they are dropped by the "is a member" half of `selectWorkspaceMemberIds`
     * on its own. Deleting the `workspaceId` predicate leaves all three of them
     * still skipped and this whole describe still green — while duplication
     * starts minting `project_member` rows for members of OTHER tenants, on a
     * brand-new project, in one click, with the drop silently absent from
     * `skippedMemberIds`. `addMember` and `duplicateProject` share the helper
     * precisely so they cannot drift, which is why the boundary is pinned from
     * both callers rather than once.
     */
    it("does not copy a source member who belongs to a different workspace", async () => {
      const projId = await seedProject(d1, workspaceId, { name: "Has Foreign Member" });
      await seedProjectMember(d1, projId, TEST_USER.id, "admin");
      await seedProjectMember(d1, projId, TEST_USER_2.id, "viewer");
      // A live member of `foreignWorkspaceId`, stray-listed on a project of ours.
      await seedProjectMember(d1, projId, FOREIGN_WORKSPACE_USER_ID, "member");

      const app = createApp();
      const res = await app.request(
        `/projects/${projId}/duplicate`,
        jsonRequest("POST", `/projects/${projId}/duplicate`, { includeMembers: true }),
      );

      expect(res.status).toBe(201);
      const body = await res.json<{ project: { id: string }; skippedMemberIds: string[] }>();

      const members = await d1
        .prepare("SELECT userId, role FROM project_member WHERE projectId = ?")
        .bind(body.project.id)
        .all<{ userId: string; role: string }>();

      expect(members.results.map((m) => m.userId)).not.toContain(FOREIGN_WORKSPACE_USER_ID);
      // The genuine members still copy — the rule is "wrong tenant", not "copy nobody".
      expect(members.results).toContainEqual(expect.objectContaining({ userId: TEST_USER.id, role: "admin" }));
      expect(members.results).toContainEqual(expect.objectContaining({ userId: TEST_USER_2.id, role: "viewer" }));
      expect(members.results).toHaveLength(2);

      expect(body.skippedMemberIds).toEqual([FOREIGN_WORKSPACE_USER_ID]);

      // The copy lives in OUR workspace, so the foreign user's own tenant is
      // not what excluded them — the workspace of the project being copied is.
      const copiedProject = await d1
        .prepare("SELECT workspaceId FROM project WHERE id = ?")
        .bind(body.project.id)
        .first<{ workspaceId: string }>();
      expect(copiedProject!.workspaceId).toBe(workspaceId);
      expect(copiedProject!.workspaceId).not.toBe(foreignWorkspaceId);
    });
  });

  it("duplicating user is promoted to admin even if they were member in source", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Promote Admin" });
    await seedProjectMember(d1, projId, TEST_USER.id, "member");
    await seedProjectMember(d1, projId, TEST_USER_2.id, "admin");

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, { includeMembers: true }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { id: string } }>();

    const members = await d1
      .prepare("SELECT userId, role FROM project_member WHERE projectId = ?")
      .bind(body.project.id)
      .all();

    // duplicating user should appear exactly once as admin
    const userEntries = members.results.filter((m: Record<string, unknown>) => m.userId === TEST_USER.id);
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0]).toMatchObject({ role: "admin" });
  });

  it("returns 404 for a nonexistent project", async () => {
    const app = createApp();
    const res = await app.request(
      "/projects/nonexistent-id/duplicate",
      jsonRequest("POST", "/projects/nonexistent-id/duplicate", {}),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Project not found");
  });

  it("truncates name when source name is near max length", async () => {
    const longName = "A".repeat(100);
    const projId = await seedProject(d1, workspaceId, { name: longName });

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, {}),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { name: string } }>();
    expect(body.project.name).toBe("A".repeat(93) + " (copy)");
    expect(body.project.name.length).toBeLessThanOrEqual(100);
  });

  it("duplicates project with no task groups or labels", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Empty Project" });

    const app = createApp();
    const res = await app.request(
      `/projects/${projId}/duplicate`,
      jsonRequest("POST", `/projects/${projId}/duplicate`, {}),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ project: { id: string; name: string } }>();
    expect(body.project.name).toBe("Empty Project (copy)");

    const groups = await d1
      .prepare("SELECT id FROM task_group WHERE projectId = ?")
      .bind(body.project.id)
      .all();
    expect(groups.results).toHaveLength(0);

    const labels = await d1
      .prepare("SELECT id FROM label WHERE projectId = ?")
      .bind(body.project.id)
      .all();
    expect(labels.results).toHaveLength(0);
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

  /**
   * The WORKSPACE half of the membership check — the half that makes this a
   * tenancy boundary rather than a "does this account exist" test.
   *
   * `selectWorkspaceMemberIds` asks two things at once: is this user a member,
   * and is it THIS workspace they are a member of. Every other negative fixture
   * here uses a user who belongs to no workspace at all, and such a user is
   * rejected by the first half alone — so the `workspaceId` predicate can be
   * deleted, silently weakening the rule from "member of this workspace" to
   * "member of any workspace", without a single assertion in this file
   * changing colour. What ships then is cross-tenant member injection: any
   * signed-up user of any other customer's workspace can be dropped into this
   * project, and because `resolveProjectAccess` honours a `project_member` row
   * joined against workspace membership they land inside someone else's data.
   *
   * The fixture therefore has to be a real, live member of a DIFFERENT
   * workspace — the one shape that separates the two rules.
   */
  it("returns 400 when the user is a member of a DIFFERENT workspace", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${addMemberProjectId}/members`,
      jsonRequest("POST", `/projects/${addMemberProjectId}/members`, {
        userId: FOREIGN_WORKSPACE_USER_ID,
        role: "member",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("User is not a member of the workspace");

    // And nothing was written — a handler that returns 400 after inserting is
    // exactly what a status-only assertion cannot see.
    const row = await d1
      .prepare("SELECT id FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(addMemberProjectId, FOREIGN_WORKSPACE_USER_ID)
      .first();
    expect(row).toBeNull();
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

describe("updateMemberRole", () => {
  /**
   * Mounts the route WITHOUT `fakeAuth`'s `projectAccess` injection on purpose.
   *
   * In production `requireProjectRole("admin")` runs first and caches the
   * answer, so the handler's own `resolveProjectAccess` call never fires. Tests
   * that pre-seed the cache would therefore only ever exercise the branch that
   * cannot fail, and the fallback — the thing standing between a dropped
   * middleware and an open member-management endpoint — would be untested
   * forever. Leaving the cache empty makes every test below run the real
   * resolution against real rows, which is also what lets the "not an admin"
   * case be expressed as a seeded role rather than as an injected claim.
   */
  function createApp(user = TEST_USER) {
    const app = new Hono<AppEnv>();
    app.patch(
      "/projects/:projectId/members/:userId",
      fakeAuth(d1, user, {
        workspaceMembership: { id: "wm-update-role", role: "owner" },
      }),
      validateBody(updateProjectMemberRoleSchema),
      updateMemberRole,
    );
    return app;
  }

  async function patchRole(app: Hono<AppEnv>, projId: string, userId: string, role: string) {
    const path = `/projects/${projId}/members/${userId}`;
    return app.request(path, jsonRequest("PATCH", path, { role }));
  }

  it("changes a member's role and returns the updated row", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Role Change Project" });
    await seedProjectMember(d1, projId, TEST_USER_2.id, "viewer");

    const res = await patchRole(createApp(), projId, TEST_USER_2.id, "admin");

    expect(res.status).toBe(200);
    const body = await res.json<{ member: { userId: string; role: string } }>();
    expect(body.member).toMatchObject({ userId: TEST_USER_2.id, role: "admin" });

    const row = await d1
      .prepare("SELECT role FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(projId, TEST_USER_2.id)
      .first<{ role: string }>();
    expect(row?.role).toBe("admin");
  });

  /**
   * Bounds the blast radius, which asserting the target row alone cannot.
   *
   * The UPDATE is keyed on (projectId, userId, oldRole). Drop the `projectId`
   * half and the statement still satisfies the assertion above while rewriting
   * that user's role in every project they belong to, across every workspace in
   * the deployment — "make Dana an admin of the Q3 board" would make Dana an
   * admin of the company. Silent, 200, no error path. A bystander membership in
   * a DIFFERENT WORKSPACE is the only thing that catches it, and it is asserted
   * to keep its original role rather than merely to exist.
   */
  it("changes the role in ONLY the named project", async () => {
    const targetProjId = await seedProject(d1, workspaceId, { name: "Scoped Role Target" });
    const bystanderProjId = await seedProject(d1, workspaceId, { name: "Scoped Role Bystander" });
    const foreignProjId = await seedProject(d1, foreignWorkspaceId, {
      name: "Scoped Role Foreign Bystander",
    });
    await seedProjectMember(d1, targetProjId, TEST_USER_2.id, "viewer");
    await seedProjectMember(d1, bystanderProjId, TEST_USER_2.id, "viewer");
    await seedProjectMember(d1, foreignProjId, TEST_USER_2.id, "viewer");

    const res = await patchRole(createApp(), targetProjId, TEST_USER_2.id, "admin");
    expect(res.status).toBe(200);

    const rows = await d1
      .prepare("SELECT projectId, role FROM project_member WHERE userId = ?")
      .bind(TEST_USER_2.id)
      .all<{ projectId: string; role: string }>();
    const byProject = new Map(rows.results.map((r) => [r.projectId, r.role]));
    expect(byProject.get(targetProjId)).toBe("admin");
    expect(byProject.get(bystanderProjId)).toBe("viewer");
    expect(byProject.get(foreignProjId)).toBe("viewer");
  });

  it("returns 404 when the target has no membership row in this project", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Role Change Absent Target" });

    const res = await patchRole(createApp(), projId, TEST_USER_2.id, "admin");

    expect(res.status).toBe(404);
    expect((await res.json<{ error: string }>()).error).toBe("Member not found");
  });

  /**
   * Self-demotion is the one move whose damage the actor cannot undo: a project
   * admin who is only a plain workspace member and re-roles their own row to
   * `viewer` loses the settings page that submitted the request. The refusal is
   * asserted alongside the row being untouched, because a 403 that had already
   * written would be the worst of both outcomes.
   */
  it("refuses to let an admin change their own role", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Self Role Change" });
    await seedProjectMember(d1, projId, TEST_USER.id, "admin");

    const res = await patchRole(createApp(), projId, TEST_USER.id, "viewer");

    expect(res.status).toBe(403);
    expect((await res.json<{ error: string }>()).error).toBe(
      "You cannot change your own project role",
    );

    const row = await d1
      .prepare("SELECT role FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(projId, TEST_USER.id)
      .first<{ role: string }>();
    expect(row?.role).toBe("admin");
  });

  /**
   * The handler's own authority check, exercised with NO middleware in front of
   * it — which is precisely the scenario it exists for. `TEST_USER_2` is a plain
   * workspace member seeded as a project `member`, so `resolveProjectAccess`
   * resolves a real, non-elevated, non-admin role and the handler must refuse
   * on its own rather than on a mount it cannot see.
   */
  it("returns 403 when the caller is not a project admin", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Non Admin Role Change" });
    await seedProjectMember(d1, projId, TEST_USER_2.id, "member");
    await seedProjectMember(d1, projId, FOREIGN_WORKSPACE_USER_ID, "viewer");

    const app = new Hono<AppEnv>();
    app.patch(
      "/projects/:projectId/members/:userId",
      // No `workspaceMembership` and no `projectAccess`: nothing is injected,
      // so the handler's own resolution is the only thing deciding.
      fakeAuth(d1, TEST_USER_2),
      validateBody(updateProjectMemberRoleSchema),
      updateMemberRole,
    );

    const res = await patchRole(app, projId, FOREIGN_WORKSPACE_USER_ID, "admin");

    expect(res.status).toBe(403);
    expect((await res.json<{ error: string }>()).error).toBe("Forbidden");

    const row = await d1
      .prepare("SELECT role FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(projId, FOREIGN_WORKSPACE_USER_ID)
      .first<{ role: string }>();
    expect(row?.role).toBe("viewer");
  });

  /**
   * Submitting the role the member already holds is the default path through
   * the dialog (it pre-selects the current role), so it must succeed — and it
   * must not be reported as a change. The `project.updatedAt` bump is the
   * observable proxy for "the write path ran": a no-op that touches it would
   * also have emitted a `member_role_changed` webhook whose `from` equals its
   * `to`, teaching every integration downstream to filter our events for us.
   */
  it("treats an unchanged role as a no-op and does not touch the project", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "No Op Role Change" });
    await seedProjectMember(d1, projId, TEST_USER_2.id, "member");

    const before = await d1
      .prepare("SELECT updatedAt FROM project WHERE id = ?")
      .bind(projId)
      .first<{ updatedAt: number }>();

    const res = await patchRole(createApp(), projId, TEST_USER_2.id, "member");

    expect(res.status).toBe(200);
    const body = await res.json<{ member: { role: string } }>();
    expect(body.member.role).toBe("member");

    const after = await d1
      .prepare("SELECT updatedAt FROM project WHERE id = ?")
      .bind(projId)
      .first<{ updatedAt: number }>();
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("returns 400 for a role outside PROJECT_ROLES", async () => {
    const projId = await seedProject(d1, workspaceId, { name: "Invalid Role Change" });
    await seedProjectMember(d1, projId, TEST_USER_2.id, "member");

    const res = await patchRole(createApp(), projId, TEST_USER_2.id, "owner");

    expect(res.status).toBe(400);

    const row = await d1
      .prepare("SELECT role FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(projId, TEST_USER_2.id)
      .first<{ role: string }>();
    expect(row?.role).toBe("member");
  });
});

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

  /**
   * The blast radius of the removal, which asserting only that the target row
   * is gone can never bound.
   *
   * The DELETE is keyed on (projectId, userId). Drop the `projectId` half and
   * the statement still removes the row this test looks for — and every other
   * `project_member` row that user holds, in every project, in every workspace
   * in the deployment. "Remove Dana from the Q3 launch board" would evict Dana
   * from the company. It is a destructive, unrecoverable write with a 200
   * response and no error path, and the only thing that catches it is a
   * BYSTANDER membership that is asserted to survive.
   *
   * The surviving membership is deliberately in a different workspace as well
   * as a different project, so a scope that is narrowed to the workspace rather
   * than the project is still caught. The exact remaining-row count is asserted
   * too, because "the bystander survived" alone would still pass a delete that
   * took out some third project's row.
   */
  it("removes the membership from ONLY the named project", async () => {
    const targetProjId = await seedProject(d1, workspaceId, {
      name: "Scoped Remove Target",
    });
    const bystanderProjId = await seedProject(d1, workspaceId, {
      name: "Scoped Remove Bystander",
    });
    const foreignProjId = await seedProject(d1, foreignWorkspaceId, {
      name: "Scoped Remove Foreign Bystander",
    });
    await seedProjectMember(d1, targetProjId, TEST_USER_2.id, "member");
    await seedProjectMember(d1, bystanderProjId, TEST_USER_2.id, "admin");
    await seedProjectMember(d1, foreignProjId, TEST_USER_2.id, "viewer");

    const before = await d1
      .prepare("SELECT COUNT(*) AS n FROM project_member WHERE userId = ?")
      .bind(TEST_USER_2.id)
      .first<{ n: number }>();

    const app = createApp();
    const res = await app.request(
      `/projects/${targetProjId}/members/${TEST_USER_2.id}`,
      jsonRequest("DELETE", `/projects/${targetProjId}/members/${TEST_USER_2.id}`),
    );
    expect(res.status).toBe(200);

    // The named membership is gone...
    const removed = await d1
      .prepare("SELECT id FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(targetProjId, TEST_USER_2.id)
      .first();
    expect(removed).toBeNull();

    // ...and no other membership of theirs was touched, role intact.
    const bystander = await d1
      .prepare("SELECT role FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(bystanderProjId, TEST_USER_2.id)
      .first<{ role: string }>();
    expect(bystander).not.toBeNull();
    expect(bystander!.role).toBe("admin");

    const foreignBystander = await d1
      .prepare("SELECT role FROM project_member WHERE projectId = ? AND userId = ?")
      .bind(foreignProjId, TEST_USER_2.id)
      .first<{ role: string }>();
    expect(foreignBystander).not.toBeNull();
    expect(foreignBystander!.role).toBe("viewer");

    // Exactly one row left, deployment-wide.
    const after = await d1
      .prepare("SELECT COUNT(*) AS n FROM project_member WHERE userId = ?")
      .bind(TEST_USER_2.id)
      .first<{ n: number }>();
    expect(after!.n).toBe(before!.n - 1);
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

// ---------------------------------------------------------------------------
// Cover image handlers — upload / apply-Unsplash / delete + XOR invariant
// ---------------------------------------------------------------------------

describe("project cover image handlers", () => {
  // These tests need both D1 and R2, which the default `createTestD1` doesn't
  // provide, so we provision a dedicated Miniflare instance via the shared
  // `createTestD1WithR2` helper.
  let coverD1: D1Database;
  let coverStorage: R2Bucket;
  let coverDispose: () => Promise<void>;
  let coverWorkspaceId: string;

  beforeAll(async () => {
    const result = await createTestD1WithR2();
    coverD1 = result.d1;
    coverStorage = result.storage;
    coverDispose = result.dispose;

    await seedUser(coverD1);
    await seedUser(coverD1, TEST_USER_2);
    coverWorkspaceId = await seedWorkspace(coverD1, TEST_USER.id);
  });

  afterAll(async () => {
    await coverDispose();
  });

  /**
   * Auth middleware that wires real R2 + optional UNSPLASH_ACCESS_KEY into
   * c.env. The `storage` / `unsplashAccessKey` opts can be set to `null` to
   * exercise the 503 paths.
   */
  function coverAuth(opts?: {
    user?: typeof TEST_USER | typeof TEST_USER_2;
    storage?: R2Bucket | null;
    unsplashAccessKey?: string | null;
  }): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      const envRec = c.env as Record<string, unknown>;
      envRec.DB = coverD1;
      if (opts?.storage !== null) {
        envRec.STORAGE = opts?.storage ?? coverStorage;
      }
      if (opts?.unsplashAccessKey !== null) {
        envRec.UNSPLASH_ACCESS_KEY = opts?.unsplashAccessKey ?? "test-access-key";
        envRec.UNSPLASH_APP_NAME = "cadence-test";
      }

      c.set("db", createDb(coverD1));
      c.set("user", (opts?.user ?? TEST_USER) as never);
      c.set("session", null);
      c.set("requestId", "test-request-id");

      await next();
    };
  }

  /** Build a request carrying a JSON Unsplash payload. */
  function unsplashRequest(projectId: string, payload: UnsplashCoverPayload): Request {
    return new Request(
      `http://localhost/projects/${projectId}/cover/unsplash`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }

  /** Build a multipart upload request for the R2 cover path. */
  function uploadRequest(projectId: string, file: File): Request {
    const form = new FormData();
    form.append("file", file);
    return new Request(`http://localhost/projects/${projectId}/cover`, {
      method: "PUT",
      body: form,
    });
  }

  /** Read `cover_image_key` + `cover_unsplash` straight from SQLite. */
  async function readCoverState(projectId: string) {
    const row = await coverD1
      .prepare(
        "SELECT cover_image_key AS k, cover_unsplash AS u FROM project WHERE id = ?",
      )
      .bind(projectId)
      .first<{ k: string | null; u: string | null }>();
    return {
      coverImageKey: row?.k ?? null,
      // Stored (lenient) shape: this is a raw DB read — legacy rows may lack
      // `rawUrl`, so casting to the strict apply-payload type would be a lie.
      coverUnsplash: row?.u ? (JSON.parse(row.u) as StoredUnsplashCoverPayload) : null,
    };
  }

  // -------------------------------------------------------------------------
  // fetch mocking for trackDownload
  //
  // `trackDownload` issues a real HTTP GET against the Unsplash API. We
  // replace `globalThis.fetch` per-test via the shared `installFetchSpy`
  // helper so no outbound network call fires and we can assert on the call.
  // -------------------------------------------------------------------------
  let fetchSpy: ReturnType<typeof installFetchSpy>;

  beforeEach(() => {
    fetchSpy = installFetchSpy();
  });

  afterEach(() => {
    fetchSpy.restore();
  });

  // -------------------------------------------------------------------------
  // applyProjectUnsplashCover
  // -------------------------------------------------------------------------

  it("applies an Unsplash cover on a project with no existing cover and tracks download once", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "No Cover",
    });

    const app = new Hono<AppEnv>();
    app.put(
      "/projects/:projectId/cover/unsplash",
      coverAuth(),
      validateBody(unsplashCoverPayloadSchema),
      applyProjectUnsplashCover,
    );

    const payload = sampleUnsplashPayload("p-apply-fresh");
    const res = await app.request(unsplashRequest(projectId, payload));
    expect(res.status).toBe(200);

    const body = await res.json<{
      coverImageKey: string | null;
      coverUnsplash: StoredUnsplashCoverPayload | null;
    }>();
    expect(body.coverImageKey).toBeNull();
    expect(body.coverUnsplash).toMatchObject({ id: "p-apply-fresh" });

    const state = await readCoverState(projectId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash?.id).toBe("p-apply-fresh");

    // trackDownload hits the payload's download_location with the Client-ID header.
    const matching = fetchSpy.calls.filter(
      ([url]) => typeof url === "string" && url.startsWith(payload.downloadLocation),
    );
    expect(matching.length).toBe(1);
    const init = matching[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Client-ID test-access-key");
  });

  it("applies an Unsplash cover on a project that had an R2 upload, deleting the R2 object and upload row", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "Swap R2 -> Unsplash",
    });

    // First upload a real R2 cover so the swap path exercises cleanup.
    const uploadApp = new Hono<AppEnv>();
    uploadApp.put("/projects/:projectId/cover", coverAuth(), uploadProjectCover);
    const uploadRes = await uploadApp.request(
      uploadRequest(projectId, fakeCoverPngFile()),
    );
    expect(uploadRes.status).toBe(200);
    const uploaded = await uploadRes.json<{ coverImageKey: string }>();
    const oldKey = uploaded.coverImageKey;
    const oldObj = await coverStorage.get(oldKey);
    expect(oldObj).not.toBeNull();

    // Now apply an Unsplash cover.
    const app = new Hono<AppEnv>();
    app.put(
      "/projects/:projectId/cover/unsplash",
      coverAuth(),
      validateBody(unsplashCoverPayloadSchema),
      applyProjectUnsplashCover,
    );
    const payload = sampleUnsplashPayload("p-swap-r2-us");
    const res = await app.request(unsplashRequest(projectId, payload));
    expect(res.status).toBe(200);

    // DB: coverImageKey cleared, Unsplash set (XOR).
    const state = await readCoverState(projectId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash?.id).toBe("p-swap-r2-us");

    // R2 object gone, upload row gone.
    const cleaned = await coverStorage.get(oldKey);
    expect(cleaned).toBeNull();
    const uploadRow = await coverD1
      .prepare("SELECT id FROM upload WHERE key = ?")
      .bind(oldKey)
      .first();
    expect(uploadRow).toBeNull();
  });

  it("uploading an R2 cover after an Unsplash cover clears coverUnsplash (XOR)", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "Swap Unsplash -> R2",
      coverUnsplash: sampleUnsplashPayload("p-pre-existing"),
    });

    const app = new Hono<AppEnv>();
    app.put("/projects/:projectId/cover", coverAuth(), uploadProjectCover);
    const res = await app.request(uploadRequest(projectId, fakeCoverPngFile()));
    expect(res.status).toBe(200);
    const body = await res.json<{
      coverImageKey: string;
      coverUnsplash: StoredUnsplashCoverPayload | null;
    }>();
    expect(body.coverImageKey).toMatch(/^project-cover\//);
    expect(body.coverUnsplash).toBeNull();

    const state = await readCoverState(projectId);
    expect(state.coverImageKey).toBe(body.coverImageKey);
    expect(state.coverUnsplash).toBeNull();
  });

  // -------------------------------------------------------------------------
  // deleteProjectCover
  // -------------------------------------------------------------------------

  it("deleting a cover when Unsplash was set nulls both columns (no R2 cleanup needed)", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "Delete Unsplash",
      coverUnsplash: sampleUnsplashPayload("p-del-us"),
    });

    const app = new Hono<AppEnv>();
    app.delete("/projects/:projectId/cover", coverAuth(), deleteProjectCover);

    const res = await app.request(
      new Request(`http://localhost/projects/${projectId}/cover`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    const state = await readCoverState(projectId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash).toBeNull();
  });

  it("deleting a cover when R2 was set removes the R2 object and nulls both columns", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "Delete R2",
    });

    const uploadApp = new Hono<AppEnv>();
    uploadApp.put("/projects/:projectId/cover", coverAuth(), uploadProjectCover);
    const uploadRes = await uploadApp.request(
      uploadRequest(projectId, fakeCoverPngFile()),
    );
    expect(uploadRes.status).toBe(200);
    const { coverImageKey: key } = await uploadRes.json<{
      coverImageKey: string;
    }>();

    const delApp = new Hono<AppEnv>();
    delApp.delete(
      "/projects/:projectId/cover",
      coverAuth(),
      deleteProjectCover,
    );
    const res = await delApp.request(
      new Request(`http://localhost/projects/${projectId}/cover`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);

    const state = await readCoverState(projectId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash).toBeNull();

    const obj = await coverStorage.get(key);
    expect(obj).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Config / availability
  // -------------------------------------------------------------------------

  it("returns 503 when UNSPLASH_ACCESS_KEY is absent", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "No Unsplash Config",
    });

    const app = new Hono<AppEnv>();
    app.put(
      "/projects/:projectId/cover/unsplash",
      coverAuth({ unsplashAccessKey: null }),
      validateBody(unsplashCoverPayloadSchema),
      applyProjectUnsplashCover,
    );

    const res = await app.request(
      unsplashRequest(projectId, sampleUnsplashPayload("p-503")),
    );
    expect(res.status).toBe(503);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("Unsplash");
  });

  // -------------------------------------------------------------------------
  // Read shape audit — project detail exposes coverUnsplash in both states
  // -------------------------------------------------------------------------

  it("project detail response includes coverUnsplash (null when unset, object when applied)", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "Detail Reads",
    });

    const getApp = new Hono<AppEnv>();
    getApp.get("/projects/:projectId", coverAuth(), getProject);

    const r1 = await getApp.request(
      `/projects/${projectId}`,
      jsonRequest("GET", `/projects/${projectId}`),
    );
    expect(r1.status).toBe(200);
    const body1 = await r1.json<{
      project: {
        coverImageKey: string | null;
        coverUnsplash: StoredUnsplashCoverPayload | null;
      };
    }>();
    expect(body1.project).toHaveProperty("coverUnsplash");
    expect(body1.project.coverUnsplash).toBeNull();

    // Apply an Unsplash cover and re-read.
    const applyApp = new Hono<AppEnv>();
    applyApp.put(
      "/projects/:projectId/cover/unsplash",
      coverAuth(),
      validateBody(unsplashCoverPayloadSchema),
      applyProjectUnsplashCover,
    );
    const applyRes = await applyApp.request(
      unsplashRequest(projectId, sampleUnsplashPayload("p-detail-reads")),
    );
    expect(applyRes.status).toBe(200);

    const r2 = await getApp.request(
      `/projects/${projectId}`,
      jsonRequest("GET", `/projects/${projectId}`),
    );
    const body2 = await r2.json<{
      project: { coverUnsplash: StoredUnsplashCoverPayload | null };
    }>();
    expect(body2.project.coverUnsplash?.id).toBe("p-detail-reads");
  });

  // -------------------------------------------------------------------------
  // Duplicate does NOT carry coverUnsplash
  // -------------------------------------------------------------------------

  it("duplicating a project with a coverUnsplash set does not carry it over", async () => {
    const projectId = await seedProject(coverD1, coverWorkspaceId, {
      name: "Dup Source",
      coverUnsplash: sampleUnsplashPayload("p-dup-src"),
    });

    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/duplicate",
      coverAuth(),
      validateBody(duplicateProjectSchema),
      duplicateProject,
    );

    const res = await app.request(
      `/projects/${projectId}/duplicate`,
      jsonRequest("POST", `/projects/${projectId}/duplicate`, {}),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      project: { id: string; coverUnsplash: StoredUnsplashCoverPayload | null };
    }>();
    expect(body.project.coverUnsplash).toBeNull();

    // Also verify the DB (JSON column) — the handler returns the in-memory
    // object but a downstream select should also see null.
    const state = await readCoverState(body.project.id);
    expect(state.coverUnsplash).toBeNull();
  });
});
