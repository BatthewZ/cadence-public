/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the workspace search handler.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the LIKE-based search
 * logic, role-scoped visibility, and metacharacter escaping are all exercised
 * against actual SQL. This catches query-shape regressions that mocks would miss.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { searchQuerySchema } from "../../../shared/schemas/search";
import type { AppEnv } from "../../env";
import { validateQuery } from "../../middleware/validate";
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
import { workspaceSearch } from "./search.handlers";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let project1Id: string;
let project2Id: string;
let taskGroup1Id: string;
let taskGroup2Id: string;
let task1Id: string;
let task2Id: string;
let task3Id: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  // Seed users
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);

  // Workspace owned by TEST_USER
  workspaceId = await seedWorkspace(d1, TEST_USER.id);

  // TEST_USER_2 is a regular member of the workspace
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

  // Project 1: "Alpha Project" - TEST_USER_2 is a member
  project1Id = await seedProject(d1, workspaceId, {
    id: "proj-1",
    name: "Alpha Project",
  });
  await d1
    .prepare("UPDATE project SET description = ? WHERE id = ?")
    .bind("Handles alpha workflows", project1Id)
    .run();
  await d1
    .prepare("UPDATE project SET icon = ? WHERE id = ?")
    .bind("rocket", project1Id)
    .run();
  await seedProjectMember(d1, project1Id, TEST_USER_2.id, "member");

  // Project 2: "Beta Project" - TEST_USER_2 is NOT a member
  project2Id = await seedProject(d1, workspaceId, {
    id: "proj-2",
    name: "Beta Project",
  });
  await d1
    .prepare("UPDATE project SET description = ? WHERE id = ?")
    .bind("Handles beta workflows", project2Id)
    .run();
  await d1
    .prepare("UPDATE project SET icon = ? WHERE id = ?")
    .bind("star", project2Id)
    .run();

  // Task groups
  taskGroup1Id = await seedTaskGroup(d1, project1Id);
  taskGroup2Id = await seedTaskGroup(d1, project2Id);

  // Tasks in project 1
  task1Id = await seedTask(d1, project1Id, taskGroup1Id, {
    id: "task-1",
    title: "Fix alpha bug",
  });
  await d1
    .prepare("UPDATE task SET description = ? WHERE id = ?")
    .bind("An alpha-related issue", task1Id)
    .run();

  task2Id = await seedTask(d1, project1Id, taskGroup1Id, {
    id: "task-2",
    title: "Implement feature",
  });

  // Task in project 2
  task3Id = await seedTask(d1, project2Id, taskGroup2Id, {
    id: "task-3",
    title: "Fix beta bug",
  });
  await d1
    .prepare("UPDATE task SET description = ? WHERE id = ?")
    .bind("A beta-related issue", task3Id)
    .run();
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const ownerAuth = () =>
  fakeAuth(d1, TEST_USER, {
    workspaceMembership: { id: "wm-1", role: "owner" },
  });

