/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiToken } from "../../../db/schema";
import {
  createWebhookSchema,
  updateWebhookSchema,
} from "../../../shared/schemas/webhook";
import type { AppBindings, AppEnv } from "../../env";
import type { EmailMessage, EmailSendResult } from "../../lib/email/types";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedProject,
  seedUser,
  seedWebhook,
  seedWebhookDelivery,
  seedWorkspace,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";

// Mock the email service so we can assert that the out-of-band security
// notification is dispatched on every successful webhook creation. The
// mock must be installed BEFORE the handler module is imported (vitest
// hoists vi.mock automatically) so the handler's `createEmailService`
// call resolves to the stub.
const mockEmailSend = vi.fn<(msg: EmailMessage) => Promise<EmailSendResult>>(
  () => Promise.resolve({ id: "test-email-id" }),
);
vi.mock("../../lib/email", () => ({
  createEmailService: vi.fn(() => ({ send: mockEmailSend })),
}));

import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  testWebhook,
  updateWebhook,
} from "./webhooks.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;

/** Minimal env bindings so that c.env is defined when fakeAuth sets c.env.DB */
const env = {} as AppBindings;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// createWebhook
// ---------------------------------------------------------------------------

/**
 * Poll until a condition is true (or timeout) with short backoff.
 *
 * `deferWork` runs inline in the test env but the handler does not await
 * the resulting promise, so the email send can land any time after the
 * HTTP response resolves. Under parallel-suite load the deferred work
 * can take materially longer than a fixed `setTimeout(25)`, which made
 * the original asserts flaky. Polling lets us wait until the side-effect
 * is actually visible (or fail fast after a generous budget).
 */
