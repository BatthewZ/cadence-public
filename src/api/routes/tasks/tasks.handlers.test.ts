/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for task handler functions.
 *
 * Uses a real in-memory D1 database (via Miniflare) so that handler logic —
 * including Drizzle ORM queries, fractional-index generation, activity logging,
 * and notification creation — is exercised against actual SQL. This catches
 * query-shape regressions that mocks would miss.
 */

import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../../db";
import { createCommentSchema, listCommentsQuerySchema, updateCommentSchema } from "../../../shared/schemas/comment";
import { createSubtaskSchema, updateSubtaskSchema } from "../../../shared/schemas/subtask";
import {
  createTaskSchema,
  listActivityQuerySchema,
  moveTaskSchema,
  updateTaskSchema,
} from "../../../shared/schemas/task";
import type {
  StoredUnsplashCoverPayload,
  UnsplashCoverPayload,
} from "../../../shared/schemas/unsplash";
import { unsplashCoverPayloadSchema } from "../../../shared/schemas/unsplash";
import type { AppEnv } from "../../env";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  createTestD1,
  createTestD1WithR2,
  fakeAuth,
  fakeCoverPngFile,
  installFetchSpy,
  jsonRequest,
  sampleUnsplashPayload,
  seedComment,
  seedProject,
  seedProjectMember,
  seedSubtask,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWebhook,
  seedWorkspace,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  applyTaskUnsplashCover,
  completeTask,
  createComment,
  createSubtask,
  createTask,
  deleteComment,
  deleteSubtask,
  deleteTask,
  deleteTaskCover,
  duplicateTask,
  getTask,
  getTaskActivity,
  listComments,
  listTasks,
  moveTask,
  uncompleteTask,
  updateComment,
  updateSubtask,
  updateTask,
  uploadTaskCover,
} from "./tasks.handlers";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let taskGroupId: string;
let completionGroupId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);

  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  await seedProjectMember(d1, projectId, TEST_USER_2.id, "member");

  taskGroupId = await seedTaskGroup(d1, projectId, { name: "To Do" });
  completionGroupId = await seedTaskGroup(d1, projectId, {
    name: "Done",
    isCompletionGroup: true,
    position: "b0",
  });
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helper: build a mini Hono app per handler test
// ---------------------------------------------------------------------------

const auth = () =>
  fakeAuth(d1, TEST_USER, {
    workspaceMembership: { id: "wm-1", role: "owner" },
  });


// =========================================================================
// createTask
// =========================================================================

