/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../env";
import {
  createTestD1,
  fakeAuth,
  seedProject,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../../test-utils";
import { deleteTask } from "../tasks/handlers/task-crud";
import { getWorkspaceFreshness } from "./freshness.handler";

type Freshness = {
  workspace: number | null;
  projects: number | null;
  tasks: number | null;
  projectCount: number;
  taskCount: number;
};

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let taskGroupId: string;
let app: Hono<AppEnv>;

beforeAll(async () => {
  // No edge cache outside Workers; the handler then reads D1 every time.
  vi.stubGlobal("caches", {});
  ({ d1, dispose } = await createTestD1());
  await seedUser(d1);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  await seedProject(d1, workspaceId, { name: "Second" });
  taskGroupId = await seedTaskGroup(d1, projectId);

  app = new Hono<AppEnv>();
  app.use("*", fakeAuth(d1));
  app.get("/workspaces/:workspaceId/freshness", getWorkspaceFreshness);
  app.delete("/tasks/:taskId", deleteTask);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await dispose();
});

async function freshness(): Promise<Freshness> {
  const res = await app.request(`/workspaces/${workspaceId}/freshness`);
  expect(res.status).toBe(200);
  return (await res.json<{ freshness: Freshness }>()).freshness;
}

describe("getWorkspaceFreshness", () => {
  it("counts the workspace's projects and tasks", async () => {
    await seedTask(d1, projectId, taskGroupId);

    expect(await freshness()).toMatchObject({ projectCount: 2, taskCount: 1 });
  });

  it("changes when a task is deleted, even though no updatedAt moves", async () => {
    const doomed = await seedTask(d1, projectId, taskGroupId);
    const before = await freshness();

    expect((await app.request(`/tasks/${doomed}`, { method: "DELETE" })).status).toBe(200);
    const after = await freshness();

    expect(after).not.toEqual(before);
    expect(after.taskCount).toBe(before.taskCount - 1);
  });
});
