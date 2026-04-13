/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for dashboard handler functions.
 *
 * These tests exercise the real SQL queries against an in-memory D1 database
 * (via Miniflare) to verify that workspace and project dashboards return
 * correct aggregations, respect role-based visibility, and paginate properly.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  myTasksQuerySchema,
  upcomingTasksQuerySchema,
  workspaceActivityQuerySchema,
} from "../../../shared/schemas/dashboard";
import type { AppEnv } from "../../env";
import { validateQuery } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
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
  myTasks,
  projectActivity,
  projectDashboard,
  upcomingTasks,
  workspaceActivity,
  workspaceDashboard,
} from "./dashboard.handlers";

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;

// Stable IDs for cross-test reference
const WORKSPACE_ID = "ws-dashboard-test";
const PROJECT_A_ID = "proj-a-dashboard";
const PROJECT_B_ID = "proj-b-dashboard";
const GROUP_TODO_A = "group-todo-a";
const GROUP_DONE_A = "group-done-a";
const GROUP_TODO_B = "group-todo-b";

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  // Seed users
  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);

  // Seed workspace (owner = TEST_USER)
  await seedWorkspace(d1, TEST_USER.id, {
    id: WORKSPACE_ID,
    name: "Dashboard WS",
    slug: "dashboard-ws",
  });

  // TEST_USER_2 is a regular member of the workspace
  await seedWorkspaceMember(d1, WORKSPACE_ID, TEST_USER_2.id, "member");

  // Project A — both users are members (budget: $500)
  await seedProject(d1, WORKSPACE_ID, { id: PROJECT_A_ID, name: "Project Alpha", budget: 50000 });
  await seedProjectMember(d1, PROJECT_A_ID, TEST_USER.id, "admin");
  await seedProjectMember(d1, PROJECT_A_ID, TEST_USER_2.id, "member");

  // Project B — only TEST_USER is a member
  await seedProject(d1, WORKSPACE_ID, { id: PROJECT_B_ID, name: "Project Beta" });
  await seedProjectMember(d1, PROJECT_B_ID, TEST_USER.id, "admin");

  // Task groups
  await seedTaskGroup(d1, PROJECT_A_ID, { id: GROUP_TODO_A, name: "To Do", position: "a0" });
  await seedTaskGroup(d1, PROJECT_A_ID, {
    id: GROUP_DONE_A,
    name: "Done",
    isCompletionGroup: true,
    position: "a1",
  });
  await seedTaskGroup(d1, PROJECT_B_ID, { id: GROUP_TODO_B, name: "Backlog", position: "a0" });

  // Tasks in Project A
  await seedTask(d1, PROJECT_A_ID, GROUP_TODO_A, {
    id: "task-a1",
    title: "Task A1",
    assigneeId: TEST_USER.id,
    dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
    position: "a0",
  });
  await seedTask(d1, PROJECT_A_ID, GROUP_TODO_A, {
    id: "task-a2",
    title: "Task A2",
    assigneeId: TEST_USER_2.id,
    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
    position: "a1",
  });
  await seedTask(d1, PROJECT_A_ID, GROUP_DONE_A, {
    id: "task-a3",
    title: "Task A3 (completed)",
    completed: true,
    assigneeId: TEST_USER.id,
    position: "a2",
  });

  // Overdue tasks in Project A — past due date, not completed
  await seedTask(d1, PROJECT_A_ID, GROUP_TODO_A, {
    id: "task-a-overdue1",
    title: "Overdue Task 1",
    assigneeId: TEST_USER.id,
    priority: "urgent",
    dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    position: "a3",
  });
  await seedTask(d1, PROJECT_A_ID, GROUP_TODO_A, {
    id: "task-a-overdue2",
    title: "Overdue Task 2",
    priority: "high",
    dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    position: "a4",
  });
  // Completed overdue task — should NOT appear in overdue list
  await seedTask(d1, PROJECT_A_ID, GROUP_DONE_A, {
    id: "task-a-overdue-completed",
    title: "Overdue but completed",
    completed: true,
    dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    position: "a5",
  });

  // Tasks with specific priorities for priority breakdown testing
  await seedTask(d1, PROJECT_A_ID, GROUP_TODO_A, {
    id: "task-a-medium",
    title: "Medium priority task",
    priority: "medium",
    position: "a6",
  });

  // Tasks in Project B
  await seedTask(d1, PROJECT_B_ID, GROUP_TODO_B, {
    id: "task-b1",
    title: "Task B1",
    assigneeId: TEST_USER.id,
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
    position: "a0",
  });
  await seedTask(d1, PROJECT_B_ID, GROUP_TODO_B, {
    id: "task-b2",
    title: "Task B2",
    position: "a1",
  });

  // Seed activity records for Project A tasks
  const { createDb } = await import("../../../db");
  const { taskActivity: taskActivityTable } = await import("../../../db/schema/task");
  const db = createDb(d1);
  const activityRecords = [
    { id: "act-1", taskId: "task-a1", actorId: TEST_USER.id, action: "created", createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    { id: "act-2", taskId: "task-a2", actorId: TEST_USER_2.id, action: "assigned", newValue: TEST_USER_2.id, createdAt: new Date(Date.now() - 30 * 60 * 1000) },
    { id: "act-3", taskId: "task-a1", actorId: TEST_USER.id, action: "priority_changed", field: "priority", oldValue: "none", newValue: "high", createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    // Activity for Project B task — should NOT appear in Project A activity
    { id: "act-b1", taskId: "task-b1", actorId: TEST_USER.id, action: "created", createdAt: new Date(Date.now() - 5 * 60 * 1000) },
  ];
  for (const rec of activityRecords) {
    await db.insert(taskActivityTable).values({
      id: rec.id,
      taskId: rec.taskId,
      actorId: rec.actorId,
      action: rec.action,
      field: rec.field ?? null,
      oldValue: rec.oldValue ?? null,
      newValue: rec.newValue ?? null,
      createdAt: rec.createdAt,
    });
  }

  // Add cost values to some tasks in Project A for cost aggregation tests.
  // task-a1: active, assigned to TEST_USER, $50
  // task-a2: active, assigned to TEST_USER_2, $150
  // task-a3: completed, assigned to TEST_USER, $100
  // Project B tasks have no cost data.
  await d1.prepare("UPDATE task SET cost = ? WHERE id = ?").bind(5000, "task-a1").run();
  await d1.prepare("UPDATE task SET cost = ? WHERE id = ?").bind(15000, "task-a2").run();
  await d1.prepare("UPDATE task SET cost = ? WHERE id = ?").bind(10000, "task-a3").run();
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helper: create test app for workspace-scoped routes
// ---------------------------------------------------------------------------

function workspaceApp(
  user: typeof TEST_USER | typeof TEST_USER_2,
  role: "owner" | "admin" | "member",
) {
  const app = new Hono<AppEnv>();
  app.use(
    "/*",
    fakeAuth(d1, user, { workspaceMembership: { id: "wm-fake", role } }),
  );
  app.get("/workspaces/:workspaceId/dashboard", workspaceDashboard);
  app.get(
    "/workspaces/:workspaceId/dashboard/my-tasks",
    validateQuery(myTasksQuerySchema),
    myTasks,
  );
  app.get(
    "/workspaces/:workspaceId/dashboard/upcoming",
    validateQuery(upcomingTasksQuerySchema),
    upcomingTasks,
  );
  app.get(
    "/workspaces/:workspaceId/activity",
    validateQuery(workspaceActivityQuerySchema),
    workspaceActivity,
  );
  return app;
}

function projectApp(
  user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER,
  projectId: string = PROJECT_A_ID,
) {
  const app = new Hono<AppEnv>();
  app.use(
    "/*",
    fakeAuth(d1, user, {
      projectAccess: { role: "admin", source: "workspace" },
      currentProject: { id: projectId, workspaceId: WORKSPACE_ID },
    }),
  );
  app.get("/projects/:projectId/dashboard", projectDashboard);
  app.get("/projects/:projectId/activity", projectActivity);
  return app;
}

// ===========================================================================
// workspaceDashboard
// ===========================================================================

describe("workspaceDashboard", () => {
  it("returns all projects with task counts for an owner (elevated)", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(`/workspaces/${WORKSPACE_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: Array<{ id: string; name: string; taskCounts: { active: number; completed: number; total: number }; memberCount: number }>;
      taskCounts: { activeCount: number; completedCount: number; totalCount: number };
      priorityBreakdown: Array<{ priority: string; count: number }>;
      tasksPerMember: Array<{ id: string; name: string; image: string | null; count: number }>;
      overdueTasks: Array<{ id: string; title: string; projectName: string }>;
    }>();

    expect(body.projects).toHaveLength(2);

    const projA = body.projects.find((p) => p.id === PROJECT_A_ID);
    const projB = body.projects.find((p) => p.id === PROJECT_B_ID);

    expect(projA).toBeDefined();
    expect(projA!.name).toBe("Project Alpha");
    expect(projA!.taskCounts).toEqual({ active: 5, completed: 2, total: 7 });
    expect(projA!.memberCount).toBe(2);

    expect(projB).toBeDefined();
    expect(projB!.name).toBe("Project Beta");
    expect(projB!.taskCounts).toEqual({ active: 2, completed: 0, total: 2 });
    expect(projB!.memberCount).toBe(1);

    // Workspace-wide task counts: 7 active (5 from A + 2 from B), 2 completed (A only)
    expect(body.taskCounts.activeCount).toBe(7);
    expect(body.taskCounts.completedCount).toBe(2);
    expect(body.taskCounts.totalCount).toBe(9);

    // Priority breakdown: urgent(1), high(1), medium(1), none rest — all active tasks
    const priorityMap = new Map(body.priorityBreakdown.map((p) => [p.priority, p.count]));
    expect(priorityMap.get("urgent")).toBe(1);
    expect(priorityMap.get("high")).toBe(1);
    expect(priorityMap.get("medium")).toBe(1);
    const totalPriority = body.priorityBreakdown.reduce((s, p) => s + p.count, 0);
    expect(totalPriority).toBe(7);

    // Tasks per member: TEST_USER has assigned tasks, TEST_USER_2 has assigned tasks
    expect(body.tasksPerMember.length).toBeGreaterThanOrEqual(1);
    const user1Workload = body.tasksPerMember.find((m) => m.id === TEST_USER.id);
    expect(user1Workload).toBeDefined();
    expect(user1Workload!.count).toBeGreaterThanOrEqual(1);

    // Overdue tasks
    const overdueIds = body.overdueTasks.map((t) => t.id);
    expect(overdueIds).toContain("task-a-overdue1");
    expect(overdueIds).toContain("task-a-overdue2");
    expect(overdueIds).not.toContain("task-a-overdue-completed");
    // Verify project context is included
    expect(body.overdueTasks[0].projectName).toBe("Project Alpha");
  });

  it("scopes projects to the given workspace (empty workspace)", async () => {
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Empty WS",
      slug: "empty-ws",
    });
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(`/workspaces/${emptyWsId}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{ projects: Array<{ id: string }> }>();
    expect(body.projects).toHaveLength(0);
  });

  it("non-elevated member only sees projects they belong to", async () => {
    // TEST_USER_2 is a workspace member but only a member of Project A
    const app = workspaceApp(TEST_USER_2, "member");
    const res = await app.request(`/workspaces/${WORKSPACE_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      projects: Array<{ id: string; name: string }>;
      taskCounts: { activeCount: number; completedCount: number; totalCount: number };
      overdueTasks: Array<{ id: string; projectId: string }>;
      tasksPerMember: Array<{ id: string }>;
    }>();

    // Should only see Project Alpha, not Project Beta
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe(PROJECT_A_ID);
    expect(body.projects[0].name).toBe("Project Alpha");

    // Task counts should only include Project A (5 active, 2 completed, 7 total)
    expect(body.taskCounts.activeCount).toBe(5);
    expect(body.taskCounts.completedCount).toBe(2);
    expect(body.taskCounts.totalCount).toBe(7);

    // Overdue tasks should only be from Project A
    for (const t of body.overdueTasks) {
      expect(t.projectId).toBe(PROJECT_A_ID);
    }
  });

  it("admin sees all projects (elevated)", async () => {
    const app = workspaceApp(TEST_USER, "admin");
    const res = await app.request(`/workspaces/${WORKSPACE_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{ projects: Array<{ id: string }> }>();
    expect(body.projects).toHaveLength(2);
  });

  it("returns cost aggregation across all projects", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(`/workspaces/${WORKSPACE_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      costAggregation: {
        totalCost: number;
        completedCost: number;
        activeCost: number;
        tasksWithCost: number;
      };
    }>();

    expect(body.costAggregation).toBeDefined();
    // totalCost = 5000 (task-a1) + 15000 (task-a2) + 10000 (task-a3) = 30000
    expect(body.costAggregation.totalCost).toBe(30000);
    // completedCost = 10000 (task-a3 is completed)
    expect(body.costAggregation.completedCost).toBe(10000);
    // activeCost = 5000 + 15000 = 20000
    expect(body.costAggregation.activeCost).toBe(20000);
    // 3 tasks have cost values
    expect(body.costAggregation.tasksWithCost).toBe(3);
  });

  it("non-elevated member cost aggregation respects project visibility", async () => {
    const app = workspaceApp(TEST_USER_2, "member");
    const res = await app.request(`/workspaces/${WORKSPACE_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      costAggregation: { totalCost: number; tasksWithCost: number };
    }>();

    // TEST_USER_2 only sees Project A — all costed tasks are in A
    expect(body.costAggregation.totalCost).toBe(30000);
    expect(body.costAggregation.tasksWithCost).toBe(3);
  });
});

// ===========================================================================
// myTasks
// ===========================================================================

describe("myTasks", () => {
  it("returns tasks assigned to the current user", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: Array<{ id: string; projectName: string }> }>();

    // TEST_USER has task-a1 and task-b1 assigned (both incomplete)
    // task-a3 is completed so it should NOT appear
    const ids = body.tasks.map((t) => t.id);
    expect(ids).toContain("task-a1");
    expect(ids).toContain("task-b1");
    expect(ids).not.toContain("task-a3");

    // Verify joined fields
    const a1 = body.tasks.find((t) => t.id === "task-a1");
    expect(a1!.projectName).toBe("Project Alpha");
  });

  it("returns tasks assigned to TEST_USER_2", async () => {
    const app = workspaceApp(TEST_USER_2, "member");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: Array<{ id: string }> }>();

    // TEST_USER_2 only has task-a2
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe("task-a2");
  });

  it("respects the 'week' period filter", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?period=week`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: Array<{ id: string }> }>();

    // task-a1 is 2 days out (within a week), task-b1 is 5 days out (within a week)
    // Both should be returned with the week filter
    const ids = body.tasks.map((t) => t.id);
    expect(ids).toContain("task-a1");
    expect(ids).toContain("task-b1");
  });

  it("period=week excludes tasks beyond 7 days", async () => {
    // TEST_USER_2 has task-a2 due in 10 days, which is beyond 1 week
    const app = workspaceApp(TEST_USER_2, "member");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?period=week`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: Array<{ id: string }> }>();

    expect(body.tasks).toHaveLength(0);
  });

  it("period=fortnight includes tasks within 14 days", async () => {
    const app = workspaceApp(TEST_USER_2, "member");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?period=fortnight`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: Array<{ id: string }> }>();

    // task-a2 is 10 days out, within the fortnight range
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe("task-a2");
  });

  it("paginates with limit and cursor", async () => {
    const app = workspaceApp(TEST_USER, "owner");

    // TEST_USER has 3 assigned incomplete tasks: task-a1, task-a-overdue1, task-b1
    // First page with limit=2
    const res1 = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?limit=2`,
    );

    expect(res1.status).toBe(200);
    const body1 = await res1.json<{ tasks: Array<{ id: string }>; nextCursor: string | null }>();

    expect(body1.tasks).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    // Second page using cursor
    const res2 = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
    );

    expect(res2.status).toBe(200);
    const body2 = await res2.json<{ tasks: Array<{ id: string }>; nextCursor: string | null }>();

    expect(body2.tasks).toHaveLength(1);
    // Pages must not overlap
    expect(body2.tasks[0].id).not.toBe(body1.tasks[0].id);
    expect(body2.tasks[0].id).not.toBe(body1.tasks[1].id);
  });

  it("returns 400 for invalid period value", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?period=invalid`,
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("filters by projectIds (restricts to listed projects)", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?projectIds=${PROJECT_A_ID}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      tasks: Array<{ id: string; projectId: string }>;
    }>();

    // TEST_USER has task-a1, task-a-overdue1 in Project A and task-b1 in Project B.
    // With projectIds=Project A only, task-b1 must be excluded.
    const ids = body.tasks.map((t) => t.id);
    expect(ids).toContain("task-a1");
    expect(ids).toContain("task-a-overdue1");
    expect(ids).not.toContain("task-b1");
    for (const t of body.tasks) {
      expect(t.projectId).toBe(PROJECT_A_ID);
    }
  });

  it("filters by taskGroupIds (restricts to listed columns)", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?taskGroupIds=${GROUP_TODO_B}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      tasks: Array<{ id: string; taskGroupId: string }>;
    }>();

    // GROUP_TODO_B only contains task-b1 for TEST_USER
    const ids = body.tasks.map((t) => t.id);
    expect(ids).toEqual(["task-b1"]);
    expect(body.tasks[0].taskGroupId).toBe(GROUP_TODO_B);
  });

  it("combines projectIds and taskGroupIds filters (AND semantics)", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?projectIds=${PROJECT_A_ID}&taskGroupIds=${GROUP_TODO_A}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      tasks: Array<{ id: string; projectId: string; taskGroupId: string }>;
    }>();

    // All returned rows must satisfy both filters
    for (const t of body.tasks) {
      expect(t.projectId).toBe(PROJECT_A_ID);
      expect(t.taskGroupId).toBe(GROUP_TODO_A);
    }
    const ids = body.tasks.map((t) => t.id);
    expect(ids).toContain("task-a1");
    expect(ids).toContain("task-a-overdue1");
  });

  it("combines period with project/taskGroup filters", async () => {
    // TEST_USER has task-a1 (2 days out, GROUP_TODO_A) and task-a-overdue1
    // (3 days ago, also GROUP_TODO_A) both in Project A.
    // period=week includes both since overdue tasks are <= cutoff.
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?period=week&projectIds=${PROJECT_A_ID}&taskGroupIds=${GROUP_TODO_A}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: Array<{ id: string }> }>();
    const ids = body.tasks.map((t) => t.id);

    expect(ids).toContain("task-a1");
    // task-b1 excluded by project filter even though it is within the week
    expect(ids).not.toContain("task-b1");
  });

  it("paginates correctly under project/taskGroup filters", async () => {
    // task-a1 and task-a-overdue1 are both assigned to TEST_USER in Project A /
    // GROUP_TODO_A, which lets us verify cursor pagination respects the
    // combined filter set.
    const app = workspaceApp(TEST_USER, "owner");
    const page1 = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?projectIds=${PROJECT_A_ID}&taskGroupIds=${GROUP_TODO_A}&limit=1`,
    );
    expect(page1.status).toBe(200);
    const body1 = await page1.json<{
      tasks: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(body1.tasks).toHaveLength(1);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?projectIds=${PROJECT_A_ID}&taskGroupIds=${GROUP_TODO_A}&limit=1&cursor=${encodeURIComponent(body1.nextCursor!)}`,
    );
    expect(page2.status).toBe(200);
    const body2 = await page2.json<{ tasks: Array<{ id: string }> }>();
    expect(body2.tasks).toHaveLength(1);
    expect(body2.tasks[0].id).not.toBe(body1.tasks[0].id);
  });

  it("returns empty array when projectIds match no assigned tasks", async () => {
    const app = workspaceApp(TEST_USER_2, "member");
    // TEST_USER_2 has no assigned tasks in Project B
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/my-tasks?projectIds=${PROJECT_B_ID}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: unknown[] }>();
    expect(body.tasks).toHaveLength(0);
  });
});

// ===========================================================================
// upcomingTasks
// ===========================================================================

describe("upcomingTasks", () => {
  it("returns tasks grouped into time buckets for an owner", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/upcoming`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ buckets: Record<string, Array<{ id: string }>>; nextCursor: string | null }>();

    // Verify all expected bucket keys exist
    expect(body.buckets).toHaveProperty("overdue");
    expect(body.buckets).toHaveProperty("today");
    expect(body.buckets).toHaveProperty("this_week");
    expect(body.buckets).toHaveProperty("next_week");
    expect(body.buckets).toHaveProperty("this_month");
    expect(body.buckets).toHaveProperty("later");

    // All tasks with due dates that are not completed should appear somewhere
    const allBucketTasks = Object.values(body.buckets).flat();
    const allIds = allBucketTasks.map((t) => t.id);
    // task-a1 (2 days), task-a2 (10 days), task-b1 (5 days) all have due dates and are incomplete
    expect(allIds).toContain("task-a1");
    expect(allIds).toContain("task-a2");
    expect(allIds).toContain("task-b1");
    // task-a3 is completed, task-b2 has no due date — neither should appear
    expect(allIds).not.toContain("task-a3");
    expect(allIds).not.toContain("task-b2");
  });

  it("non-elevated member only sees tasks from their projects", async () => {
    const app = workspaceApp(TEST_USER_2, "member");
    const res = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/upcoming`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ buckets: Record<string, Array<{ id: string }>>; nextCursor: string | null }>();

    const allIds = Object.values(body.buckets)
      .flat()
      .map((t) => t.id);

    // TEST_USER_2 is only a member of Project A, so only tasks from Project A with due dates
    expect(allIds).toContain("task-a1");
    expect(allIds).toContain("task-a2");
    // task-b1 is from Project B — should NOT appear
    expect(allIds).not.toContain("task-b1");
  });

  it("paginates with limit and cursor", async () => {
    const app = workspaceApp(TEST_USER, "owner");

    // 5 total tasks with due dates: overdue1 (-3d), overdue2 (-1d), a1 (+2d), b1 (+5d), a2 (+10d)
    const res1 = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/upcoming?limit=3`,
    );

    expect(res1.status).toBe(200);
    const body1 = await res1.json<{ buckets: Record<string, Array<{ id: string }>>; nextCursor: string | null }>();

    const firstPageIds = Object.values(body1.buckets)
      .flat()
      .map((t) => t.id);
    expect(firstPageIds).toHaveLength(3);
    expect(body1.nextCursor).not.toBeNull();

    const res2 = await app.request(
      `/workspaces/${WORKSPACE_ID}/dashboard/upcoming?limit=3&cursor=${encodeURIComponent(body1.nextCursor!)}`,
    );

    expect(res2.status).toBe(200);
    const body2 = await res2.json<{ buckets: Record<string, Array<{ id: string }>>; nextCursor: string | null }>();

    const secondPageIds = Object.values(body2.buckets)
      .flat()
      .map((t) => t.id);
    expect(secondPageIds).toHaveLength(2);

    // No overlap between pages
    for (const id of secondPageIds) {
      expect(firstPageIds).not.toContain(id);
    }
  });

  it("returns empty buckets when workspace has no upcoming tasks", async () => {
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "No Tasks WS",
      slug: "no-tasks-ws",
    });
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(
      `/workspaces/${emptyWsId}/dashboard/upcoming`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ buckets: Record<string, Array<{ id: string }>>; nextCursor: string | null }>();

    const totalTasks = Object.values(body.buckets).flat().length;
    expect(totalTasks).toBe(0);
    expect(body.nextCursor).toBeNull();
  });
});