describe("createTask", () => {
  it("creates a task in a valid task group and returns 201", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/tasks",
      auth(),
      validateBody(createTaskSchema),
      createTask,
    );

    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "My new task",
        taskGroupId,
        priority: "high",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { title: string; priority: string; completed: boolean } }>();
    expect(body.task.title).toBe("My new task");
    expect(body.task.priority).toBe("high");
    expect(body.task.completed).toBe(false);
  });

  /**
   * Regression guard for duplicate `task.position` values under concurrent
   * creates in the same task group. Before the retry helper + UNIQUE
   * index on (taskGroupId, position), burst creates (e.g. multi-tab) all
   * read the same MAX(position) and produced identical `generateKeyBetween`
   * results, leaving ties that destabilized list ordering and made
   * drag-reorder misbehave.
   */
  it("produces distinct positions under concurrent task creates in the same group", async () => {
    // Fresh task group so earlier tests' seeded positions don't pollute
    // this assertion surface.
    const raceGroupId = await seedTaskGroup(d1, projectId, {
      name: "Task Create Race Group",
    });

    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/tasks",
      auth(),
      validateBody(createTaskSchema),
      createTask,
    );

    const N = 8;
    const responses = await Promise.all(
      Array.from({ length: N }, async (_, i) =>
        app.request(
          `/projects/${projectId}/tasks`,
          jsonRequest("POST", `/projects/${projectId}/tasks`, {
            title: `Race Task ${i}`,
            taskGroupId: raceGroupId,
          }),
        ),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const bodies = await Promise.all(
      responses.map((r) => r.json<{ task: { id: string; position: string } }>()),
    );
    const positions = bodies.map((b) => b.task.position);
    expect(new Set(positions).size).toBe(N);
  });

  it("auto-completes task when created in a completion group", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/tasks",
      auth(),
      validateBody(createTaskSchema),
      createTask,
    );

    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "Done task",
        taskGroupId: completionGroupId,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { completed: boolean } }>();
    expect(body.task.completed).toBe(true);
  });

  it("returns 404 for nonexistent task group", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/tasks",
      auth(),
      validateBody(createTaskSchema),
      createTask,
    );

    const fakeGroupId = crypto.randomUUID();
    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "No group",
        taskGroupId: fakeGroupId,
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/task group not found/i);
  });

  it("returns 400 when title is missing", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/tasks",
      auth(),
      validateBody(createTaskSchema),
      createTask,
    );

    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        taskGroupId,
      }),
    );

    expect(res.status).toBe(400);
  });

  describe("autoAssignCreator", () => {
    let autoAssignProjectId: string;
    let autoAssignGroupId: string;

    beforeAll(async () => {
      autoAssignProjectId = await seedProject(d1, workspaceId, { autoAssignCreator: true });
      await seedProjectMember(d1, autoAssignProjectId, TEST_USER.id, "admin");
      autoAssignGroupId = await seedTaskGroup(d1, autoAssignProjectId, { name: "To Do" });
    });

    it("auto-assigns task to creator when enabled and no assignee provided", async () => {
      const app = new Hono<AppEnv>();
      app.post("/projects/:projectId/tasks", auth(), validateBody(createTaskSchema), createTask);

      const res = await app.request(
        `/projects/${autoAssignProjectId}/tasks`,
        jsonRequest("POST", `/projects/${autoAssignProjectId}/tasks`, {
          title: "Auto-assigned task",
          taskGroupId: autoAssignGroupId,
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json<{ task: { assigneeId: string | null } }>();
      expect(body.task.assigneeId).toBe(TEST_USER.id);
    });

    it("respects explicit assigneeId even when auto-assign is enabled", async () => {
      const app = new Hono<AppEnv>();
      app.post("/projects/:projectId/tasks", auth(), validateBody(createTaskSchema), createTask);

      const res = await app.request(
        `/projects/${autoAssignProjectId}/tasks`,
        jsonRequest("POST", `/projects/${autoAssignProjectId}/tasks`, {
          title: "Explicitly assigned",
          taskGroupId: autoAssignGroupId,
          assigneeId: TEST_USER_2.id,
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json<{ task: { assigneeId: string | null } }>();
      expect(body.task.assigneeId).toBe(TEST_USER_2.id);
    });

    it("does not auto-assign when setting is disabled (default)", async () => {
      const app = new Hono<AppEnv>();
      app.post("/projects/:projectId/tasks", auth(), validateBody(createTaskSchema), createTask);

      const res = await app.request(
        `/projects/${projectId}/tasks`,
        jsonRequest("POST", `/projects/${projectId}/tasks`, {
          title: "No auto-assign",
          taskGroupId,
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json<{ task: { assigneeId: string | null } }>();
      expect(body.task.assigneeId).toBeNull();
    });
  });
});

// =========================================================================
// listTasks
// =========================================================================

describe("listTasks", () => {
  beforeAll(async () => {
    await seedTask(d1, projectId, taskGroupId, {
      title: "List Task A",
      priority: "high",
      assigneeId: TEST_USER.id,
    });
    await seedTask(d1, projectId, taskGroupId, {
      title: "List Task B",
      priority: "low",
      completed: true,
      position: "a1",
    });
  });

  it("returns tasks for a project", async () => {
    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/tasks", auth(), listTasks);

    const res = await app.request(`/projects/${projectId}/tasks`);

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: Record<string, unknown>[] }>();
    expect(body.tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by taskGroupId", async () => {
    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/tasks", auth(), listTasks);

    const res = await app.request(
      `/projects/${projectId}/tasks?taskGroupId=${taskGroupId}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: { taskGroupId: string }[] }>();
    for (const t of body.tasks) {
      expect(t.taskGroupId).toBe(taskGroupId);
    }
  });

  it("filters by priority", async () => {
    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/tasks", auth(), listTasks);

    const res = await app.request(
      `/projects/${projectId}/tasks?priority=high`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: { priority: string }[] }>();
    expect(body.tasks.length).toBeGreaterThanOrEqual(1);
    for (const t of body.tasks) {
      expect(t.priority).toBe("high");
    }
  });

  it("filters by assigneeId", async () => {
    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/tasks", auth(), listTasks);

    const res = await app.request(
      `/projects/${projectId}/tasks?assigneeId=${TEST_USER.id}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: { assigneeId: string }[] }>();
    expect(body.tasks.length).toBeGreaterThanOrEqual(1);
    for (const t of body.tasks) {
      expect(t.assigneeId).toBe(TEST_USER.id);
    }
  });

  it("filters by completed", async () => {
    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/tasks", auth(), listTasks);

    const res = await app.request(
      `/projects/${projectId}/tasks?completed=true`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: { completed: boolean }[] }>();
    expect(body.tasks.length).toBeGreaterThanOrEqual(1);
    for (const t of body.tasks) {
      expect(t.completed).toBe(true);
    }
  });

  it("returns enriched fields (subtaskCount, commentCount)", async () => {
    const app = new Hono<AppEnv>();
    app.get("/projects/:projectId/tasks", auth(), listTasks);

    const res = await app.request(`/projects/${projectId}/tasks`);

    expect(res.status).toBe(200);
    const body = await res.json<{ tasks: { subtaskCount: number; commentCount: number; subtaskCompletedCount: number }[] }>();
    for (const t of body.tasks) {
      expect(typeof t.subtaskCount).toBe("number");
      expect(typeof t.commentCount).toBe("number");
      expect(typeof t.subtaskCompletedCount).toBe("number");
    }
  });
});

// =========================================================================
// getTask
// =========================================================================

describe("getTask", () => {
  let existingTaskId: string;

  beforeAll(async () => {
    existingTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Get Task Test",
    });
    await seedSubtask(d1, existingTaskId, { title: "Sub A" });
    await seedComment(d1, existingTaskId, TEST_USER.id, { body: "A comment" });
  });

  it("returns task with subtasks and commentCount", async () => {
    const app = new Hono<AppEnv>();
    app.get("/tasks/:taskId", auth(), getTask);

    const res = await app.request(`/tasks/${existingTaskId}`);

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { id: string; title: string; subtasks: { title: string }[]; commentCount: number } }>();
    expect(body.task.id).toBe(existingTaskId);
    expect(body.task.title).toBe("Get Task Test");
    expect(body.task.subtasks.length).toBe(1);
    expect(body.task.subtasks[0].title).toBe("Sub A");
    expect(body.task.commentCount).toBe(1);
  });

  it("returns 404 for nonexistent task", async () => {
    const app = new Hono<AppEnv>();
    app.get("/tasks/:taskId", auth(), getTask);

    const res = await app.request(`/tasks/${crypto.randomUUID()}`);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/not found/i);
  });
});

// =========================================================================
// updateTask
// =========================================================================

describe("updateTask", () => {
  let updateTaskId: string;

  beforeAll(async () => {
    updateTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Update Me",
      priority: "none",
    });
  });

  it("updates task fields and returns updated task", async () => {
    const app = new Hono<AppEnv>();
    app.patch("/tasks/:taskId", auth(), validateBody(updateTaskSchema), updateTask);

    const res = await app.request(
      `/tasks/${updateTaskId}`,
      jsonRequest("PATCH", `/tasks/${updateTaskId}`, {
        title: "Updated Title",
        priority: "urgent",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { title: string; priority: string } }>();
    expect(body.task.title).toBe("Updated Title");
    expect(body.task.priority).toBe("urgent");
  });

  it("creates activity log entries on field changes", async () => {
    const app = new Hono<AppEnv>();
    app.patch("/tasks/:taskId", auth(), validateBody(updateTaskSchema), updateTask);

    // Change priority to generate activity
    await app.request(
      `/tasks/${updateTaskId}`,
      jsonRequest("PATCH", `/tasks/${updateTaskId}`, {
        priority: "low",
      }),
    );

    // Verify activity was logged
    const activityApp = new Hono<AppEnv>();
    activityApp.get("/tasks/:taskId/activity", auth(), getTaskActivity);

    const actRes = await activityApp.request(
      `/tasks/${updateTaskId}/activity?limit=50`,
    );

    expect(actRes.status).toBe(200);
    const actBody = await actRes.json<{
      activities: { action: string; field: string | null }[];
    }>();
    const priorityChange = actBody.activities.find(
      (a) => a.action === "priority_changed" && a.field === "priority",
    );
    expect(priorityChange).toBeDefined();
  });

  it("returns 404 for nonexistent task", async () => {
    const app = new Hono<AppEnv>();
    app.patch("/tasks/:taskId", auth(), validateBody(updateTaskSchema), updateTask);

    const res = await app.request(
      `/tasks/${crypto.randomUUID()}`,
      jsonRequest("PATCH", `/tasks/${crypto.randomUUID()}`, {
        title: "Nope",
      }),
    );

    expect(res.status).toBe(404);
  });
});

// =========================================================================
// startDate (date-range) behaviour
// =========================================================================

/**
 * startDate and dueDate are each INDEPENDENTLY optional — a task may carry a
 * start date alone (work that begins on a day with no deadline), a due date
 * alone, both (a start → due range), or neither. The ONLY cross-field rule is
 * ordering: when both are present, start must be on or before due. These tests
 * pin the two layers that enforce just that ordering, plus the independence:
 *
 * 1. Schema refinements (create always; update only when both fields appear in
 *    the payload — a partial PATCH can't see stored values). Start-only is
 *    accepted; only an inverted range (both present, start > due) is rejected.
 * 2. The updateTask merged-state backstop — MANDATORY, because without it
 *    `PATCH {startDate}` against an earlier stored dueDate would persist an
 *    inverted range that the schema can never catch. A start-only PATCH against
 *    a task with no stored dueDate is fine (start can stand alone).
 *
 * Independence also means clearing the due date leaves a surviving start date
 * in place — there is no auto-clear, because a due-less start is now valid.
 *
 * Calendar validation (rejecting 2030-02-30) matters because the handler feeds
 * the string straight into `new Date()` — a shape-only check would store a
 * silently rolled-forward date.
 */
describe("startDate", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.post(
      "/projects/:projectId/tasks",
      auth(),
      validateBody(createTaskSchema),
      createTask,
    );
    return app;
  }

  function updateApp() {
    const app = new Hono<AppEnv>();
    app.patch("/tasks/:taskId", auth(), validateBody(updateTaskSchema), updateTask);
    return app;
  }

  /**
   * ExecutionContext whose waitUntil promises can be flushed. Passing this to
   * `app.request` routes deferWork (activity logging) and webhook dispatch
   * through waitUntil so tests can deterministically await those side-effects
   * instead of racing the inline fire-and-forget fallback.
   */
  function createAwaitableExecutionCtx() {
    const promises: Promise<unknown>[] = [];
    return {
      ctx: {
        waitUntil: (p: Promise<unknown>) => {
          promises.push(p);
        },
        passThroughOnException: () => {},
      } as ExecutionContext,
      flush: async () => {
        // Loop: a flushed promise may schedule further waitUntil work
        // (e.g. webhook delivery recording) that must also settle.
        let awaited = 0;
        while (awaited < promises.length) {
          const batch = promises.slice(awaited);
          awaited = promises.length;
          await Promise.all(batch);
        }
      },
    };
  }

  async function fetchActivities(taskId: string) {
    const activityApp = new Hono<AppEnv>();
    activityApp.get("/tasks/:taskId/activity", auth(), getTaskActivity);
    const res = await activityApp.request(`/tasks/${taskId}/activity?limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      activities: { action: string; field: string | null; oldValue: string | null; newValue: string | null }[];
    }>();
    return body.activities;
  }

  // -------------------------------------------------------------------------
  // createTask
  // -------------------------------------------------------------------------

  it("creates a task with startDate and dueDate, persisting both as UTC-midnight timestamps", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "Ranged task",
        taskGroupId,
        startDate: "2030-03-01",
        dueDate: "2030-03-05",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; startDate: string | null; dueDate: string | null } }>();
    expect(body.task.startDate).toBe("2030-03-01T00:00:00.000Z");
    expect(body.task.dueDate).toBe("2030-03-05T00:00:00.000Z");

    // Round-trip through getTask to confirm the stored row (not just the
    // in-memory insert object) carries both dates.
    const getApp = new Hono<AppEnv>();
    getApp.get("/tasks/:taskId", auth(), getTask);
    const getRes = await getApp.request(`/tasks/${body.task.id}`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json<{ task: { startDate: string | null; dueDate: string | null } }>();
    expect(getBody.task.startDate).toBe("2030-03-01T00:00:00.000Z");
    expect(getBody.task.dueDate).toBe("2030-03-05T00:00:00.000Z");
  });

  it("creates a start-only task (startDate without dueDate) and persists it as UTC-midnight", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "Start only",
        taskGroupId,
        startDate: "2030-03-01",
      }),
    );

    // A start date no longer requires a due date — this is a valid task.
    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; startDate: string | null; dueDate: string | null } }>();
    expect(body.task.startDate).toBe("2030-03-01T00:00:00.000Z");
    expect(body.task.dueDate).toBeNull();

    // Confirm the stored row (not just the insert object) carries start-only.
    const getApp = new Hono<AppEnv>();
    getApp.get("/tasks/:taskId", auth(), getTask);
    const getRes = await getApp.request(`/tasks/${body.task.id}`);
    const getBody = await getRes.json<{ task: { startDate: string | null; dueDate: string | null } }>();
    expect(getBody.task.startDate).toBe("2030-03-01T00:00:00.000Z");
    expect(getBody.task.dueDate).toBeNull();
  });

  it("returns 400 when startDate is after dueDate on create", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "Inverted range",
        taskGroupId,
        startDate: "2030-03-06",
        dueDate: "2030-03-05",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { path: string; message: string }[] }>();
    expect(body.details.some((d) => /on or before the due date/i.test(d.message))).toBe(true);
  });

  it("does not fabricate a dueDate for a recurring start-only task (no inverted range)", async () => {
    // Recurrence normally defaults a missing dueDate to today so the series has
    // an anchor. But a future start date is the anchor for a start-only series,
    // so defaulting dueDate to today would store start(future) > due(today) —
    // an inverted range the schema's start ≤ due check (run before the default)
    // can't catch. The handler must leave the task start-only instead.
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "Recurring start-only",
        taskGroupId,
        startDate: "2030-03-07",
        recurrenceRule: { frequency: "weekly", interval: 1 },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { startDate: string | null; dueDate: string | null } }>();
    expect(body.task.startDate).toBe("2030-03-07T00:00:00.000Z");
    expect(body.task.dueDate).toBeNull();
  });

  it("returns 400 for a calendar-invalid startDate (2030-02-30)", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/tasks`,
      jsonRequest("POST", `/projects/${projectId}/tasks`, {
        title: "Impossible date",
        taskGroupId,
        startDate: "2030-02-30",
        dueDate: "2030-03-05",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  // -------------------------------------------------------------------------
  // updateTask — merged-state backstop
  // -------------------------------------------------------------------------

  it("rejects a startDate-only PATCH that lands after the STORED dueDate (merged-state backstop)", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Backstop invalid",
      dueDate: new Date("2030-03-04"),
    });

    const app = updateApp();
    const res = await app.request(
      `/tasks/${taskId}`,
      jsonRequest("PATCH", `/tasks/${taskId}`, { startDate: "2030-03-05" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/start date must be on or before the due date/i);
  });

  it("accepts a startDate-only PATCH when the task has no stored dueDate (start can stand alone)", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Start stands alone",
    });

    const app = updateApp();
    const res = await app.request(
      `/tasks/${taskId}`,
      jsonRequest("PATCH", `/tasks/${taskId}`, { startDate: "2030-03-01" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { startDate: string | null; dueDate: string | null } }>();
    expect(body.task.startDate).toBe("2030-03-01T00:00:00.000Z");
    expect(body.task.dueDate).toBeNull();
  });

  it("accepts a startDate-only PATCH that is valid against the stored dueDate and logs start_date_changed", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Backstop valid",
      dueDate: new Date("2030-03-04"),
    });

    const { ctx, flush } = createAwaitableExecutionCtx();
    const app = updateApp();
    const res = await app.request(
      `/tasks/${taskId}`,
      jsonRequest("PATCH", `/tasks/${taskId}`, { startDate: "2030-03-03" }),
      {},
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { startDate: string | null; dueDate: string | null } }>();
    expect(body.task.startDate).toBe("2030-03-03T00:00:00.000Z");
    expect(body.task.dueDate).toBe("2030-03-04T00:00:00.000Z");

    await flush();
    const activities = await fetchActivities(taskId);
    const startChanged = activities.find(
      (a) => a.action === "start_date_changed" && a.field === "startDate",
    );
    expect(startChanged).toBeDefined();
    expect(startChanged!.oldValue).toBeNull();
    expect(startChanged!.newValue).toBe("2030-03-03");
  });

  it("clearing dueDate leaves a surviving startDate intact and logs only the due removal", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Due cleared, start kept",
      startDate: new Date("2030-03-01"),
      dueDate: new Date("2030-03-05"),
    });

    const { ctx, flush } = createAwaitableExecutionCtx();
    const app = updateApp();
    const res = await app.request(
      `/tasks/${taskId}`,
      jsonRequest("PATCH", `/tasks/${taskId}`, { dueDate: null }),
      {},
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { startDate: string | null; dueDate: string | null } }>();
    // The start date stands alone now — clearing the due date does not touch it.
    expect(body.task.startDate).toBe("2030-03-01T00:00:00.000Z");
    expect(body.task.dueDate).toBeNull();

    await flush();
    const activities = await fetchActivities(taskId);
    const dueRemoved = activities.find((a) => a.action === "due_date_removed");
    const startRemoved = activities.find((a) => a.action === "start_date_removed");
    expect(dueRemoved).toBeDefined();
    // No phantom start_date_removed: the start date was never cleared.
    expect(startRemoved).toBeUndefined();
  });

  it("rejects an update where both fields appear and startDate is after dueDate (schema refinement)", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Schema refinement update",
    });

    const app = updateApp();
    const res = await app.request(
      `/tasks/${taskId}`,
      jsonRequest("PATCH", `/tasks/${taskId}`, {
        startDate: "2030-03-09",
        dueDate: "2030-03-08",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: { message: string }[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d) => /on or before the due date/i.test(d.message))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // duplicateTask
  // -------------------------------------------------------------------------

  it("copies startDate (alongside dueDate) when duplicating a task", async () => {
    const sourceId = await seedTask(d1, projectId, taskGroupId, {
      title: "Range source",
      startDate: new Date("2030-04-01"),
      dueDate: new Date("2030-04-10"),
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);
    const res = await app.request(
      `/tasks/${sourceId}/duplicate`,
      jsonRequest("POST", `/tasks/${sourceId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { startDate: string | null; dueDate: string | null } }>();
    expect(body.task.startDate).toBe("2030-04-01T00:00:00.000Z");
    expect(body.task.dueDate).toBe("2030-04-10T00:00:00.000Z");
  });

  // -------------------------------------------------------------------------
  // Webhook payload
  // -------------------------------------------------------------------------

  it("includes startDate in the task.updated webhook payload data and changes", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Webhook range",
      startDate: new Date("2030-03-01"),
      dueDate: new Date("2030-03-10"),
    });

    await seedWebhook(d1, workspaceId, {
      url: "https://hooks.example.com/start-date",
      events: JSON.stringify(["task.updated"]),
    });

    // Replace global fetch so the webhook delivery is captured instead of
    // hitting the network; restore in finally so other tests are unaffected.
    const fetchSpy = installFetchSpy();
    try {
      const { ctx, flush } = createAwaitableExecutionCtx();
      const app = new Hono<AppEnv>();
      app.patch(
        "/tasks/:taskId",
        // currentProject is required for dispatchWebhook to resolve the
        // workspace; without it the dispatch silently no-ops.
        fakeAuth(d1, TEST_USER, {
          workspaceMembership: { id: "wm-1", role: "owner" },
          currentProject: { id: projectId, workspaceId },
        }),
        validateBody(updateTaskSchema),
        updateTask,
      );

      const res = await app.request(
        `/tasks/${taskId}`,
        jsonRequest("PATCH", `/tasks/${taskId}`, { startDate: "2030-03-02" }),
        {},
        ctx,
      );
      expect(res.status).toBe(200);
      await flush();

      const deliveryCall = fetchSpy.calls.find(
        ([url]) => url === "https://hooks.example.com/start-date",
      );
      expect(deliveryCall).toBeDefined();
      const init = deliveryCall![1] as RequestInit;
      const payload = JSON.parse(init.body as string) as {
        event: string;
        data: { startDate: string | null; dueDate: string | null };
        changes?: Record<string, { from: unknown; to: unknown }>;
      };
      expect(payload.event).toBe("task.updated");
      expect(payload.data.startDate).toBe("2030-03-02T00:00:00.000Z");
      expect(payload.data.dueDate).toBe("2030-03-10T00:00:00.000Z");
      expect(payload.changes?.startDate).toEqual({
        from: "2030-03-01T00:00:00.000Z",
        to: "2030-03-02T00:00:00.000Z",
      });
    } finally {
      fetchSpy.restore();
    }
  });
});

// =========================================================================
// deleteTask
// =========================================================================

describe("deleteTask", () => {
  it("deletes an existing task", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Delete Me",
    });

    const app = new Hono<AppEnv>();
    app.delete("/tasks/:taskId", auth(), deleteTask);

    const res = await app.request(
      `/tasks/${taskId}`,
      jsonRequest("DELETE", `/tasks/${taskId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify the task is gone
    const getApp = new Hono<AppEnv>();
    getApp.get("/tasks/:taskId", auth(), getTask);
    const getRes = await getApp.request(`/tasks/${taskId}`);
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for nonexistent task", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/tasks/:taskId", auth(), deleteTask);

    const res = await app.request(
      `/tasks/${crypto.randomUUID()}`,
      jsonRequest("DELETE", `/tasks/${crypto.randomUUID()}`),
    );

    expect(res.status).toBe(404);
  });
});

// =========================================================================
// moveTask
// =========================================================================

describe("moveTask", () => {
  it("moves task to a different task group", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Move Me",
    });

    const secondGroup = await seedTaskGroup(d1, projectId, {
      name: "In Progress",
      position: "a5",
    });

    const app = new Hono<AppEnv>();
    app.patch(
      "/tasks/:taskId/move",
      auth(),
      validateBody(moveTaskSchema),
      moveTask,
    );

    const res = await app.request(
      `/tasks/${taskId}/move`,
      jsonRequest("PATCH", `/tasks/${taskId}/move`, {
        taskGroupId: secondGroup,
        position: "a0",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { taskGroupId: string; position: string } }>();
    expect(body.task.taskGroupId).toBe(secondGroup);
    expect(body.task.position).toBe("a0");
  });

  it("auto-completes task when moved to a completion group", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Move to Done",
    });

    const app = new Hono<AppEnv>();
    app.patch(
      "/tasks/:taskId/move",
      auth(),
      validateBody(moveTaskSchema),
      moveTask,
    );

    // Target group (completionGroupId) already has tasks at low positions
    // from earlier tests in the suite (e.g. a task created via the
    // createTask handler in the "auto-completes when created in
    // completion group" test lands at "a0"). Use a high, unique position
    // so the UNIQUE(taskGroupId, position) index doesn't reject the move.
    const res = await app.request(
      `/tasks/${taskId}/move`,
      jsonRequest("PATCH", `/tasks/${taskId}/move`, {
        taskGroupId: completionGroupId,
        position: "z1",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { completed: boolean; taskGroupId: string } }>();
    expect(body.task.completed).toBe(true);
    expect(body.task.taskGroupId).toBe(completionGroupId);
  });

  it("uncompletes task when moved out of a completion group", async () => {
    const taskId = await seedTask(d1, projectId, completionGroupId, {
      title: "Move from Done",
      completed: true,
    });

    const app = new Hono<AppEnv>();
    app.patch(
      "/tasks/:taskId/move",
      auth(),
      validateBody(moveTaskSchema),
      moveTask,
    );

    // Use a unique target position — see comment on previous test for
    // the UNIQUE-index collision that earlier tests can create in
    // taskGroupId.
    const res = await app.request(
      `/tasks/${taskId}/move`,
      jsonRequest("PATCH", `/tasks/${taskId}/move`, {
        taskGroupId: taskGroupId,
        position: "z2",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { completed: boolean; taskGroupId: string } }>();
    expect(body.task.completed).toBe(false);
    expect(body.task.taskGroupId).toBe(taskGroupId);
  });

  it("returns 404 for nonexistent task", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/tasks/:taskId/move",
      auth(),
      validateBody(moveTaskSchema),
      moveTask,
    );

    const res = await app.request(
      `/tasks/${crypto.randomUUID()}/move`,
      jsonRequest("PATCH", `/tasks/${crypto.randomUUID()}/move`, {
        taskGroupId,
        position: "a0",
      }),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 for nonexistent target task group", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Bad move target",
    });

    const app = new Hono<AppEnv>();
    app.patch(
      "/tasks/:taskId/move",
      auth(),
      validateBody(moveTaskSchema),
      moveTask,
    );

    const res = await app.request(
      `/tasks/${taskId}/move`,
      jsonRequest("PATCH", `/tasks/${taskId}/move`, {
        taskGroupId: crypto.randomUUID(),
        position: "a0",
      }),
    );

    expect(res.status).toBe(404);
  });
});

