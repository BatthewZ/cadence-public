/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for project-scoped webhook handlers.
 *
 * These tests verify that webhooks can be managed through project-scoped
 * endpoints (POST/GET/PATCH/DELETE /projects/:projectId/webhooks), ensuring
 * project admins can manage webhooks without workspace-level permissions.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebhookSchema, updateWebhookSchema } from "../../../shared/schemas/webhook";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedProject,
  seedProjectMember,
  seedUser,
  seedWebhook,
  seedWorkspace,
  TEST_USER,
} from "../../test-utils";
import {
  createProjectWebhook,
  deleteProjectWebhook,
  getProjectWebhook,
  listProjectWebhooks,
  updateProjectWebhook,
} from "./project-webhooks.handlers";

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
  projectId = await seedProject(d1, workspaceId, { name: "Webhook Test Project" });
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use(
    "/*",
    fakeAuth(d1, TEST_USER, {
      workspaceMembership: { id: "wm-proj-wh", role: "owner" },
    }),
  );
  // Simulates requireProjectRole middleware by setting currentProject
  app.use("/*", async (c, next) => {
    c.set("currentProject", { id: projectId, workspaceId });
    c.set("projectAccess", { role: "admin", source: "project" });
    await next();
  });

  app.get("/projects/:projectId/webhooks", listProjectWebhooks);
  app.post("/projects/:projectId/webhooks", validateBody(createWebhookSchema), createProjectWebhook);
  app.get("/projects/:projectId/webhooks/:webhookId", getProjectWebhook);
  app.patch("/projects/:projectId/webhooks/:webhookId", validateBody(updateWebhookSchema), updateProjectWebhook);
  app.delete("/projects/:projectId/webhooks/:webhookId", deleteProjectWebhook);

  return app;
}

// ---------------------------------------------------------------------------
// listProjectWebhooks
// ---------------------------------------------------------------------------

describe("listProjectWebhooks", () => {
  it("returns only webhooks scoped to the project", async () => {
    // Seed a project-scoped webhook and a workspace-scoped one
    await seedWebhook(d1, workspaceId, {
      id: "proj-wh-list-1",
      name: "Project Hook",
      projectId,
    });
    await seedWebhook(d1, workspaceId, {
      id: "ws-wh-list-1",
      name: "Workspace Hook",
    });

    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks`,
      jsonRequest("GET", `/projects/${projectId}/webhooks`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ webhooks: { id: string; name: string }[] }>();
    const ids = body.webhooks.map((w) => w.id);
    expect(ids).toContain("proj-wh-list-1");
    expect(ids).not.toContain("ws-wh-list-1");
  });

  it("omits the secret field from listed webhooks", async () => {
    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks`,
      jsonRequest("GET", `/projects/${projectId}/webhooks`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ webhooks: Record<string, unknown>[] }>();
    for (const wh of body.webhooks) {
      expect(wh).not.toHaveProperty("secret");
    }
  });
});

// ---------------------------------------------------------------------------
// createProjectWebhook
// ---------------------------------------------------------------------------

describe("createProjectWebhook", () => {
  it("creates a webhook scoped to the project and returns 201 with secret", async () => {
    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks`,
      jsonRequest("POST", `/projects/${projectId}/webhooks`, {
        name: "New Project Webhook",
        url: "https://example.com/hook",
        events: ["task.created"],
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ webhook: { id: string; projectId: string; secret: string } }>();
    expect(body.webhook.projectId).toBe(projectId);
    expect(body.webhook.secret).toBeTruthy();
  });

  it("rejects workspace-scoped events", async () => {
    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks`,
      jsonRequest("POST", `/projects/${projectId}/webhooks`, {
        name: "Bad Webhook",
        url: "https://example.com/hook",
        events: ["workspace.updated"],
      }),
    );

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// getProjectWebhook
// ---------------------------------------------------------------------------

describe("getProjectWebhook", () => {
  it("returns webhook detail with deliveries", async () => {
    const hook = await seedWebhook(d1, workspaceId, {
      id: "proj-wh-detail",
      name: "Detail Hook",
      projectId,
    });

    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks/${hook.id}`,
      jsonRequest("GET", `/projects/${projectId}/webhooks/${hook.id}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ webhook: { id: string; name: string }; deliveries: unknown[] }>();
    expect(body.webhook.id).toBe("proj-wh-detail");
    expect(body.webhook.name).toBe("Detail Hook");
    expect(Array.isArray(body.deliveries)).toBe(true);
  });

  it("returns 404 for a webhook from another project", async () => {
    const otherProject = await seedProject(d1, workspaceId, { name: "Other" });
    const otherHook = await seedWebhook(d1, workspaceId, {
      id: "other-proj-wh",
      name: "Other Hook",
      projectId: otherProject,
    });

    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks/${otherHook.id}`,
      jsonRequest("GET", `/projects/${projectId}/webhooks/${otherHook.id}`),
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// updateProjectWebhook
// ---------------------------------------------------------------------------

describe("updateProjectWebhook", () => {
  it("updates webhook fields", async () => {
    const hook = await seedWebhook(d1, workspaceId, {
      id: "proj-wh-update",
      name: "Before Update",
      projectId,
    });

    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks/${hook.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/webhooks/${hook.id}`, {
        name: "After Update",
        active: false,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ webhook: { name: string; active: boolean } }>();
    expect(body.webhook.name).toBe("After Update");
    expect(body.webhook.active).toBe(false);
  });

  it("rejects workspace-scoped events on update", async () => {
    const hook = await seedWebhook(d1, workspaceId, {
      id: "proj-wh-bad-update",
      name: "Bad Update",
      projectId,
    });

    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks/${hook.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/webhooks/${hook.id}`, {
        events: ["workspace.updated"],
      }),
    );

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// deleteProjectWebhook
// ---------------------------------------------------------------------------

describe("deleteProjectWebhook", () => {
  it("deletes the webhook and returns 204", async () => {
    const hook = await seedWebhook(d1, workspaceId, {
      id: "proj-wh-delete",
      name: "To Delete",
      projectId,
    });

    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks/${hook.id}`,
      jsonRequest("DELETE", `/projects/${projectId}/webhooks/${hook.id}`),
    );

    expect(res.status).toBe(204);

    // Verify it's gone
    const check = await d1
      .prepare("SELECT id FROM webhook WHERE id = ?")
      .bind(hook.id)
      .first();
    expect(check).toBeNull();
  });

  it("returns 404 for a webhook from another project", async () => {
    const otherProject = await seedProject(d1, workspaceId, { name: "Other Delete" });
    const otherHook = await seedWebhook(d1, workspaceId, {
      id: "other-proj-wh-del",
      name: "Other Delete Hook",
      projectId: otherProject,
    });

    const app = buildApp();
    const res = await app.request(
      `/projects/${projectId}/webhooks/${otherHook.id}`,
      jsonRequest("DELETE", `/projects/${projectId}/webhooks/${otherHook.id}`),
    );

    expect(res.status).toBe(404);
  });
});
