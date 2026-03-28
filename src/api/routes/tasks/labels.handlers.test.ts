import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignLabelSchema } from "../../../shared/schemas/label";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedProject,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../../test-utils";
import { assignLabel, unassignLabel } from "./labels.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let projectId2: string;
let taskGroupId: string;
let taskId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId, { name: "Project 1" });
  projectId2 = await seedProject(d1, workspaceId, { name: "Project 2" });
  taskGroupId = await seedTaskGroup(d1, projectId);
  taskId = await seedTask(d1, projectId, taskGroupId, { title: "Test Task" });
});

afterAll(async () => {
  await dispose();
});

/** Seed a label directly in the database. */
async function seedLabel(
  d1Instance: D1Database,
  pid: string,
  name: string,
  color = "#3b82f6",
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await d1Instance
    .prepare("INSERT INTO label (id, projectId, name, color, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(id, pid, name, color, now)
    .run();
  return id;
}

function createApp() {
  const app = new Hono<AppEnv>();
  const auth = fakeAuth(d1, TEST_USER, {
    projectAccess: { role: "admin", source: "workspace" },
    currentProject: { id: projectId, workspaceId },
  });

  app.post(
    "/tasks/:taskId/labels",
    auth,
    validateBody(assignLabelSchema),
    assignLabel,
  );
  app.delete("/tasks/:taskId/labels/:labelId", auth, unassignLabel);

  return app;
}

describe("assignLabel", () => {
  it("assigns a label to a task", async () => {
    const app = createApp();
    const labelId = await seedLabel(d1, projectId, "Feature");

    const res = await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify in database
    const row = await d1
      .prepare("SELECT * FROM task_label WHERE taskId = ? AND labelId = ?")
      .bind(taskId, labelId)
      .first();
    expect(row).toBeTruthy();
  });

  it("returns 200 for duplicate assignment (idempotent)", async () => {
    const app = createApp();
    const labelId = await seedLabel(d1, projectId, "Idempotent");

    // First assignment
    await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId }),
    );

    // Second assignment (same label)
    const res = await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId }),
    );

    expect(res.status).toBe(200);
  });

  it("returns 400 for label from a different project", async () => {
    const app = createApp();
    const otherLabelId = await seedLabel(d1, projectId2, "Other Project Label");

    const res = await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId: otherLabelId }),
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent label", async () => {
    const app = createApp();
    const res = await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId: "nonexistent" }),
    );

    expect(res.status).toBe(404);
  });

  it("logs activity when label is assigned", async () => {
    const app = createApp();
    const labelId = await seedLabel(d1, projectId, "Activity Test");

    await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId }),
    );

    const activity = await d1
      .prepare(
        "SELECT * FROM task_activity WHERE taskId = ? AND action = 'label_added' ORDER BY createdAt DESC LIMIT 1",
      )
      .bind(taskId)
      .first();

    expect(activity).toBeTruthy();
    expect(activity!.newValue).toBe("Activity Test");
  });
});

describe("unassignLabel", () => {
  it("removes a label from a task", async () => {
    const app = createApp();
    const labelId = await seedLabel(d1, projectId, "Remove Me");

    // Assign first
    await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId }),
    );

    // Then unassign
    const res = await app.request(
      `/tasks/${taskId}/labels/${labelId}`,
      jsonRequest("DELETE", `/tasks/${taskId}/labels/${labelId}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify removed from database
    const row = await d1
      .prepare("SELECT * FROM task_label WHERE taskId = ? AND labelId = ?")
      .bind(taskId, labelId)
      .first();
    expect(row).toBeNull();
  });

  it("returns 404 for non-existent assignment", async () => {
    const app = createApp();
    const res = await app.request(
      `/tasks/${taskId}/labels/nonexistent`,
      jsonRequest("DELETE", `/tasks/${taskId}/labels/nonexistent`),
    );

    expect(res.status).toBe(404);
  });

  it("logs activity when label is removed", async () => {
    const app = createApp();
    const labelId = await seedLabel(d1, projectId, "Remove Activity");

    // Assign
    await app.request(
      `/tasks/${taskId}/labels`,
      jsonRequest("POST", `/tasks/${taskId}/labels`, { labelId }),
    );

    // Unassign
    await app.request(
      `/tasks/${taskId}/labels/${labelId}`,
      jsonRequest("DELETE", `/tasks/${taskId}/labels/${labelId}`),
    );

    const activity = await d1
      .prepare(
        "SELECT * FROM task_activity WHERE taskId = ? AND action = 'label_removed' ORDER BY createdAt DESC LIMIT 1",
      )
      .bind(taskId)
      .first();

    expect(activity).toBeTruthy();
    expect(activity!.newValue).toBe("Remove Activity");
  });
});