// =========================================================================
// completeTask / uncompleteTask
// =========================================================================

describe("completeTask", () => {
  it("marks a task as completed and moves to completion group", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Complete Me",
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/complete", auth(), completeTask);

    const res = await app.request(
      `/tasks/${taskId}/complete`,
      jsonRequest("POST", `/tasks/${taskId}/complete`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { completed: boolean; taskGroupId: string } }>();
    expect(body.task.completed).toBe(true);
    expect(body.task.taskGroupId).toBe(completionGroupId);
  });

  it("returns task unchanged if already completed", async () => {
    const taskId = await seedTask(d1, projectId, completionGroupId, {
      title: "Already Done",
      completed: true,
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/complete", auth(), completeTask);

    const res = await app.request(
      `/tasks/${taskId}/complete`,
      jsonRequest("POST", `/tasks/${taskId}/complete`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { completed: boolean } }>();
    expect(body.task.completed).toBe(true);
  });

  it("returns 404 for nonexistent task", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/complete", auth(), completeTask);

    const res = await app.request(
      `/tasks/${crypto.randomUUID()}/complete`,
      jsonRequest("POST", `/tasks/fake/complete`),
    );

    expect(res.status).toBe(404);
  });
});

describe("uncompleteTask", () => {
  it("marks a completed task as uncompleted and moves out of completion group", async () => {
    const taskId = await seedTask(d1, projectId, completionGroupId, {
      title: "Uncomplete Me",
      completed: true,
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/uncomplete", auth(), uncompleteTask);

    const res = await app.request(
      `/tasks/${taskId}/uncomplete`,
      jsonRequest("POST", `/tasks/${taskId}/uncomplete`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { completed: boolean; taskGroupId: string } }>();
    expect(body.task.completed).toBe(false);
    // Should be moved to the first non-completion group (taskGroupId = "To Do")
    expect(body.task.taskGroupId).toBe(taskGroupId);
  });

  it("returns task unchanged if already uncompleted", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Already Open",
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/uncomplete", auth(), uncompleteTask);

    const res = await app.request(
      `/tasks/${taskId}/uncomplete`,
      jsonRequest("POST", `/tasks/${taskId}/uncomplete`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ task: { completed: boolean } }>();
    expect(body.task.completed).toBe(false);
  });

  it("returns 404 for nonexistent task", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/uncomplete", auth(), uncompleteTask);

    const res = await app.request(
      `/tasks/${crypto.randomUUID()}/uncomplete`,
      jsonRequest("POST", `/tasks/fake/uncomplete`),
    );

    expect(res.status).toBe(404);
  });
});

// =========================================================================
// createSubtask
// =========================================================================

describe("createSubtask", () => {
  let parentTaskId: string;

  beforeAll(async () => {
    parentTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Parent for subtasks",
    });
  });

  it("creates a subtask on a task and returns 201", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/tasks/:taskId/subtasks",
      auth(),
      validateBody(createSubtaskSchema),
      createSubtask,
    );

    const res = await app.request(
      `/tasks/${parentTaskId}/subtasks`,
      jsonRequest("POST", `/tasks/${parentTaskId}/subtasks`, {
        title: "New subtask",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ subtask: { title: string; completed: boolean; taskId: string } }>();
    expect(body.subtask.title).toBe("New subtask");
    expect(body.subtask.completed).toBe(false);
    expect(body.subtask.taskId).toBe(parentTaskId);
  });

  it("generates unique positions for multiple subtasks", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/tasks/:taskId/subtasks",
      auth(),
      validateBody(createSubtaskSchema),
      createSubtask,
    );

    const res1 = await app.request(
      `/tasks/${parentTaskId}/subtasks`,
      jsonRequest("POST", `/tasks/${parentTaskId}/subtasks`, {
        title: "Subtask 1",
      }),
    );
    const res2 = await app.request(
      `/tasks/${parentTaskId}/subtasks`,
      jsonRequest("POST", `/tasks/${parentTaskId}/subtasks`, {
        title: "Subtask 2",
      }),
    );

    const body1 = await res1.json<{ subtask: { position: string } }>();
    const body2 = await res2.json<{ subtask: { position: string } }>();
    expect(body1.subtask.position).not.toBe(body2.subtask.position);
  });

  it("returns 400 when title is missing", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/tasks/:taskId/subtasks",
      auth(),
      validateBody(createSubtaskSchema),
      createSubtask,
    );

    const res = await app.request(
      `/tasks/${parentTaskId}/subtasks`,
      jsonRequest("POST", `/tasks/${parentTaskId}/subtasks`, {}),
    );

    expect(res.status).toBe(400);
  });
});

