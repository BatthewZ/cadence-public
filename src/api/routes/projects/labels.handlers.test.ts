import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLabelSchema, updateLabelSchema } from "../../../shared/schemas/label";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedProject,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../../test-utils";
import { createLabel, deleteLabel, listLabels, updateLabel } from "./labels.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
});

afterAll(async () => {
  await dispose();
});

function createApp() {
  const app = new Hono<AppEnv>();
  const auth = fakeAuth(d1, TEST_USER, {
    projectAccess: { role: "admin", source: "workspace" },
    currentProject: { id: projectId, workspaceId },
  });

  app.post(
    "/projects/:projectId/labels",
    auth,
    validateBody(createLabelSchema),
    createLabel,
  );
  app.get("/projects/:projectId/labels", auth, listLabels);
  app.patch(
    "/projects/:projectId/labels/:labelId",
    auth,
    validateBody(updateLabelSchema),
    updateLabel,
  );
  app.delete("/projects/:projectId/labels/:labelId", auth, deleteLabel);

  return app;
}

describe("createLabel", () => {
  it("creates a label with valid name and color", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Bug",
        color: "#ef4444",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ label: { id: string; name: string; color: string } }>();
    expect(body.label.name).toBe("Bug");
    expect(body.label.color).toBe("#ef4444");
  });

  it("returns 409 for duplicate label name (case-insensitive)", async () => {
    const app = createApp();

    // Create first
    await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Duplicate Test",
        color: "#3b82f6",
      }),
    );

    // Try duplicate
    const res = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "duplicate test",
        color: "#ef4444",
      }),
    );

    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid color format", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Invalid Color",
        color: "red",
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("listLabels", () => {
  it("returns labels with task counts sorted by name", async () => {
    const app = createApp();
    const res = await app.request(`/projects/${projectId}/labels`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      labels: Array<{ id: string; name: string; color: string; taskCount: number }>;
    }>();
    expect(Array.isArray(body.labels)).toBe(true);

    // Labels should be sorted by name
    const names = body.labels.map((l) => l.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("updateLabel", () => {
  it("updates label name", async () => {
    const app = createApp();

    // Create a label first
    const createRes = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Update Me",
        color: "#22c55e",
      }),
    );
    const { label: created } = await createRes.json<{ label: { id: string } }>();

    // Update it
    const res = await app.request(
      `/projects/${projectId}/labels/${created.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/${created.id}`, {
        name: "Updated Name",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ label: { name: string } }>();
    expect(body.label.name).toBe("Updated Name");
  });

  it("updates label color", async () => {
    const app = createApp();

    // Create a label
    const createRes = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Color Update",
        color: "#3b82f6",
      }),
    );
    const { label: created } = await createRes.json<{ label: { id: string } }>();

    // Update color
    const res = await app.request(
      `/projects/${projectId}/labels/${created.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/${created.id}`, {
        color: "#ef4444",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ label: { color: string } }>();
    expect(body.label.color).toBe("#ef4444");
  });

  it("returns 409 when updating to a duplicate name", async () => {
    const app = createApp();

    // Create two labels
    await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Label A",
        color: "#3b82f6",
      }),
    );
    const createRes2 = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Label B",
        color: "#ef4444",
      }),
    );
    const { label: labelB } = await createRes2.json<{ label: { id: string } }>();

    // Try to rename B to A
    const res = await app.request(
      `/projects/${projectId}/labels/${labelB.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/${labelB.id}`, {
        name: "Label A",
      }),
    );

    expect(res.status).toBe(409);
  });

  it("returns 404 for non-existent label", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels/nonexistent`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/nonexistent`, {
        name: "New Name",
      }),
    );

    expect(res.status).toBe(404);
  });
});

describe("deleteLabel", () => {
  it("deletes an existing label", async () => {
    const app = createApp();

    // Create a label
    const createRes = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Delete Me",
        color: "#6b7280",
      }),
    );
    const { label: created } = await createRes.json<{ label: { id: string } }>();

    // Delete it
    const res = await app.request(
      `/projects/${projectId}/labels/${created.id}`,
      jsonRequest("DELETE", `/projects/${projectId}/labels/${created.id}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; deletedId: string }>();
    expect(body.ok).toBe(true);
    expect(body.deletedId).toBe(created.id);

    // Verify it's gone
    const row = await d1.prepare("SELECT id FROM label WHERE id = ?").bind(created.id).first();
    expect(row).toBeNull();
  });

  it("returns 404 for non-existent label", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels/nonexistent`,
      jsonRequest("DELETE", `/projects/${projectId}/labels/nonexistent`),
    );

    expect(res.status).toBe(404);
  });
});