const memberAuth = () =>
  fakeAuth(d1, TEST_USER_2, {
    workspaceMembership: { id: "wm-2", role: "member" },
  });

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp(auth: ReturnType<typeof ownerAuth>) {
  const app = new Hono<AppEnv>();
  app.get(
    "/workspaces/:workspaceId/search",
    auth,
    validateQuery(searchQuerySchema),
    workspaceSearch,
  );
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workspaceSearch", () => {
  it("owner can search and see results from ALL projects", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=bug`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=bug`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>();

    // "bug" matches tasks in both projects
    const taskIds = body.tasks.map((t) => t.id);
    expect(taskIds).toContain(task1Id);
    expect(taskIds).toContain(task3Id);
  });

  it("regular member only sees results from projects they belong to", async () => {
    const app = buildApp(memberAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=bug`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=bug`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>();

    // Member should only see task1 from project1
    const taskIds = body.tasks.map((t) => t.id);
    expect(taskIds).toContain(task1Id);
    expect(taskIds).not.toContain(task3Id);
  });

  it("matches project name with LIKE pattern", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=Alpha`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=Alpha`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string; name: string }[];
      tasks: { id: string }[];
    }>();

    const projectIds = body.projects.map((p) => p.id);
    expect(projectIds).toContain(project1Id);
    expect(projectIds).not.toContain(project2Id);
  });

  it("matches project description with LIKE pattern", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=beta workflows`,
      jsonRequest(
        "GET",
        `/workspaces/${workspaceId}/search?q=beta workflows`,
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string; name: string }[];
      tasks: { id: string }[];
    }>();

    const projectIds = body.projects.map((p) => p.id);
    expect(projectIds).toContain(project2Id);
  });

  it("matches task title with LIKE pattern", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=Implement`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=Implement`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: { id: string; title: string }[];
    }>();

    const taskIds = body.tasks.map((t) => t.id);
    expect(taskIds).toContain(task2Id);
    expect(taskIds).not.toContain(task1Id);
    expect(taskIds).not.toContain(task3Id);
  });

  it("matches task description with LIKE pattern", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=alpha-related`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=alpha-related`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>();

    const taskIds = body.tasks.map((t) => t.id);
    expect(taskIds).toContain(task1Id);
    expect(taskIds).not.toContain(task3Id);
  });

  it("respects limit parameter", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=bug&limit=1`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=bug&limit=1`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>();

    // There are 2 tasks matching "bug" but limit=1 should cap the results
    expect(body.tasks.length).toBeLessThanOrEqual(1);
  });

  it("returns empty results for non-matching query", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=zzzznonexistent`,
      jsonRequest(
        "GET",
        `/workspaces/${workspaceId}/search?q=zzzznonexistent`,
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>();

    expect(body.projects).toHaveLength(0);
    expect(body.tasks).toHaveLength(0);
  });

  it("does not error when query contains LIKE metacharacters (%, _)", async () => {
    // Seed a project whose name literally contains '%' and '_'
    await seedProject(d1, workspaceId, {
      name: "100% done_task",
    });

    const app = buildApp(ownerAuth());

    // The escapeLike function escapes %, _, and \ with a backslash prefix.
    // Verify the handler does not throw or produce a SQL error when these
    // characters appear in the query string.
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=${encodeURIComponent("100%")}`,
      jsonRequest(
        "GET",
        `/workspaces/${workspaceId}/search?q=${encodeURIComponent("100%")}`,
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string; name: string }[];
      tasks: { id: string }[];
    }>();

    // Verify the response shape is valid (no SQL error)
    expect(Array.isArray(body.projects)).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);

    // Searching with underscores should also not error
    const res2 = await app.request(
      `/workspaces/${workspaceId}/search?q=done_task`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=done_task`),
    );

    expect(res2.status).toBe(200);
    const body2 = await res2.json<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>();
    expect(Array.isArray(body2.projects)).toBe(true);
    expect(Array.isArray(body2.tasks)).toBe(true);
  });

  it("response includes task projectName and projectIcon from joined project", async () => {
    const app = buildApp(ownerAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=alpha bug`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=alpha bug`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: {
        id: string;
        projectId: string;
        projectName: string;
        projectIcon: string | null;
      }[];
    }>();

    const matchedTask = body.tasks.find((t) => t.id === task1Id);
    expect(matchedTask).toBeDefined();
    expect(matchedTask!.projectName).toBe("Alpha Project");
    expect(matchedTask!.projectIcon).toBe("rocket");
  });

  it("member cannot see projects they do not belong to", async () => {
    const app = buildApp(memberAuth());
    const res = await app.request(
      `/workspaces/${workspaceId}/search?q=Beta`,
      jsonRequest("GET", `/workspaces/${workspaceId}/search?q=Beta`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: { id: string }[];
      tasks: { id: string }[];
    }>();

    // "Beta Project" should not appear for the member
    const projectIds = body.projects.map((p) => p.id);
    expect(projectIds).not.toContain(project2Id);
  });
});