async function waitFor(
  predicate: () => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 1000;
  const intervalMs = opts.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("createWebhook", () => {
  beforeEach(async () => {
    // Drain any pending deferred email work from previous tests before
    // clearing the mock. `deferWork` runs inline in the test env but the
    // promise chain is not awaited by the handler, so a previous test's
    // email can still be in-flight when the next test begins. Waiting
    // first ensures the mock count only reflects this test's activity.
    await new Promise((r) => setTimeout(r, 50));
    mockEmailSend.mockClear();
  });

  function buildApp(
    role: "owner" | "admin" | "member" = "owner",
    user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER,
    opts: { apiToken?: ApiToken | null } = {},
  ) {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, user, {
        workspaceMembership: { id: "wm-1", role },
      }),
    );
    // Provide BETTER_AUTH_URL so the email helper composes a sensible
    // settings link; without it the helper still runs but the URL is "/".
    app.use("/*", async (c, next) => {
      (c.env as Record<string, unknown>).BETTER_AUTH_URL = "https://cadence.example.com";
      if (opts.apiToken !== undefined) {
        c.set("apiToken", opts.apiToken);
      }
      await next();
    });
    app.post(
      "/workspaces/:workspaceId/webhooks",
      validateBody(createWebhookSchema),
      createWebhook,
    );
    return app;
  }

  /**
   * Build a fake PAT row so the email helper can read `token.name` when
   * deriving the `createdVia.tokenName` field.
   */
  function fakeApiToken(name: string): ApiToken {
    return {
      id: "tok_test",
      userId: TEST_USER.id,
      workspaceId,
      name,
      tokenHash: "hash-x",
      tokenPrefix: "cdn_pat_xxxx",
      scopes: JSON.stringify(["webhook:write"]),
      projectScope: "all",
      projectIds: null,
      lastUsedAt: null,
      expiresAt: null,
      revokeAt: null,
      revokedAt: null,
      rotatedToId: null,
      createdAt: new Date(),
    } as ApiToken;
  }

  it("creates a webhook successfully and returns 201 with secret", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "My Webhook",
      url: "https://hooks.example.com/receive",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(201);
    const body = await res.json<{
      webhook: {
        id: string;
        name: string;
        url: string;
        secret: string;
        events: string;
        active: boolean;
        workspaceId: string;
      };
    }>();
    expect(body.webhook).toBeDefined();
    expect(body.webhook.id).toBeTruthy();
    expect(body.webhook.name).toBe("My Webhook");
    expect(body.webhook.url).toBe("https://hooks.example.com/receive");
    // Secret should be exposed on creation
    expect(body.webhook.secret).toBeTruthy();
    expect(body.webhook.secret.length).toBe(64); // 32 bytes -> 64 hex chars
    expect(body.webhook.active).toBe(true);
    expect(body.webhook.workspaceId).toBe(workspaceId);
    // Events are stored as JSON string
    expect(JSON.parse(body.webhook.events)).toEqual(["task.created"]);
  });

  it("rejects non-HTTPS URL with 400", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "HTTP Webhook",
      url: "http://hooks.example.com/receive",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);

    // The zod schema validates https:// before the handler, so this returns 400 from validation
    expect(res.status).toBe(400);
  });

  it("rejects localhost/private IPs with 400", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "Local Webhook",
      url: "https://localhost/webhook",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("local");
  });

  it("rejects private IP ranges with 400", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "Private IP Webhook",
      url: "https://192.168.1.1/webhook",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("private");
  });

  // -------------------------------------------------------------------------
  // Out-of-band security email — every successful webhook creation must
  // send a notification to the actor so an unexpected registration is
  // visible out-of-band. Webhooks are exfiltration pipes by design, and
  // the email is the recipient's first signal that a credential they
  // hold has been used to set one up.
  // -------------------------------------------------------------------------

  it("dispatches the security notification email on successful cookie-authed creation", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "Slack alerts",
      url: "https://hooks.example.com/slack",
      events: ["task.created", "task.completed"],
    });
    const res = await app.request(req, undefined, env);
    expect(res.status).toBe(201);

    // Wait for the deferred work to settle. Polling rather than a fixed
    // sleep so we tolerate the variable scheduling delay under parallel
    // test-suite load.
    await waitFor(() => mockEmailSend.mock.calls.length >= 1);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.to).toBe(TEST_USER.email);
    expect(call.subject).toContain("webhook was created");
    expect(call.text).toContain("Slack alerts");
    expect(call.text).toContain("https://hooks.example.com/slack");
    expect(call.text).toContain("task.created");
    expect(call.text).toContain("a browser session");
  });

  it("dispatches the security email with the PAT name when created via API token", async () => {
    const app = buildApp("owner", TEST_USER, {
      apiToken: fakeApiToken("Slackbot prod"),
    });
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "Slackbot inbound sync",
      url: "https://hooks.example.com/slackbot",
      events: ["task.updated"],
    });
    const res = await app.request(req, undefined, env);
    expect(res.status).toBe(201);

    await waitFor(() => mockEmailSend.mock.calls.length >= 1);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.to).toBe(TEST_USER.email);
    // The PAT name is the high-signal triage hint — recipients can match
    // this against their integration inventory.
    expect(call.text).toContain(`API token "Slackbot prod"`);
  });

  it("does NOT dispatch the email when creation fails (URL validation)", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "Blocked",
      url: "https://localhost/exfil",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);
    // Validation rejects before the handler reaches the email path.
    expect(res.status).toBe(400);

    // Give any deferred work a generous window to NOT fire.
    await new Promise((r) => setTimeout(r, 100));
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("enforces max 20 webhooks per workspace with 409", async () => {
    // Create a dedicated workspace for the limit test
    const limitWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Limit WS",
    });

    // Seed 20 webhooks
    for (let i = 0; i < 20; i++) {
      await seedWebhook(d1, limitWsId, {
        name: `Webhook ${i}`,
        url: `https://hooks.example.com/w${i}`,
      });
    }

    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${limitWsId}/webhooks`, {
      name: "Webhook 21",
      url: "https://hooks.example.com/w21",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("Maximum");
    expect(body.error).toContain("20");
  });

  it("creates a project-scoped webhook with valid projectId", async () => {
    const projWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Proj Create WS" });
    const projId = await seedProject(d1, projWsId, { name: "Proj A" });
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${projWsId}/webhooks`, {
      name: "Project Hook",
      url: "https://hooks.example.com/proj",
      events: ["task.created"],
      projectId: projId,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(201);
    const body = await res.json<{
      webhook: { projectId: string | null };
    }>();
    expect(body.webhook.projectId).toBe(projId);
  });

  it("rejects projectId from a different workspace with 400", async () => {
    const wsA = await seedWorkspace(d1, TEST_USER.id, { name: "WS A for proj" });
    const wsB = await seedWorkspace(d1, TEST_USER.id, { name: "WS B for proj" });
    const projB = await seedProject(d1, wsB, { name: "Proj in B" });

    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${wsA}/webhooks`, {
      name: "Cross-WS Hook",
      url: "https://hooks.example.com/cross",
      events: ["task.created"],
      projectId: projB,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("Project not found");
  });

  it("rejects project-scoped webhook with workspace-scoped events", async () => {
    const projWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Proj Events WS" });
    const projId = await seedProject(d1, projWsId, { name: "Proj E" });
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${projWsId}/webhooks`, {
      name: "Bad Events Hook",
      url: "https://hooks.example.com/bad-events",
      events: ["task.created", "workspace.member_joined"],
      projectId: projId,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
  });

  it("validates required fields and returns 400 on missing name", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      url: "https://hooks.example.com/receive",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("validates required fields and returns 400 on missing url", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "No URL",
      events: ["task.created"],
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("validates required fields and returns 400 on missing events", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "No Events",
      url: "https://hooks.example.com/receive",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("validates required fields and returns 400 on empty events array", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/webhooks`, {
      name: "Empty Events",
      url: "https://hooks.example.com/receive",
      events: [],
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });
});

// ---------------------------------------------------------------------------
// listWebhooks
// ---------------------------------------------------------------------------

describe("listWebhooks", () => {
  let listWsId: string;

  beforeAll(async () => {
    listWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "List Webhooks WS",
    });
    await seedWebhook(d1, listWsId, {
      name: "Hook A",
      url: "https://a.example.com/hook",
      secret: "secret-aaa-111",
    });
    await seedWebhook(d1, listWsId, {
      name: "Hook B",
      url: "https://b.example.com/hook",
      secret: "secret-bbb-222",
    });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.get("/workspaces/:workspaceId/webhooks", listWebhooks);
    return app;
  }

  it("returns all webhooks for the workspace", async () => {
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${listWsId}/webhooks`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhooks: Array<{ name: string; url: string }>;
    }>();
    expect(body.webhooks).toHaveLength(2);
    const names = body.webhooks.map((w) => w.name).sort();
    expect(names).toEqual(["Hook A", "Hook B"]);
  });

  it("excludes secret from list response", async () => {
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${listWsId}/webhooks`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhooks: Array<Record<string, unknown>>;
    }>();
    for (const wh of body.webhooks) {
      expect(wh).not.toHaveProperty("secret");
    }
  });

  it("returns empty array when no webhooks exist", async () => {
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Empty Webhooks WS",
    });
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${emptyWsId}/webhooks`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ webhooks: Array<unknown> }>();
    expect(body.webhooks).toHaveLength(0);
  });

  it("includes projectId in list response", async () => {
    const projListWsId = await seedWorkspace(d1, TEST_USER.id, { name: "ProjList WS" });
    const projId = await seedProject(d1, projListWsId, { name: "Listed Proj" });
    await seedWebhook(d1, projListWsId, {
      name: "Proj Listed Hook",
      projectId: projId,
    });
    await seedWebhook(d1, projListWsId, {
      name: "WS Listed Hook",
    });

    const app = buildApp();
    const res = await app.request(`/workspaces/${projListWsId}/webhooks`, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhooks: Array<{ name: string; projectId: string | null }>;
    }>();
    const projHook = body.webhooks.find((w) => w.name === "Proj Listed Hook");
    const wsHook = body.webhooks.find((w) => w.name === "WS Listed Hook");
    expect(projHook?.projectId).toBe(projId);
    expect(wsHook?.projectId).toBeNull();
  });

  it("enforces cross-workspace isolation", async () => {
    // Create a different workspace with its own webhook
    const otherWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Other WS",
    });
    await seedWebhook(d1, otherWsId, {
      name: "Other Hook",
      url: "https://other.example.com/hook",
    });

    const app = buildApp();

    // List webhooks for listWsId - should NOT include otherWsId's webhook
    const res = await app.request(
      `/workspaces/${listWsId}/webhooks`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhooks: Array<{ name: string }>;
    }>();
    const names = body.webhooks.map((w) => w.name);
    expect(names).not.toContain("Other Hook");
    expect(body.webhooks).toHaveLength(2); // Only Hook A and Hook B
  });
});

