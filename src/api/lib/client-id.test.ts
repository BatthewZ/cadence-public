/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WRITE_ERROR_CODES } from "../../shared/constants/offline-sync";
import type { AppEnv } from "../env";
import projectRoutes from "../routes/projects/projects.routes";
import taskGroupRoutes from "../routes/task-groups/task-groups.routes";
import taskRoutes from "../routes/tasks/tasks.routes";
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
  TEST_USER,
} from "../test-utils";

let d1: D1Database;
let dispose: () => Promise<void>;
let projectId: string;
let otherProjectId: string;
let taskGroupId: string;
let taskId: string;
let app: Hono<AppEnv>;

beforeAll(async () => {
  ({ d1, dispose } = await createTestD1());
  await seedUser(d1);
  const workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  otherProjectId = await seedProject(d1, workspaceId, { name: "Other" });
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  await seedProjectMember(d1, otherProjectId, TEST_USER.id, "admin");
  taskGroupId = await seedTaskGroup(d1, projectId);
  taskId = await seedTask(d1, projectId, taskGroupId);

  app = new Hono<AppEnv>();
  app.use("/api/*", fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm", workspaceId, role: "owner" } }));
  app.route("/api", projectRoutes);
  app.route("/api", taskGroupRoutes);
  app.route("/api", taskRoutes);
});

afterAll(async () => {
  await dispose();
});

type CreateCase = {
  name: string;
  path: () => string;
  body: () => Record<string, unknown>;
  responseKey: string;
  /** A path in a different project, to prove the id check is global. */
  otherPath?: () => string;
};

const cases: CreateCase[] = [
  {
    name: "task",
    path: () => `/api/projects/${projectId}/tasks`,
    body: () => ({ title: "Client id task", taskGroupId }),
    responseKey: "task",
  },
  {
    name: "subtask",
    path: () => `/api/tasks/${taskId}/subtasks`,
    body: () => ({ title: "Client id subtask" }),
    responseKey: "subtask",
  },
  {
    name: "comment",
    path: () => `/api/tasks/${taskId}/comments`,
    body: () => ({ body: "Client id comment" }),
    responseKey: "comment",
  },
  {
    name: "task group",
    path: () => `/api/projects/${projectId}/task-groups`,
    body: () => ({ name: "Client id group" }),
    responseKey: "taskGroup",
    otherPath: () => `/api/projects/${otherProjectId}/task-groups`,
  },
  {
    name: "label",
    path: () => `/api/projects/${projectId}/labels`,
    body: () => ({ name: `L${crypto.randomUUID().slice(0, 8)}`, color: "#ef4444" }),
    responseKey: "label",
    otherPath: () => `/api/projects/${otherProjectId}/labels`,
  },
  {
    name: "saved view",
    path: () => `/api/projects/${projectId}/views`,
    body: () => ({ name: `V${crypto.randomUUID().slice(0, 8)}`, state: { tab: "board", params: {} } }),
    responseKey: "view",
    otherPath: () => `/api/projects/${otherProjectId}/views`,
  },
];

async function create(path: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(jsonRequest("POST", path, body));
}

describe.each(cases)("client-supplied id on $name create", ({ path, body, responseKey, otherPath }) => {
  it("uses the supplied id", async () => {
    const id = crypto.randomUUID();
    const res = await create(path(), { ...body(), id });

    expect(res.status).toBe(201);
    const json = await res.json<Record<string, { id: string }>>();
    expect(json[responseKey].id).toBe(id);
  });

  it("generates an id when none is supplied", async () => {
    const res = await create(path(), body());

    expect(res.status).toBe(201);
    const json = await res.json<Record<string, { id: string }>>();
    expect(json[responseKey].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers 409 id_conflict when the id already exists", async () => {
    const id = crypto.randomUUID();
    expect((await create(path(), { ...body(), id })).status).toBe(201);

    const res = await create((otherPath ?? path)(), { ...body(), id });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: WRITE_ERROR_CODES.idConflict });
  });

  it("rejects an id that is not a UUID", async () => {
    const res = await create(path(), { ...body(), id: "not-a-uuid" });
    expect(res.status).toBe(400);
  });
});
