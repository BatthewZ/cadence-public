/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for task handler functions.
 *
 * Uses a real in-memory D1 database (via Miniflare) so that handler logic —
 * including Drizzle ORM queries, fractional-index generation, activity logging,
 * and notification creation — is exercised against actual SQL. This catches
 * query-shape regressions that mocks would miss.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCommentSchema, listCommentsQuerySchema, updateCommentSchema } from "../../../shared/schemas/comment";
import { createSubtaskSchema, updateSubtaskSchema } from "../../../shared/schemas/subtask";
import {
  createTaskSchema,
  listActivityQuerySchema,
  moveTaskSchema,
  updateTaskSchema,
} from "../../../shared/schemas/task";
import type { AppEnv } from "../../env";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedComment,
  seedProject,
  seedProjectMember,
  seedSubtask,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  completeTask,
  createComment,
  createSubtask,
  createTask,
  deleteComment,
  deleteSubtask,
  deleteTask,
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

    const res = await app.request(
      `/tasks/${taskId}/move`,
      jsonRequest("PATCH", `/tasks/${taskId}/move`, {
        taskGroupId: completionGroupId,
        position: "a0",
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

    const res = await app.request(
      `/tasks/${taskId}/move`,
      jsonRequest("PATCH", `/tasks/${taskId}/move`, {
        taskGroupId: taskGroupId,
        position: "a0",
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
    const data = await res.json<{ comment: { id: string; body: string } }>();
    expect(data.comment.id).toBe(commentId);
    expect(data.comment.body).toBe("Updated body");
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

  it("does not copy cover image", async () => {
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
    const body = await res.json<{ task: { coverImageKey: string | null } }>();
    expect(body.task.coverImageKey).toBeNull();
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