// ---------------------------------------------------------------------------
// getWebhook
// ---------------------------------------------------------------------------

describe("getWebhook", () => {
  let getWsId: string;
  let webhookObj: { id: string; secret: string };

  beforeAll(async () => {
    getWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Get Webhook WS",
    });
    webhookObj = await seedWebhook(d1, getWsId, {
      name: "Detail Hook",
      url: "https://detail.example.com/hook",
      secret: "detail-secret-xyz",
    });
    // Seed some deliveries for this webhook
    await seedWebhookDelivery(d1, webhookObj.id, {
      event: "task.created",
      success: true,
      statusCode: 200,
    });
    await seedWebhookDelivery(d1, webhookObj.id, {
      event: "task.updated",
      success: false,
      statusCode: 500,
    });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.get("/workspaces/:workspaceId/webhooks/:webhookId", getWebhook);
    return app;
  }

  it("returns webhook with recent deliveries", async () => {
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${getWsId}/webhooks/${webhookObj.id}`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: { id: string; name: string };
      deliveries: Array<{ event: string; success: boolean }>;
    }>();
    expect(body.webhook).toBeDefined();
    expect(body.webhook.id).toBe(webhookObj.id);
    expect(body.webhook.name).toBe("Detail Hook");
    expect(body.deliveries).toBeDefined();
    expect(body.deliveries).toHaveLength(2);
  });

  it("excludes secret from get response", async () => {
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${getWsId}/webhooks/${webhookObj.id}`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: Record<string, unknown>;
    }>();
    expect(body.webhook).not.toHaveProperty("secret");
  });

  it("returns 404 for non-existent webhook", async () => {
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${getWsId}/webhooks/nonexistent-id`,
      undefined,
      env,
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Webhook not found");
  });

  it("returns 404 for webhook in different workspace", async () => {
    // Create a webhook in a different workspace
    const otherWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Other Get WS",
    });
    const otherHook = await seedWebhook(d1, otherWsId, {
      name: "Cross WS Hook",
    });

    const app = buildApp();
    // Try to access otherHook through getWsId — should fail
    const res = await app.request(
      `/workspaces/${getWsId}/webhooks/${otherHook.id}`,
      undefined,
      env,
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Webhook not found");
  });
});

// ---------------------------------------------------------------------------
// updateWebhook
// ---------------------------------------------------------------------------

describe("updateWebhook", () => {
  let updateWsId: string;

  beforeAll(async () => {
    updateWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Update Webhook WS",
    });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.patch(
      "/workspaces/:workspaceId/webhooks/:webhookId",
      validateBody(updateWebhookSchema),
      updateWebhook,
    );
    return app;
  }

  it("partial update — name only", async () => {
    const hook = await seedWebhook(d1, updateWsId, {
      name: "Original Name",
      url: "https://original.example.com/hook",
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { name: "Updated Name" },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: { id: string; name: string; url: string };
    }>();
    expect(body.webhook.name).toBe("Updated Name");
    // URL should remain unchanged
    expect(body.webhook.url).toBe("https://original.example.com/hook");
  });

  it("partial update — url only", async () => {
    const hook = await seedWebhook(d1, updateWsId, {
      name: "URL Update Hook",
      url: "https://old-url.example.com/hook",
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { url: "https://new-url.example.com/hook" },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: { name: string; url: string };
    }>();
    expect(body.webhook.url).toBe("https://new-url.example.com/hook");
    expect(body.webhook.name).toBe("URL Update Hook");
  });

  it("partial update — events only", async () => {
    const hook = await seedWebhook(d1, updateWsId, {
      name: "Events Update Hook",
      events: JSON.stringify(["task.created"]),
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { events: ["task.updated", "task.deleted"] },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: { events: string };
    }>();
    expect(JSON.parse(body.webhook.events)).toEqual([
      "task.updated",
      "task.deleted",
    ]);
  });

  it("re-validates URL if changed and rejects invalid URL", async () => {
    const hook = await seedWebhook(d1, updateWsId, {
      name: "Revalidate Hook",
      url: "https://valid.example.com/hook",
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { url: "https://localhost/evil" },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("local");
  });

  it("regenerates secret when requested and includes secret in response", async () => {
    const hook = await seedWebhook(d1, updateWsId, {
      name: "Regen Secret Hook",
      secret: "original-secret-value-000",
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { regenerateSecret: true },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: { id: string; secret: string };
    }>();
    // Secret should be present when regenerated
    expect(body.webhook.secret).toBeTruthy();
    expect(body.webhook.secret).not.toBe("original-secret-value-000");
    expect(body.webhook.secret.length).toBe(64); // 32 bytes hex
  });

  it("does not include secret in response when not regenerated", async () => {
    const hook = await seedWebhook(d1, updateWsId, {
      name: "No Secret Hook",
      secret: "hidden-secret-value-abc",
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { name: "Renamed Hook" },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: Record<string, unknown>;
    }>();
    expect(body.webhook).not.toHaveProperty("secret");
  });

  it("sets projectId on update", async () => {
    const projId = await seedProject(d1, updateWsId, { name: "Update Proj" });
    const hook = await seedWebhook(d1, updateWsId, {
      name: "Scope Me Hook",
      events: JSON.stringify(["task.created"]),
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { projectId: projId },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: { projectId: string | null };
    }>();
    expect(body.webhook.projectId).toBe(projId);
  });

  it("clears projectId by setting it to null", async () => {
    const projId = await seedProject(d1, updateWsId, { name: "Clear Proj" });
    const hook = await seedWebhook(d1, updateWsId, {
      name: "Unscope Me Hook",
      events: JSON.stringify(["task.created"]),
      projectId: projId,
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { projectId: null },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      webhook: { projectId: string | null };
    }>();
    expect(body.webhook.projectId).toBeNull();
  });

  it("rejects update that would add workspace-scoped events to project-scoped webhook", async () => {
    const projId = await seedProject(d1, updateWsId, { name: "Cross-val Proj" });
    const hook = await seedWebhook(d1, updateWsId, {
      name: "Cross-val Hook",
      events: JSON.stringify(["task.created"]),
      projectId: projId,
    });
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/${hook.id}`,
      { events: ["task.created", "workspace.member_joined"] },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("workspace or invitation");
  });

  it("returns 404 for non-existent webhook", async () => {
    const app = buildApp();
    const req = jsonRequest(
      "PATCH",
      `/workspaces/${updateWsId}/webhooks/nonexistent-id`,
      { name: "Ghost" },
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Webhook not found");
  });
});