// =========================================================================
// updateSubtask
// =========================================================================

describe("updateSubtask", () => {
  let parentTaskId: string;
  let subtaskId: string;

  beforeAll(async () => {
    parentTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Parent for update subtask",
    });
    subtaskId = await seedSubtask(d1, parentTaskId, {
      title: "Updateable subtask",
    });
  });

  it("updates subtask fields", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/subtasks/:subtaskId",
      auth(),
      validateBody(updateSubtaskSchema),
      updateSubtask,
    );

    const res = await app.request(
      `/subtasks/${subtaskId}`,
      jsonRequest("PATCH", `/subtasks/${subtaskId}`, {
        title: "Updated subtask title",
        completed: true,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ subtask: { title: string; completed: boolean } }>();
    expect(body.subtask.title).toBe("Updated subtask title");
    expect(body.subtask.completed).toBe(true);
  });

  it("returns 404 for nonexistent subtask", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/subtasks/:subtaskId",
      auth(),
      validateBody(updateSubtaskSchema),
      updateSubtask,
    );

    const res = await app.request(
      `/subtasks/${crypto.randomUUID()}`,
      jsonRequest("PATCH", `/subtasks/${crypto.randomUUID()}`, {
        title: "Nope",
      }),
    );

    expect(res.status).toBe(404);
  });
});

// =========================================================================
// deleteSubtask
// =========================================================================