// ===========================================================================
// projectDashboard
// ===========================================================================

describe("projectDashboard", () => {
  it("returns task counts, tasks by group, tasks per member, and upcoming tasks", async () => {
    const app = projectApp();
    const res = await app.request(`/projects/${PROJECT_A_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      taskCounts: { activeCount: number; completedCount: number; totalCount: number };
      tasksByGroup: Array<{ taskGroupId: string; taskGroupName: string; count: number }>;
      tasksPerMember: Array<{ id: string; count: number }>;
      upcomingTasks: Array<{ id: string }>;
      overdueTasks: Array<{ id: string }>;
      priorityBreakdown: Array<{ priority: string; count: number }>;
    }>();

    // Task counts: 5 active, 2 completed (task-a3, task-a-overdue-completed), total 7
    expect(body.taskCounts.activeCount).toBe(5);
    expect(body.taskCounts.completedCount).toBe(2);
    expect(body.taskCounts.totalCount).toBe(7);

    // Tasks by group: "To Do" group has 5 tasks (a1, a2, overdue1, overdue2, medium), "Done" group has 2
    const todoGroup = body.tasksByGroup.find((g) => g.taskGroupId === GROUP_TODO_A);
    const doneGroup = body.tasksByGroup.find((g) => g.taskGroupId === GROUP_DONE_A);
    expect(todoGroup).toBeDefined();
    expect(todoGroup!.count).toBe(5);
    expect(todoGroup!.taskGroupName).toBe("To Do");
    expect(doneGroup).toBeDefined();
    expect(doneGroup!.count).toBe(2);
    expect(doneGroup!.taskGroupName).toBe("Done");

    // Tasks per member
    const userTasks = body.tasksPerMember.find((m) => m.id === TEST_USER.id);
    const user2Tasks = body.tasksPerMember.find((m) => m.id === TEST_USER_2.id);
    expect(userTasks).toBeDefined();
    // TEST_USER has task-a1, task-a3, task-a-overdue1 assigned
    expect(userTasks!.count).toBe(3);
    expect(user2Tasks).toBeDefined();
    // TEST_USER_2 has task-a2 assigned
    expect(user2Tasks!.count).toBe(1);

    // Upcoming tasks: task-a1 (2 days) and task-a2 (10 days) are within 30 days and incomplete
    const upcomingIds = body.upcomingTasks.map((t) => t.id);
    expect(upcomingIds).toContain("task-a1");
    expect(upcomingIds).toContain("task-a2");
    // Overdue tasks should NOT appear in upcoming
    expect(upcomingIds).not.toContain("task-a-overdue1");
    expect(upcomingIds).not.toContain("task-a-overdue2");
  });

  it("returns overdue tasks that are past due and not completed", async () => {
    const app = projectApp();
    const res = await app.request(`/projects/${PROJECT_A_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      overdueTasks: Array<{ id: string; title: string; priority: string; assigneeName: string | null }>;
    }>();

    const overdueIds = body.overdueTasks.map((t) => t.id);
    // Both overdue active tasks should appear
    expect(overdueIds).toContain("task-a-overdue1");
    expect(overdueIds).toContain("task-a-overdue2");
    // Completed overdue task should NOT appear
    expect(overdueIds).not.toContain("task-a-overdue-completed");

    // Verify the first (most overdue) has correct fields
    const overdue1 = body.overdueTasks.find((t) => t.id === "task-a-overdue1");
    expect(overdue1).toBeDefined();
    expect(overdue1!.priority).toBe("urgent");
    expect(overdue1!.assigneeName).toBe(TEST_USER.name);

    // Overdue task without assignee should have null name
    const overdue2 = body.overdueTasks.find((t) => t.id === "task-a-overdue2");
    expect(overdue2).toBeDefined();
    expect(overdue2!.assigneeName).toBeNull();
  });

  it("returns priority breakdown for active tasks only", async () => {
    const app = projectApp();
    const res = await app.request(`/projects/${PROJECT_A_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      priorityBreakdown: Array<{ priority: string; count: number }>;
    }>();

    const countMap = new Map(body.priorityBreakdown.map((p) => [p.priority, p.count]));
    // Active tasks: task-a1 (none), task-a2 (none), task-a-overdue1 (urgent),
    // task-a-overdue2 (high), task-a-medium (medium)
    expect(countMap.get("urgent")).toBe(1);
    expect(countMap.get("high")).toBe(1);
    expect(countMap.get("medium")).toBe(1);
    expect(countMap.get("none")).toBe(2);
    // Completed tasks are excluded from breakdown
    const total = body.priorityBreakdown.reduce((sum, p) => sum + p.count, 0);
    expect(total).toBe(5);
  });

  it("returns zeros for a project with no tasks", async () => {
    // Create a bare project with no tasks
    const bareProjectId = await seedProject(d1, WORKSPACE_ID, {
      name: "Empty Project",
    });

    const app = projectApp(TEST_USER, bareProjectId);

    const res = await app.request(`/projects/${bareProjectId}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      taskCounts: { activeCount: number; completedCount: number; totalCount: number };
      tasksByGroup: Array<unknown>;
      tasksPerMember: Array<unknown>;
      upcomingTasks: Array<unknown>;
      overdueTasks: Array<unknown>;
      priorityBreakdown: Array<unknown>;
    }>();

    expect(body.taskCounts).toEqual({
      activeCount: 0,
      completedCount: 0,
      totalCount: 0,
    });
    expect(body.tasksByGroup).toHaveLength(0);
    expect(body.tasksPerMember).toHaveLength(0);
    expect(body.upcomingTasks).toHaveLength(0);
    expect(body.overdueTasks).toHaveLength(0);
    expect(body.priorityBreakdown).toHaveLength(0);
  });

  it("returns dashboard for Project B with correct counts", async () => {
    const app = projectApp(TEST_USER, PROJECT_B_ID);

    const res = await app.request(`/projects/${PROJECT_B_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      taskCounts: { activeCount: number; completedCount: number; totalCount: number };
      tasksByGroup: Array<{ taskGroupId: string; count: number }>;
      tasksPerMember: Array<{ id: string; count: number }>;
      upcomingTasks: Array<{ id: string }>;
    }>();

    // Project B has 2 active tasks, 0 completed
    expect(body.taskCounts.activeCount).toBe(2);
    expect(body.taskCounts.completedCount).toBe(0);
    expect(body.taskCounts.totalCount).toBe(2);

    // All in one group
    expect(body.tasksByGroup).toHaveLength(1);
    expect(body.tasksByGroup[0].taskGroupId).toBe(GROUP_TODO_B);
    expect(body.tasksByGroup[0].count).toBe(2);

    // Only task-b1 has an assignee (TEST_USER); task-b2 has no assignee
    expect(body.tasksPerMember).toHaveLength(1);
    expect(body.tasksPerMember[0].id).toBe(TEST_USER.id);
    expect(body.tasksPerMember[0].count).toBe(1);

    // Upcoming tasks: task-b1 has a due date within 30 days
    const upcomingIds = body.upcomingTasks.map((t) => t.id);
    expect(upcomingIds).toContain("task-b1");
    // task-b2 has no due date
    expect(upcomingIds).not.toContain("task-b2");
  });

  it("returns cost aggregation, budget, and cost per member", async () => {
    const app = projectApp();
    const res = await app.request(`/projects/${PROJECT_A_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      costAggregation: {
        totalCost: number;
        completedCost: number;
        activeCost: number;
        tasksWithCost: number;
      };
      budget: number | null;
      costPerMember: Array<{ id: string; name: string; totalCost: number }>;
    }>();

    // Cost aggregation
    expect(body.costAggregation.totalCost).toBe(30000);
    expect(body.costAggregation.completedCost).toBe(10000);
    expect(body.costAggregation.activeCost).toBe(20000);
    expect(body.costAggregation.tasksWithCost).toBe(3);

    // Budget
    expect(body.budget).toBe(50000);

    // Cost per member
    const user1Cost = body.costPerMember.find((m) => m.id === TEST_USER.id);
    expect(user1Cost).toBeDefined();
    // TEST_USER has task-a1 ($50) + task-a3 ($100) = $150 = 15000 cents
    expect(user1Cost!.totalCost).toBe(15000);

    const user2Cost = body.costPerMember.find((m) => m.id === TEST_USER_2.id);
    expect(user2Cost).toBeDefined();
    // TEST_USER_2 has task-a2 ($150) = 15000 cents
    expect(user2Cost!.totalCost).toBe(15000);
  });

  it("returns zero cost and null budget for a project with no cost data", async () => {
    const app = projectApp(TEST_USER, PROJECT_B_ID);
    const res = await app.request(`/projects/${PROJECT_B_ID}/dashboard`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      costAggregation: { totalCost: number; tasksWithCost: number };
      budget: number | null;
      costPerMember: Array<unknown>;
    }>();

    expect(body.costAggregation.totalCost).toBe(0);
    expect(body.costAggregation.tasksWithCost).toBe(0);
    expect(body.budget).toBeNull();
    expect(body.costPerMember).toHaveLength(0);
  });
});

// ===========================================================================
// projectActivity
// ===========================================================================

describe("projectActivity", () => {
  it("returns activities scoped to the project with task titles", async () => {
    const app = projectApp();
    const res = await app.request(`/projects/${PROJECT_A_ID}/activity`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      activities: Array<{
        id: string;
        taskId: string;
        taskTitle: string;
        actorName: string | null;
        action: string;
      }>;
      nextCursor: string | null;
    }>();

    // Should only contain Project A activities, not Project B
    const activityIds = body.activities.map((a) => a.id);
    expect(activityIds).toContain("act-1");
    expect(activityIds).toContain("act-2");
    expect(activityIds).toContain("act-3");
    expect(activityIds).not.toContain("act-b1");

    // Verify task title is included
    const act1 = body.activities.find((a) => a.id === "act-1");
    expect(act1).toBeDefined();
    expect(act1!.taskTitle).toBe("Task A1");
    expect(act1!.actorName).toBe(TEST_USER.name);
    expect(act1!.action).toBe("created");

    // Verify ordering: most recent first
    expect(body.activities[0].id).toBe("act-3");
  });

  it("paginates with limit and cursor", async () => {
    const app = projectApp();

    // First page with limit=2
    const res1 = await app.request(`/projects/${PROJECT_A_ID}/activity?limit=2`);
    expect(res1.status).toBe(200);
    const body1 = await res1.json<{
      activities: Array<{ id: string }>;
      nextCursor: string | null;
    }>();

    expect(body1.activities).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    // Second page
    const res2 = await app.request(
      `/projects/${PROJECT_A_ID}/activity?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json<{
      activities: Array<{ id: string }>;
      nextCursor: string | null;
    }>();

    expect(body2.activities).toHaveLength(1);
    // No overlap
    expect(body2.activities[0].id).not.toBe(body1.activities[0].id);
    expect(body2.activities[0].id).not.toBe(body1.activities[1].id);
  });

  it("returns empty for a project with no activity", async () => {
    // Test with an empty project that has no activity records
    const bareProjectId = await seedProject(d1, WORKSPACE_ID, {
      name: "No Activity Project",
    });

    const bareApp = projectApp(TEST_USER, bareProjectId);
    const res = await bareApp.request(`/projects/${bareProjectId}/activity`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      activities: Array<unknown>;
      nextCursor: string | null;
    }>();

    expect(body.activities).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });
});

// ===========================================================================
// workspaceActivity
// ===========================================================================

describe("workspaceActivity", () => {
  it("returns activities across all projects for an owner (elevated)", async () => {
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(`/workspaces/${WORKSPACE_ID}/activity`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      activities: Array<{
        id: string;
        taskId: string;
        taskTitle: string;
        projectId: string;
        projectName: string;
        actorName: string | null;
        action: string;
      }>;
      nextCursor: string | null;
    }>();

    // Owner should see activities from both projects
    const activityIds = body.activities.map((a) => a.id);
    expect(activityIds).toContain("act-1");
    expect(activityIds).toContain("act-2");
    expect(activityIds).toContain("act-3");
    expect(activityIds).toContain("act-b1");

    // Verify project context is included
    const actB1 = body.activities.find((a) => a.id === "act-b1");
    expect(actB1).toBeDefined();
    expect(actB1!.projectName).toBe("Project Beta");
    expect(actB1!.projectId).toBe(PROJECT_B_ID);

    const act1 = body.activities.find((a) => a.id === "act-1");
    expect(act1!.projectName).toBe("Project Alpha");
    expect(act1!.taskTitle).toBe("Task A1");

    // Ordering: most recent first
    expect(body.activities[0].id).toBe("act-b1");
  });

  it("non-elevated member only sees activities from their projects", async () => {
    const app = workspaceApp(TEST_USER_2, "member");
    const res = await app.request(`/workspaces/${WORKSPACE_ID}/activity`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      activities: Array<{ id: string; projectId: string }>;
      nextCursor: string | null;
    }>();

    // TEST_USER_2 is only a member of Project A — should not see Project B activity
    const activityIds = body.activities.map((a) => a.id);
    expect(activityIds).toContain("act-1");
    expect(activityIds).toContain("act-2");
    expect(activityIds).toContain("act-3");
    expect(activityIds).not.toContain("act-b1");

    // All activities should be from Project A
    for (const a of body.activities) {
      expect(a.projectId).toBe(PROJECT_A_ID);
    }
  });

  it("paginates with limit and cursor", async () => {
    const app = workspaceApp(TEST_USER, "owner");

    // 4 total activities: act-b1, act-3, act-2, act-1 (most recent first)
    const res1 = await app.request(`/workspaces/${WORKSPACE_ID}/activity?limit=2`);
    expect(res1.status).toBe(200);
    const body1 = await res1.json<{
      activities: Array<{ id: string }>;
      nextCursor: string | null;
    }>();

    expect(body1.activities).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const res2 = await app.request(
      `/workspaces/${WORKSPACE_ID}/activity?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json<{
      activities: Array<{ id: string }>;
      nextCursor: string | null;
    }>();

    expect(body2.activities).toHaveLength(2);
    // No overlap
    const firstIds = new Set(body1.activities.map((a) => a.id));
    for (const a of body2.activities) {
      expect(firstIds.has(a.id)).toBe(false);
    }
  });

  it("returns empty for a workspace with no activity", async () => {
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "No Activity WS",
      slug: "no-activity-ws",
    });
    const app = workspaceApp(TEST_USER, "owner");
    const res = await app.request(`/workspaces/${emptyWsId}/activity`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      activities: Array<unknown>;
      nextCursor: string | null;
    }>();

    expect(body.activities).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });
});