// ---------------------------------------------------------------------------
// deleteWebhook
// ---------------------------------------------------------------------------

describe("deleteWebhook", () => {
  let deleteWsId: string;

  beforeAll(async () => {
    deleteWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Delete Webhook WS",
    });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.delete(
      "/workspaces/:workspaceId/webhooks/:webhookId",
      deleteWebhook,
    );
    return app;
  }

  it("deletes a webhook successfully and returns 204", async () => {
    const hook = await seedWebhook(d1, deleteWsId, {
      name: "To Delete",
    });
    const app = buildApp();
    const req = jsonRequest(
      "DELETE",
      `/workspaces/${deleteWsId}/webhooks/${hook.id}`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(204);

    // Verify webhook is actually deleted in DB
    const row = await d1
      .prepare("SELECT id FROM webhook WHERE id = ?")
      .bind(hook.id)
      .first<{ id: string }>();
    expect(row).toBeNull();
  });

  it("returns 404 for non-existent webhook", async () => {
    const app = buildApp();
    const req = jsonRequest(
      "DELETE",
      `/workspaces/${deleteWsId}/webhooks/nonexistent-id`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Webhook not found");
  });

  it("returns 404 when deleting webhook from different workspace", async () => {
    const otherWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Other Delete WS",
    });
    const hook = await seedWebhook(d1, otherWsId, {
      name: "Cross Delete Hook",
    });

    const app = buildApp();
    // Try to delete from deleteWsId but webhook belongs to otherWsId
    const req = jsonRequest(
      "DELETE",
      `/workspaces/${deleteWsId}/webhooks/${hook.id}`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Webhook not found");
  });
});