describe("deleteSubtask", () => {
  it("deletes an existing subtask", async () => {
    const parentTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Parent for delete subtask",
    });
    const subtaskId = await seedSubtask(d1, parentTaskId, {
      title: "Deleteable subtask",
    });

    const app = new Hono<AppEnv>();
    app.delete("/subtasks/:subtaskId", auth(), deleteSubtask);

    const res = await app.request(
      `/subtasks/${subtaskId}`,
      jsonRequest("DELETE", `/subtasks/${subtaskId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("returns 404 for nonexistent subtask", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/subtasks/:subtaskId", auth(), deleteSubtask);

    const res = await app.request(
      `/subtasks/${crypto.randomUUID()}`,
      jsonRequest("DELETE", `/subtasks/${crypto.randomUUID()}`),
    );

    expect(res.status).toBe(404);
  });
});

// =========================================================================
// createComment
// =========================================================================

describe("createComment", () => {
  let commentTaskId: string;

  beforeAll(async () => {
    commentTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for comments",
    });
  });

  it("creates a comment and returns 201", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/tasks/:taskId/comments",
      auth(),
      validateBody(createCommentSchema),
      createComment,
    );

    const res = await app.request(
      `/tasks/${commentTaskId}/comments`,
      jsonRequest("POST", `/tasks/${commentTaskId}/comments`, {
        body: "This is a comment",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ comment: { body: string; authorName: string; taskId: string } }>();
    expect(body.comment.body).toBe("This is a comment");
    expect(body.comment.authorName).toBe(TEST_USER.name);
    expect(body.comment.taskId).toBe(commentTaskId);
  });

  it("returns 400 when comment body is empty", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/tasks/:taskId/comments",
      auth(),
      validateBody(createCommentSchema),
      createComment,
    );

    const res = await app.request(
      `/tasks/${commentTaskId}/comments`,
      jsonRequest("POST", `/tasks/${commentTaskId}/comments`, {
        body: "",
      }),
    );

    expect(res.status).toBe(400);
  });
});

// =========================================================================
// listComments
// =========================================================================

describe("listComments", () => {
  let listCommentTaskId: string;

  beforeAll(async () => {
    listCommentTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for listing comments",
    });

    // Seed comments with different timestamps for pagination testing
    for (let i = 0; i < 5; i++) {
      await seedComment(d1, listCommentTaskId, TEST_USER.id, {
        body: `Comment ${i + 1}`,
        createdAt: new Date(Date.now() + i * 1000),
      });
    }
  });

  it("returns comments for a task", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/tasks/:taskId/comments",
      auth(),
      validateQuery(listCommentsQuerySchema),
      listComments,
    );

    const res = await app.request(
      `/tasks/${listCommentTaskId}/comments`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ comments: { authorName: string }[] }>();
    expect(body.comments.length).toBe(5);
    // Comments should have authorName resolved
    for (const c of body.comments) {
      expect(c.authorName).toBe(TEST_USER.name);
    }
  });

  it("paginates with limit and returns nextCursor", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/tasks/:taskId/comments",
      auth(),
      validateQuery(listCommentsQuerySchema),
      listComments,
    );

    const res = await app.request(
      `/tasks/${listCommentTaskId}/comments?limit=3`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ comments: { id: string }[]; nextCursor: string }>();
    expect(body.comments.length).toBe(3);
    expect(body.nextCursor).not.toBeNull();

    // Fetch page 2 using the cursor
    const res2 = await app.request(
      `/tasks/${listCommentTaskId}/comments?limit=3&cursor=${encodeURIComponent(body.nextCursor)}`,
    );

    expect(res2.status).toBe(200);
    const body2 = await res2.json<{
      comments: { id: string }[];
      nextCursor: string | null;
    }>();
    expect(body2.comments.length).toBe(2);
    expect(body2.nextCursor).toBeNull();
  });

  it("returns empty array for task with no comments", async () => {
    const emptyTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "No comments task",
    });

    const app = new Hono<AppEnv>();
    app.get(
      "/tasks/:taskId/comments",
      auth(),
      validateQuery(listCommentsQuerySchema),
      listComments,
    );

    const res = await app.request(
      `/tasks/${emptyTaskId}/comments`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ comments: unknown[]; nextCursor: string | null }>();
    expect(body.comments.length).toBe(0);
    expect(body.nextCursor).toBeNull();
  });
});

// =========================================================================
// deleteComment
// =========================================================================

describe("deleteComment", () => {
  it("author can delete their own comment", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for delete comment",
    });
    const commentId = await seedComment(d1, taskId, TEST_USER.id, {
      body: "Delete me",
    });

    const app = new Hono<AppEnv>();
    app.delete("/comments/:commentId", auth(), deleteComment);

    const res = await app.request(
      `/comments/${commentId}`,
      jsonRequest("DELETE", `/comments/${commentId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("project admin can delete another user's comment", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for admin delete",
    });
    const commentId = await seedComment(d1, taskId, TEST_USER_2.id, {
      body: "User2 comment",
    });

    // TEST_USER is project admin (seeded above), should be able to delete
    const app = new Hono<AppEnv>();
    app.delete("/comments/:commentId", auth(), deleteComment);

    const res = await app.request(
      `/comments/${commentId}`,
      jsonRequest("DELETE", `/comments/${commentId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("returns 404 for nonexistent comment", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/comments/:commentId", auth(), deleteComment);

    const res = await app.request(
      `/comments/${crypto.randomUUID()}`,
      jsonRequest("DELETE", `/comments/${crypto.randomUUID()}`),
    );

    expect(res.status).toBe(404);
  });
});

// =========================================================================
// getTaskActivity
// =========================================================================

describe("getTaskActivity", () => {
  let activityTaskId: string;

  beforeAll(async () => {
    activityTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Activity Test Task",
    });

    // Seed activity entries with distinct timestamps so cursor pagination works
    // (activities created within the same millisecond cannot be distinguished by lt/gt)
    const baseTime = Date.now() - 10000;
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO task_activity (id, taskId, actorId, action, field, oldValue, newValue, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), activityTaskId, TEST_USER.id, "created", null, null, null, baseTime),
      d1
        .prepare(
          `INSERT INTO task_activity (id, taskId, actorId, action, field, oldValue, newValue, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), activityTaskId, TEST_USER.id, "title_changed", "title", "Activity Test Task", "Renamed Task", baseTime + 2000),
      d1
        .prepare(
          `INSERT INTO task_activity (id, taskId, actorId, action, field, oldValue, newValue, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), activityTaskId, TEST_USER.id, "priority_changed", "priority", "none", "high", baseTime + 4000),
    ]);
  });

  it("returns activity entries for a task", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/tasks/:taskId/activity",
      auth(),
      validateQuery(listActivityQuerySchema),
      getTaskActivity,
    );

    const res = await app.request(
      `/tasks/${activityTaskId}/activity?limit=50`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ activities: { action: string; actorName: string }[] }>();

    expect(body.activities.length).toBeGreaterThanOrEqual(3);

    // Verify the "created" activity exists
    const created = body.activities.find((a: { action: string }) => a.action === "created");
    expect(created).toBeDefined();
    expect(created!.actorName).toBe(TEST_USER.name);

    // Verify the "title_changed" activity exists
    const titleChanged = body.activities.find(
      (a: { action: string }) => a.action === "title_changed",
    );
    expect(titleChanged).toBeDefined();

    // Verify the "priority_changed" activity exists
    const priorityChanged = body.activities.find(
      (a: { action: string }) => a.action === "priority_changed",
    );
    expect(priorityChanged).toBeDefined();
  });

  it("paginates activity entries", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/tasks/:taskId/activity",
      auth(),
      validateQuery(listActivityQuerySchema),
      getTaskActivity,
    );

    // Fetch first page with limit of 1
    const res = await app.request(
      `/tasks/${activityTaskId}/activity?limit=1`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ activities: { id: string }[]; nextCursor: string }>();
    expect(body.activities.length).toBe(1);
    expect(body.nextCursor).not.toBeNull();

    // Fetch next page
    const res2 = await app.request(
      `/tasks/${activityTaskId}/activity?limit=1&cursor=${encodeURIComponent(body.nextCursor)}`,
    );

    expect(res2.status).toBe(200);
    const body2 = await res2.json<{
      activities: { id: string }[];
    }>();
    expect(body2.activities.length).toBe(1);
    // Should be a different activity
    expect(body2.activities[0].id).not.toBe(body.activities[0].id);
  });

  it("returns empty for task with no activity", async () => {
    // Seed task directly (bypasses handler, no activity generated)
    const rawTaskId = await seedTask(d1, projectId, taskGroupId, {
      title: "No activity",
    });

    const app = new Hono<AppEnv>();
    app.get(
      "/tasks/:taskId/activity",
      auth(),
      validateQuery(listActivityQuerySchema),
      getTaskActivity,
    );

    const res = await app.request(
      `/tasks/${rawTaskId}/activity`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ activities: unknown[]; nextCursor: string | null }>();
    expect(body.activities.length).toBe(0);
    expect(body.nextCursor).toBeNull();
  });
});

// =========================================================================
// updateComment
// =========================================================================

describe("updateComment", () => {
  it("successfully updates comment body and returns updated comment", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for update comment",
    });
    const commentId = await seedComment(d1, taskId, TEST_USER.id, {
      body: "Original body",
    });

    const app = new Hono<AppEnv>();
    app.patch(
      "/comments/:commentId",
      auth(),
      validateBody(updateCommentSchema),
      updateComment,
    );

    const res = await app.request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "Updated body" }),
    );

    expect(res.status).toBe(200);
    const data = await res.json<{ comment: { id: string; body: string; authorName: string } }>();
    expect(data.comment.id).toBe(commentId);
    expect(data.comment.body).toBe("Updated body");
    // Pins authorName enrichment on the PATCH response: createComment and
    // listComments both resolve authorName, and the web Comment interface
    // requires it — the update response must not be the one sibling surface
    // missing the field. The author-only guard (403 for non-authors) makes
    // the acting user's name correct by construction.
    expect(data.comment.authorName).toBe(TEST_USER.name);
  });

  it("returns 404 for non-existent comment", async () => {
    const app = new Hono<AppEnv>();
    app.patch(
      "/comments/:commentId",
      auth(),
      validateBody(updateCommentSchema),
      updateComment,
    );

    const fakeCommentId = crypto.randomUUID();
    const res = await app.request(
      `/comments/${fakeCommentId}`,
      jsonRequest("PATCH", `/comments/${fakeCommentId}`, { body: "Updated" }),
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 when user tries to update another user's comment", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for forbidden update",
    });
    // Comment authored by TEST_USER_2
    const commentId = await seedComment(d1, taskId, TEST_USER_2.id, {
      body: "User2 comment",
    });

    // Try to update as TEST_USER (not the author)
    const app = new Hono<AppEnv>();
    app.patch(
      "/comments/:commentId",
      auth(),
      validateBody(updateCommentSchema),
      updateComment,
    );

    const res = await app.request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "Hijacked" }),
    );

    expect(res.status).toBe(403);
  });

  it("rejects empty body", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for empty body test",
    });
    const commentId = await seedComment(d1, taskId, TEST_USER.id, {
      body: "Original",
    });

    const app = new Hono<AppEnv>();
    app.patch(
      "/comments/:commentId",
      auth(),
      validateBody(updateCommentSchema),
      updateComment,
    );

    const res = await app.request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "" }),
    );

    // Validation should reject empty string (min(1))
    expect(res.status).toBe(400);
  });

  it("updates the updatedAt timestamp after edit", async () => {
    const earlyDate = new Date("2020-01-01T00:00:00.000Z");
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for timestamp test",
    });
    const commentId = await seedComment(d1, taskId, TEST_USER.id, {
      body: "Old body",
      createdAt: earlyDate,
    });

    const app = new Hono<AppEnv>();
    app.patch(
      "/comments/:commentId",
      auth(),
      validateBody(updateCommentSchema),
      updateComment,
    );

    const res = await app.request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, { body: "New body" }),
    );

    expect(res.status).toBe(200);
    const data = await res.json<{ comment: { body: string; updatedAt: number | string } }>();
    expect(data.comment.body).toBe("New body");
    // updatedAt should be more recent than the early seed date
    const updatedAtMs = typeof data.comment.updatedAt === "number"
      ? data.comment.updatedAt
      : new Date(data.comment.updatedAt).getTime();
    expect(updatedAtMs).toBeGreaterThan(earlyDate.getTime());
  });
});

// =========================================================================
// Comment activity logging
// =========================================================================

describe("Comment activity logging", () => {
  /** Fetch all activities for a task and return them typed. */
  async function fetchActivities(taskId: string) {
    const activityApp = new Hono<AppEnv>();
    activityApp.get(
      "/tasks/:taskId/activity",
      auth(),
      validateQuery(listActivityQuerySchema),
      getTaskActivity,
    );

    const res = await activityApp.request(
      `/tasks/${taskId}/activity?limit=50`,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      activities: { action: string; newValue: string | null; actorName: string }[];
    }>();
    return body.activities;
  }

  it("createComment logs comment_added activity", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for comment activity",
    });

    const commentApp = new Hono<AppEnv>();
    commentApp.post(
      "/tasks/:taskId/comments",
      auth(),
      validateBody(createCommentSchema),
      createComment,
    );

    const res = await commentApp.request(
      `/tasks/${taskId}/comments`,
      jsonRequest("POST", `/tasks/${taskId}/comments`, {
        body: "Activity test comment",
      }),
    );
    expect(res.status).toBe(201);

    const activities = await fetchActivities(taskId);
    const commentActivity = activities.find(
      (a) => a.action === "comment_added",
    );
    expect(commentActivity).toBeDefined();
    expect(commentActivity!.newValue).toBe("Activity test comment");
    expect(commentActivity!.actorName).toBe(TEST_USER.name);
  });

  it("createComment truncates long comment body in activity newValue", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for long comment activity",
    });

    const longBody = "x".repeat(200);

    const commentApp = new Hono<AppEnv>();
    commentApp.post(
      "/tasks/:taskId/comments",
      auth(),
      validateBody(createCommentSchema),
      createComment,
    );

    const res = await commentApp.request(
      `/tasks/${taskId}/comments`,
      jsonRequest("POST", `/tasks/${taskId}/comments`, {
        body: longBody,
      }),
    );
    expect(res.status).toBe(201);

    const activities = await fetchActivities(taskId);
    const commentActivity = activities.find(
      (a) => a.action === "comment_added",
    );
    expect(commentActivity).toBeDefined();
    expect(commentActivity!.newValue).toHaveLength(100);
  });

  it("updateComment logs comment_updated activity", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for update comment activity",
    });
    const commentId = await seedComment(d1, taskId, TEST_USER.id, {
      body: "Original body",
    });

    const updateApp = new Hono<AppEnv>();
    updateApp.patch(
      "/comments/:commentId",
      auth(),
      validateBody(updateCommentSchema),
      updateComment,
    );

    const res = await updateApp.request(
      `/comments/${commentId}`,
      jsonRequest("PATCH", `/comments/${commentId}`, {
        body: "Updated body",
      }),
    );
    expect(res.status).toBe(200);

    const activities = await fetchActivities(taskId);
    const updatedActivity = activities.find(
      (a) => a.action === "comment_updated",
    );
    expect(updatedActivity).toBeDefined();
    expect(updatedActivity!.actorName).toBe(TEST_USER.name);
  });

  it("deleteComment (author) logs comment_deleted activity", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for delete comment activity",
    });
    const commentId = await seedComment(d1, taskId, TEST_USER.id, {
      body: "To be deleted",
    });

    const deleteApp = new Hono<AppEnv>();
    deleteApp.delete("/comments/:commentId", auth(), deleteComment);

    const res = await deleteApp.request(
      `/comments/${commentId}`,
      jsonRequest("DELETE", `/comments/${commentId}`),
    );
    expect(res.status).toBe(200);

    const activities = await fetchActivities(taskId);
    const deletedActivity = activities.find(
      (a) => a.action === "comment_deleted",
    );
    expect(deletedActivity).toBeDefined();
    expect(deletedActivity!.actorName).toBe(TEST_USER.name);
  });

  it("deleteComment (admin) logs comment_deleted activity with admin as actor", async () => {
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task for admin delete comment activity",
    });
    // Comment authored by TEST_USER_2
    const commentId = await seedComment(d1, taskId, TEST_USER_2.id, {
      body: "User2 comment to be admin-deleted",
    });

    // Delete as TEST_USER (who is project admin)
    const deleteApp = new Hono<AppEnv>();
    deleteApp.delete("/comments/:commentId", auth(), deleteComment);

    const res = await deleteApp.request(
      `/comments/${commentId}`,
      jsonRequest("DELETE", `/comments/${commentId}`),
    );
    expect(res.status).toBe(200);

    const activities = await fetchActivities(taskId);
    const deletedActivity = activities.find(
      (a) => a.action === "comment_deleted",
    );
    expect(deletedActivity).toBeDefined();
    // Admin (TEST_USER) is the actor, not the comment author (TEST_USER_2)
    expect(deletedActivity!.actorName).toBe(TEST_USER.name);
  });
});

// =========================================================================
// duplicateTask
// =========================================================================

describe("duplicateTask", () => {
  it("duplicates a task with all copyable fields preserved", async () => {
    const sourceId = await seedTask(d1, projectId, taskGroupId, {
      title: "Source Task",
      priority: "high",
      assigneeId: TEST_USER.id,
      description: "A detailed description",
      cost: 5,
      icon: "star",
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);

    const res = await app.request(
      `/tasks/${sourceId}/duplicate`,
      jsonRequest("POST", `/tasks/${sourceId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{
      task: {
        id: string;
        title: string;
        priority: string;
        assigneeId: string | null;
        description: string | null;
        cost: number | null;
        icon: string | null;
        completed: boolean;
        coverImageKey: string | null;
        taskGroupId: string;
        subtaskCount: number;
        subtaskCompletedCount: number;
        commentCount: number;
      };
    }>();

    expect(body.task.id).not.toBe(sourceId);
    expect(body.task.title).toBe("Source Task (copy)");
    expect(body.task.priority).toBe("high");
    expect(body.task.assigneeId).toBe(TEST_USER.id);
    expect(body.task.description).toBe("A detailed description");
    expect(body.task.cost).toBe(5);
    expect(body.task.icon).toBe("star");
    expect(body.task.completed).toBe(false);
    expect(body.task.coverImageKey).toBeNull();
    expect(body.task.taskGroupId).toBe(taskGroupId);
    expect(body.task.commentCount).toBe(0);
  });

  it("duplicates subtasks with completion reset", async () => {
    const sourceId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task With Subtasks",
    });
    await seedSubtask(d1, sourceId, { title: "Subtask A", completed: true });
    await seedSubtask(d1, sourceId, { title: "Subtask B", completed: false, position: "b0" });
    await seedSubtask(d1, sourceId, { title: "Subtask C", completed: true, position: "c0" });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);

    const res = await app.request(
      `/tasks/${sourceId}/duplicate`,
      jsonRequest("POST", `/tasks/${sourceId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; subtaskCount: number; subtaskCompletedCount: number } }>();
    expect(body.task.subtaskCount).toBe(3);
    expect(body.task.subtaskCompletedCount).toBe(0);

    // Verify subtasks are actually in the DB for the new task
    const getApp = new Hono<AppEnv>();
    getApp.get("/tasks/:taskId", auth(), getTask);

    const detailRes = await getApp.request(
      `/tasks/${body.task.id}`,
      jsonRequest("GET", `/tasks/${body.task.id}`),
    );
    const detail = await detailRes.json<{ task: { subtasks: Array<{ title: string; completed: boolean }> } }>();
    expect(detail.task.subtasks).toHaveLength(3);
    // All subtasks should be incomplete regardless of source
    for (const st of detail.task.subtasks) {
      expect(st.completed).toBe(false);
    }
    const titles = detail.task.subtasks.map((s) => s.title).sort();
    expect(titles).toEqual(["Subtask A", "Subtask B", "Subtask C"]);
  });

  it("always creates the new task as incomplete", async () => {
    const sourceId = await seedTask(d1, projectId, completionGroupId, {
      title: "Completed Source",
      completed: true,
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);

    const res = await app.request(
      `/tasks/${sourceId}/duplicate`,
      jsonRequest("POST", `/tasks/${sourceId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { completed: boolean } }>();
    expect(body.task.completed).toBe(false);
  });

  it("does not copy cover image (R2 or Unsplash)", async () => {
    const sourceId = await seedTask(d1, projectId, taskGroupId, {
      title: "With Cover",
      coverImageKey: "some-cover-key",
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);

    const res = await app.request(
      `/tasks/${sourceId}/duplicate`,
      jsonRequest("POST", `/tasks/${sourceId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{
      task: {
        id: string;
        coverImageKey: string | null;
        coverUnsplash: StoredUnsplashCoverPayload | null;
      };
    }>();
    expect(body.task.coverImageKey).toBeNull();
    expect(body.task.coverUnsplash).toBeNull();

    // Verify at the DB layer too — duplication of a task that had an Unsplash
    // cover should null the JSON column on the new row.
    const unsplashSource = await seedTask(d1, projectId, taskGroupId, {
      title: "With Unsplash Cover",
      coverUnsplash: {
        id: "src-photo",
        rawUrl: "https://images.unsplash.com/src-photo/raw",
        url: "https://images.unsplash.com/src-photo",
        thumbUrl: "https://images.unsplash.com/src-photo/thumb",
        blurHash: null,
        color: null,
        description: null,
        width: 100,
        height: 100,
        photoUrl:
          "https://unsplash.com/photos/src-photo?utm_source=cadence&utm_medium=referral",
        downloadLocation:
          "https://api.unsplash.com/photos/src-photo/download?ixid=x",
        user: {
          name: "N",
          username: "u",
          profileUrl:
            "https://unsplash.com/@u?utm_source=cadence&utm_medium=referral",
        },
      },
    });
    const dupRes = await app.request(
      `/tasks/${unsplashSource}/duplicate`,
      jsonRequest("POST", `/tasks/${unsplashSource}/duplicate`),
    );
    expect(dupRes.status).toBe(201);
    const dupBody = await dupRes.json<{
      task: { id: string; coverUnsplash: StoredUnsplashCoverPayload | null };
    }>();
    expect(dupBody.task.coverUnsplash).toBeNull();
    const row = await d1
      .prepare("SELECT cover_unsplash AS u FROM task WHERE id = ?")
      .bind(dupBody.task.id)
      .first<{ u: string | null }>();
    expect(row?.u).toBeNull();
  });

  it("returns 404 for non-existent task", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);

    const fakeId = crypto.randomUUID();
    const res = await app.request(
      `/tasks/${fakeId}/duplicate`,
      jsonRequest("POST", `/tasks/${fakeId}/duplicate`),
    );

    expect(res.status).toBe(404);
  });

  it("logs activity on the new task", async () => {
    const sourceId = await seedTask(d1, projectId, taskGroupId, {
      title: "Activity Source",
    });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);

    const res = await app.request(
      `/tasks/${sourceId}/duplicate`,
      jsonRequest("POST", `/tasks/${sourceId}/duplicate`),
    );

    const body = await res.json<{ task: { id: string } }>();
    const newTaskId = body.task.id;

    // Fetch activity for the new task
    const actApp = new Hono<AppEnv>();
    actApp.get(
      "/tasks/:taskId/activity",
      auth(),
      validateQuery(listActivityQuerySchema),
      getTaskActivity,
    );

    const actRes = await actApp.request(
      `/tasks/${newTaskId}/activity`,
      jsonRequest("GET", `/tasks/${newTaskId}/activity`),
    );
    const actBody = await actRes.json<{
      activities: Array<{ action: string; newValue: string | null }>;
    }>();

    const createdActivity = actBody.activities.find((a) => a.action === "created");
    expect(createdActivity).toBeDefined();
    expect(createdActivity!.newValue).toBe("Duplicated from: Activity Source");
  });

  it("does not copy comments", async () => {
    const sourceId = await seedTask(d1, projectId, taskGroupId, {
      title: "Task With Comments",
    });
    await seedComment(d1, sourceId, TEST_USER.id, { body: "A comment" });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/duplicate", auth(), duplicateTask);

    const res = await app.request(
      `/tasks/${sourceId}/duplicate`,
      jsonRequest("POST", `/tasks/${sourceId}/duplicate`),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ task: { id: string; commentCount: number } }>();
    expect(body.task.commentCount).toBe(0);

    // Verify via comments endpoint
    const commApp = new Hono<AppEnv>();
    commApp.get(
      "/tasks/:taskId/comments",
      auth(),
      validateQuery(listCommentsQuerySchema),
      listComments,
    );

    const commRes = await commApp.request(
      `/tasks/${body.task.id}/comments`,
      jsonRequest("GET", `/tasks/${body.task.id}/comments`),
    );
    const commBody = await commRes.json<{ comments: unknown[] }>();
    expect(commBody.comments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task cover image handlers — upload / apply-Unsplash / delete + XOR invariant
// ---------------------------------------------------------------------------

describe("task cover image handlers", () => {
  // These tests need both D1 and R2; use the shared `createTestD1WithR2`
  // helper so the migration + Miniflare plumbing lives in one place.
  let coverD1: D1Database;
  let coverStorage: R2Bucket;
  let coverDispose: () => Promise<void>;
  let coverProjectId: string;
  let coverTaskGroupId: string;

  beforeAll(async () => {
    const result = await createTestD1WithR2();
    coverD1 = result.d1;
    coverStorage = result.storage;
    coverDispose = result.dispose;

    await seedUser(coverD1);
    await seedUser(coverD1, TEST_USER_2);
    const wsId = await seedWorkspace(coverD1, TEST_USER.id);
    coverProjectId = await seedProject(coverD1, wsId);
    await seedProjectMember(coverD1, coverProjectId, TEST_USER.id, "admin");
    await seedProjectMember(coverD1, coverProjectId, TEST_USER_2.id, "viewer");
    coverTaskGroupId = await seedTaskGroup(coverD1, coverProjectId);
  });

  afterAll(async () => {
    await coverDispose();
  });

  /**
   * Auth middleware for the cover tests: wires real D1 + R2 + (optionally)
   * Unsplash config into c.env, and sets the `projectAccess` variable so the
   * task cover helpers' fast-path (skipping the re-query) is exercised.
   */
  function coverAuth(opts?: {
    user?: typeof TEST_USER | typeof TEST_USER_2;
    unsplashAccessKey?: string | null;
    projectAccess?: { role: "admin" | "member" | "viewer"; source: "workspace" | "project" };
  }): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      const envRec = c.env as Record<string, unknown>;
      envRec.DB = coverD1;
      envRec.STORAGE = coverStorage;
      if (opts?.unsplashAccessKey !== null) {
        envRec.UNSPLASH_ACCESS_KEY = opts?.unsplashAccessKey ?? "test-access-key";
        envRec.UNSPLASH_APP_NAME = "cadence-test";
      }

      c.set("db", createDb(coverD1));
      c.set("user", (opts?.user ?? TEST_USER) as never);
      c.set("session", null);
      c.set("requestId", "test-request-id");
      // Default: admin via direct project membership (allows writes).
      c.set(
        "projectAccess",
        opts?.projectAccess ?? { role: "admin", source: "project" },
      );

      await next();
    };
  }

  function unsplashRequest(taskIdParam: string, payload: UnsplashCoverPayload): Request {
    return new Request(`http://localhost/tasks/${taskIdParam}/cover/unsplash`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  function uploadRequest(taskIdParam: string, file: File): Request {
    const form = new FormData();
    form.append("file", file);
    return new Request(`http://localhost/tasks/${taskIdParam}/cover`, {
      method: "PUT",
      body: form,
    });
  }

  async function readCoverState(taskIdParam: string) {
    const row = await coverD1
      .prepare(
        "SELECT cover_image_key AS k, cover_unsplash AS u FROM task WHERE id = ?",
      )
      .bind(taskIdParam)
      .first<{ k: string | null; u: string | null }>();
    return {
      coverImageKey: row?.k ?? null,
      // Stored (lenient) shape: this is a raw DB read — legacy rows may lack
      // `rawUrl`, so casting to the strict apply-payload type would be a lie.
      coverUnsplash: row?.u ? (JSON.parse(row.u) as StoredUnsplashCoverPayload) : null,
    };
  }

  // `trackDownload` issues a real HTTP GET. The shared `installFetchSpy`
  // replaces `globalThis.fetch` per-test and records every call.
  let fetchSpy: ReturnType<typeof installFetchSpy>;

  beforeEach(() => {
    fetchSpy = installFetchSpy();
  });

  afterEach(() => {
    fetchSpy.restore();
  });

  // -------------------------------------------------------------------------
  // applyTaskUnsplashCover
  // -------------------------------------------------------------------------

  it("applies an Unsplash cover on a task with no existing cover and tracks download once", async () => {
    const tId = await seedTask(coverD1, coverProjectId, coverTaskGroupId, {
      title: "No Cover",
    });

    const app = new Hono<AppEnv>();
    app.put(
      "/tasks/:taskId/cover/unsplash",
      coverAuth(),
      validateBody(unsplashCoverPayloadSchema),
      applyTaskUnsplashCover,
    );

    const payload = sampleUnsplashPayload("t-apply-fresh");
    const res = await app.request(unsplashRequest(tId, payload));
    expect(res.status).toBe(200);

    const body = await res.json<{
      coverImageKey: string | null;
      coverUnsplash: StoredUnsplashCoverPayload | null;
    }>();
    expect(body.coverImageKey).toBeNull();
    expect(body.coverUnsplash?.id).toBe("t-apply-fresh");

    const state = await readCoverState(tId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash?.id).toBe("t-apply-fresh");

    const matching = fetchSpy.calls.filter(
      ([url]) => typeof url === "string" && url.startsWith(payload.downloadLocation),
    );
    expect(matching.length).toBe(1);
    const init = matching[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Client-ID test-access-key");
  });

  it("applies an Unsplash cover on a task that had an R2 upload, cleaning the R2 object", async () => {
    const tId = await seedTask(coverD1, coverProjectId, coverTaskGroupId, {
      title: "Swap R2 -> Unsplash",
    });

    const uploadApp = new Hono<AppEnv>();
    uploadApp.put("/tasks/:taskId/cover", coverAuth(), uploadTaskCover);
    const uploadRes = await uploadApp.request(
      uploadRequest(tId, fakeCoverPngFile()),
    );
    expect(uploadRes.status).toBe(200);
    const { coverImageKey: oldKey } = await uploadRes.json<{
      coverImageKey: string;
    }>();
    expect(await coverStorage.get(oldKey)).not.toBeNull();

    const app = new Hono<AppEnv>();
    app.put(
      "/tasks/:taskId/cover/unsplash",
      coverAuth(),
      validateBody(unsplashCoverPayloadSchema),
      applyTaskUnsplashCover,
    );
    const res = await app.request(
      unsplashRequest(tId, sampleUnsplashPayload("t-swap-r2-us")),
    );
    expect(res.status).toBe(200);

    const state = await readCoverState(tId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash?.id).toBe("t-swap-r2-us");

    expect(await coverStorage.get(oldKey)).toBeNull();
    const uploadRow = await coverD1
      .prepare("SELECT id FROM upload WHERE key = ?")
      .bind(oldKey)
      .first();
    expect(uploadRow).toBeNull();
  });

  it("uploading an R2 cover after an Unsplash cover clears coverUnsplash (XOR)", async () => {
    const tId = await seedTask(coverD1, coverProjectId, coverTaskGroupId, {
      title: "Swap Unsplash -> R2",
      coverUnsplash: sampleUnsplashPayload("t-pre-existing"),
    });

    const app = new Hono<AppEnv>();
    app.put("/tasks/:taskId/cover", coverAuth(), uploadTaskCover);
    const res = await app.request(uploadRequest(tId, fakeCoverPngFile()));
    expect(res.status).toBe(200);
    const body = await res.json<{
      coverImageKey: string;
      coverUnsplash: StoredUnsplashCoverPayload | null;
    }>();
    expect(body.coverImageKey).toMatch(/^task-cover\//);
    expect(body.coverUnsplash).toBeNull();

    const state = await readCoverState(tId);
    expect(state.coverImageKey).toBe(body.coverImageKey);
    expect(state.coverUnsplash).toBeNull();
  });

  // -------------------------------------------------------------------------
  // deleteTaskCover
  // -------------------------------------------------------------------------

  it("deleting a task cover when Unsplash was set nulls both columns", async () => {
    const tId = await seedTask(coverD1, coverProjectId, coverTaskGroupId, {
      title: "Delete Unsplash",
      coverUnsplash: sampleUnsplashPayload("t-del-us"),
    });

    const app = new Hono<AppEnv>();
    app.delete("/tasks/:taskId/cover", coverAuth(), deleteTaskCover);
    const res = await app.request(
      new Request(`http://localhost/tasks/${tId}/cover`, { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    const state = await readCoverState(tId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash).toBeNull();
  });

  it("deleting a task cover when R2 was set removes the R2 object and nulls both columns", async () => {
    const tId = await seedTask(coverD1, coverProjectId, coverTaskGroupId, {
      title: "Delete R2",
    });

    const uploadApp = new Hono<AppEnv>();
    uploadApp.put("/tasks/:taskId/cover", coverAuth(), uploadTaskCover);
    const uploadRes = await uploadApp.request(
      uploadRequest(tId, fakeCoverPngFile()),
    );
    expect(uploadRes.status).toBe(200);
    const { coverImageKey: key } = await uploadRes.json<{
      coverImageKey: string;
    }>();

    const delApp = new Hono<AppEnv>();
    delApp.delete("/tasks/:taskId/cover", coverAuth(), deleteTaskCover);
    const res = await delApp.request(
      new Request(`http://localhost/tasks/${tId}/cover`, { method: "DELETE" }),
    );
    expect(res.status).toBe(200);

    const state = await readCoverState(tId);
    expect(state.coverImageKey).toBeNull();
    expect(state.coverUnsplash).toBeNull();
    expect(await coverStorage.get(key)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Config / availability
  // -------------------------------------------------------------------------

  it("returns 503 when UNSPLASH_ACCESS_KEY is absent", async () => {
    const tId = await seedTask(coverD1, coverProjectId, coverTaskGroupId, {
      title: "No Unsplash",
    });

    const app = new Hono<AppEnv>();
    app.put(
      "/tasks/:taskId/cover/unsplash",
      coverAuth({ unsplashAccessKey: null }),
      validateBody(unsplashCoverPayloadSchema),
      applyTaskUnsplashCover,
    );
    const res = await app.request(
      unsplashRequest(tId, sampleUnsplashPayload("t-503")),
    );
    expect(res.status).toBe(503);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("Unsplash");
  });

  // -------------------------------------------------------------------------
  // Read shape audit
  // -------------------------------------------------------------------------

  it("task detail response includes coverUnsplash (null when unset, object when applied)", async () => {
    const tId = await seedTask(coverD1, coverProjectId, coverTaskGroupId, {
      title: "Detail Reads",
    });

    const getApp = new Hono<AppEnv>();
    getApp.get("/tasks/:taskId", coverAuth(), getTask);

    const r1 = await getApp.request(
      `/tasks/${tId}`,
      jsonRequest("GET", `/tasks/${tId}`),
    );
    expect(r1.status).toBe(200);
    const body1 = await r1.json<{
      task: { coverUnsplash: StoredUnsplashCoverPayload | null };
    }>();
    expect(body1.task).toHaveProperty("coverUnsplash");
    expect(body1.task.coverUnsplash).toBeNull();

    const applyApp = new Hono<AppEnv>();
    applyApp.put(
      "/tasks/:taskId/cover/unsplash",
      coverAuth(),
      validateBody(unsplashCoverPayloadSchema),
      applyTaskUnsplashCover,
    );
    const applyRes = await applyApp.request(
      unsplashRequest(tId, sampleUnsplashPayload("t-detail-reads")),
    );
    expect(applyRes.status).toBe(200);

    const r2 = await getApp.request(
      `/tasks/${tId}`,
      jsonRequest("GET", `/tasks/${tId}`),
    );
    const body2 = await r2.json<{
      task: { coverUnsplash: StoredUnsplashCoverPayload | null };
    }>();
    expect(body2.task.coverUnsplash?.id).toBe("t-detail-reads");
  });
});

// =========================================================================
// completeTask — recurring spawn preserves start→due offset
// =========================================================================

/**
 * A recurring task advances its PRIMARY date. For a ranged task (start + due)
 * the due date is the anchor (`computeNextDueDate`) and the spawned start is
 * derived by carrying the previous start→due whole-day span forward
 * (`computeNextStartDate`). These tests exercise the full handler path —
 * complete a recurring task over real D1 — because no unit test can catch the
 * spawn wiring itself: an earlier bug had the new-row literal simply omit
 * startDate, silently dropping the date range from every recurring instance.
 *
 * Two date-shape cases are pinned separately:
 * - start-only (now reachable — a startDate no longer requires a dueDate): the
 *   recurrence anchors on the START date, advances it, and the spawn stays
 *   due-less, so a start-only series never silently grows a due date.
 * - fully date-less: the spawn anchors on completionDate (the "N days after I
 *   finish" pattern) and materialises a due date, with startDate null.
 */
describe("completeTask (recurring spawn startDate)", () => {
  /** Attach a recurrence rule directly — seedTask has no recurrence support. */
  async function setRecurrenceRule(taskId: string, rule: object): Promise<void> {
    await d1
      .prepare("UPDATE task SET recurrence_rule = ? WHERE id = ?")
      .bind(JSON.stringify(rule), taskId)
      .run();
  }

  it("spawns the next instance with startDate preserving the start→due day offset", async () => {
    // Previous instance spans Thu 2030-03-07 → Sun 2030-03-10 (3 whole days).
    // Weekly recurrence anchored on the (future) due date → next due is
    // 2030-03-17, so the spawned start must be 2030-03-14.
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Recurring Range Task",
      startDate: new Date(Date.UTC(2030, 2, 7)),
      dueDate: new Date(Date.UTC(2030, 2, 10)),
    });
    await setRecurrenceRule(taskId, { frequency: "weekly", interval: 1 });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/complete", auth(), completeTask);

    const res = await app.request(
      `/tasks/${taskId}/complete`,
      jsonRequest("POST", `/tasks/${taskId}/complete`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      task: { completed: boolean };
      nextRecurringTask: { id: string; startDate: string | null; dueDate: string | null } | null;
    }>();
    expect(body.task.completed).toBe(true);
    expect(body.nextRecurringTask).not.toBeNull();
    expect(body.nextRecurringTask!.dueDate).toBe("2030-03-17T00:00:00.000Z");
    expect(body.nextRecurringTask!.startDate).toBe("2030-03-14T00:00:00.000Z");

    // The offset must survive persistence, not just the response shape —
    // timestamps are stored as Unix seconds (UTC midnight).
    const row = await d1
      .prepare("SELECT startDate, dueDate FROM task WHERE recurrence_parent_id = ?")
      .bind(taskId)
      .first<{ startDate: number; dueDate: number }>();
    expect(row).not.toBeNull();
    expect(row!.startDate).toBe(Date.UTC(2030, 2, 14) / 1000);
    expect(row!.dueDate).toBe(Date.UTC(2030, 2, 17) / 1000);
  });

  it("spawns a start-only series by advancing the start date and leaving the due date null", async () => {
    // A start-only recurring task (start 2030-03-07, no due) anchors the
    // recurrence on its START date. Daily/1 advances it to 2030-03-08; the
    // spawned instance stays due-less rather than inventing a due date.
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Recurring Start-Only Task",
      startDate: new Date(Date.UTC(2030, 2, 7)),
    });
    await setRecurrenceRule(taskId, { frequency: "daily", interval: 1 });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/complete", auth(), completeTask);

    const res = await app.request(
      `/tasks/${taskId}/complete`,
      jsonRequest("POST", `/tasks/${taskId}/complete`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      nextRecurringTask: { id: string; startDate: string | null; dueDate: string | null } | null;
    }>();
    expect(body.nextRecurringTask).not.toBeNull();
    expect(body.nextRecurringTask!.startDate).toBe("2030-03-08T00:00:00.000Z");
    expect(body.nextRecurringTask!.dueDate).toBeNull();

    // Survives persistence: start advanced one day, due still null.
    const row = await d1
      .prepare("SELECT startDate, dueDate FROM task WHERE recurrence_parent_id = ?")
      .bind(taskId)
      .first<{ startDate: number | null; dueDate: number | null }>();
    expect(row).not.toBeNull();
    expect(row!.startDate).toBe(Date.UTC(2030, 2, 8) / 1000);
    expect(row!.dueDate).toBeNull();
  });

  it("spawns with startDate null when the completed task has no dates (completionDate-anchored)", async () => {
    // A fully date-less recurring task anchors on completionDate and
    // materialises a due date; there is no start to carry forward.
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Recurring Date-less Task",
    });
    await setRecurrenceRule(taskId, { frequency: "daily", interval: 1 });

    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/complete", auth(), completeTask);

    const res = await app.request(
      `/tasks/${taskId}/complete`,
      jsonRequest("POST", `/tasks/${taskId}/complete`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      nextRecurringTask: { id: string; startDate: string | null; dueDate: string | null } | null;
    }>();
    expect(body.nextRecurringTask).not.toBeNull();
    expect(body.nextRecurringTask!.dueDate).not.toBeNull();
    expect(body.nextRecurringTask!.startDate).toBeNull();
  });
});