// ---------------------------------------------------------------------------
// testWebhook
// ---------------------------------------------------------------------------

describe("testWebhook", () => {
  let testWsId: string;
  beforeAll(async () => {
    testWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Test Webhook WS",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.post(
      "/workspaces/:workspaceId/webhooks/:webhookId/test",
      testWebhook,
    );
    return app;
  }

  it("returns delivery result on successful test", async () => {
    const hook = await seedWebhook(d1, testWsId, {
      name: "Test Delivery Hook",
      url: "https://hooks.example.com/test",
      secret: "test-delivery-secret-12345",
    });

    // Mock global fetch to simulate a successful webhook delivery
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("OK", { status: 200 }),
    );

    const app = buildApp();
    const req = jsonRequest(
      "POST",
      `/workspaces/${testWsId}/webhooks/${hook.id}/test`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      delivery: {
        id: string;
        success: boolean;
        statusCode: number;
        response: string;
      } | null;
    }>();
    expect(body.delivery).toBeDefined();
    expect(body.delivery).not.toBeNull();
    expect(body.delivery!.success).toBe(true);
    expect(body.delivery!.statusCode).toBe(200);
    expect(body.delivery!.response).toBe("OK");
    expect(body.delivery!.id).toBeTruthy();

    // Verify fetch was called with the webhook URL
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("https://hooks.example.com/test");
  });

  it("returns delivery result with failure status on non-2xx response", async () => {
    const hook = await seedWebhook(d1, testWsId, {
      name: "Fail Test Hook",
      url: "https://hooks.example.com/fail",
      secret: "fail-test-secret-67890",
    });

    // Mock global fetch to simulate a server error
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const app = buildApp();
    const req = jsonRequest(
      "POST",
      `/workspaces/${testWsId}/webhooks/${hook.id}/test`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{
      delivery: {
        id: string;
        success: boolean;
        statusCode: number;
        response: string;
      } | null;
    }>();
    expect(body.delivery).toBeDefined();
    expect(body.delivery).not.toBeNull();
    expect(body.delivery!.success).toBe(false);
    expect(body.delivery!.statusCode).toBe(500);
  });

  it("returns 404 for non-existent webhook", async () => {
    const app = buildApp();
    const req = jsonRequest(
      "POST",
      `/workspaces/${testWsId}/webhooks/nonexistent-id/test`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Webhook not found");
  });

  it("returns 404 for webhook in different workspace", async () => {
    const otherWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Other Test WS",
    });
    const otherHook = await seedWebhook(d1, otherWsId, {
      name: "Cross Test Hook",
    });

    const app = buildApp();
    const req = jsonRequest(
      "POST",
      `/workspaces/${testWsId}/webhooks/${otherHook.id}/test`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Webhook not found");
  });
});
