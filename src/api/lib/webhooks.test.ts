/// <reference types="@cloudflare/workers-types" />
/**
 * Comprehensive tests for the webhook dispatch engine.
 *
 * Uses a real in-memory D1 database (via Miniflare) so that every SQL query in
 * the dispatch, delivery, and retry paths is exercised against actual SQLite.
 * This is critical because the webhook engine uses raw SQL fragments
 * (json_each) and Drizzle ORM chains that mocks cannot faithfully replicate.
 *
 * Fetch calls are intercepted with `vi.spyOn(global, 'fetch')` so we can
 * verify headers, payloads, and simulate success/failure/timeout scenarios
 * without hitting real endpoints.
 */

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, type Database } from "../../db";
import { webhook, webhookDelivery } from "../../db/schema/webhook";
import {
  createTestD1,
  seedProject,
  seedUser,
  seedWebhook,
  seedWebhookDelivery,
  seedWorkspace,
  TEST_USER,
} from "../test-utils";
import {
  deliverWebhook,
  dispatchWebhookEvent,
  generateWebhookSecret,
  processWebhookRetries,
  signPayload,
  validateWebhookUrl,
} from "./webhooks";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let db: Database;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  // Seed a base workspace used by tests that need no webhooks
  await seedWorkspace(d1, TEST_USER.id);
});

afterAll(async () => {
  await dispose();
});

beforeEach(() => {
  db = createDb(d1);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: awaitable ExecutionContext mock
// ---------------------------------------------------------------------------

/**
 * Creates an ExecutionContext whose waitUntil promises can be flushed
 * so tests can await delivery completion before asserting DB state.
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
    flush: () => Promise.all(promises),
  };
}

// ---------------------------------------------------------------------------
// generateWebhookSecret
// ---------------------------------------------------------------------------

describe("generateWebhookSecret", () => {
  it("returns a 64-character hex string", () => {
    const secret = generateWebhookSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns unique values on each call", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// validateWebhookUrl
// ---------------------------------------------------------------------------

describe("validateWebhookUrl", () => {
  /** Asserts the result is invalid and returns the narrowed type for further checks. */
  function expectInvalid(result: ReturnType<typeof validateWebhookUrl>): { valid: false; error: string } {
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected invalid result");
    return result;
  }

  it("accepts valid HTTPS URLs", () => {
    const result = validateWebhookUrl("https://example.com/webhook");
    expect(result).toEqual({ valid: true });
  });

  it("accepts HTTPS URLs with paths and ports", () => {
    const result = validateWebhookUrl("https://hooks.example.com:8443/v1/ingest");
    expect(result).toEqual({ valid: true });
  });

  it("rejects HTTP URLs", () => {
    const result = expectInvalid(validateWebhookUrl("http://example.com/webhook"));
    expect(result.error).toContain("HTTPS");
  });

  it("rejects localhost hostname", () => {
    const result = expectInvalid(validateWebhookUrl("https://localhost/webhook"));
    expect(result.error).toContain("local");
  });

  it("rejects 127.0.0.1", () => {
    const result = expectInvalid(validateWebhookUrl("https://127.0.0.1/webhook"));
    expect(result.error).toContain("local");
  });

  it("rejects [::1] (IPv6 loopback)", () => {
    const result = expectInvalid(validateWebhookUrl("https://[::1]/webhook"));
    expect(result.error).toContain("local");
  });

  it("rejects private IP 10.0.0.1", () => {
    const result = expectInvalid(validateWebhookUrl("https://10.0.0.1/webhook"));
    expect(result.error).toContain("private");
  });

  it("rejects private IP 172.16.0.1", () => {
    const result = expectInvalid(validateWebhookUrl("https://172.16.0.1/webhook"));
    expect(result.error).toContain("private");
  });

  it("rejects private IP 192.168.1.1", () => {
    const result = expectInvalid(validateWebhookUrl("https://192.168.1.1/webhook"));
    expect(result.error).toContain("private");
  });

  it("rejects cloud metadata IP 169.254.169.254", () => {
    const result = expectInvalid(validateWebhookUrl("https://169.254.169.254/latest/meta-data/"));
    expect(result.error).toContain("private");
  });

  it("rejects 0.0.0.0", () => {
    const result = expectInvalid(validateWebhookUrl("https://0.0.0.0/webhook"));
    expect(result.error).toContain("local");
  });

  it("rejects .local domains (mDNS)", () => {
    const result = expectInvalid(validateWebhookUrl("https://myprinter.local/webhook"));
    expect(result.error).toContain(".local");
  });

  it("rejects invalid URL strings", () => {
    const result = expectInvalid(validateWebhookUrl("not-a-url"));
    expect(result.error).toContain("Invalid URL");
  });

  it("rejects empty string", () => {
    const result = expectInvalid(validateWebhookUrl(""));
    expect(result.error).toContain("Invalid URL");
  });
});

// ---------------------------------------------------------------------------
// signPayload
// ---------------------------------------------------------------------------

describe("signPayload", () => {
  it("produces a valid hex string", async () => {
    const sig = await signPayload('{"test":true}', "my-secret");
    expect(sig).toMatch(/^[0-9a-f]+$/);
    // HMAC-SHA256 produces 32 bytes = 64 hex chars
    expect(sig).toHaveLength(64);
  });

  it("same input produces same signature (deterministic)", async () => {
    const payload = '{"event":"task.created"}';
    const secret = "deterministic-secret";
    const sig1 = await signPayload(payload, secret);
    const sig2 = await signPayload(payload, secret);
    expect(sig1).toBe(sig2);
  });

  it("different payloads produce different signatures", async () => {
    const secret = "shared-secret";
    const sig1 = await signPayload('{"a":1}', secret);
    const sig2 = await signPayload('{"a":2}', secret);
    expect(sig1).not.toBe(sig2);
  });

  it("different secrets produce different signatures", async () => {
    const payload = '{"data":"same"}';
    const sig1 = await signPayload(payload, "secret-one");
    const sig2 = await signPayload(payload, "secret-two");
    expect(sig1).not.toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// dispatchWebhookEvent
// ---------------------------------------------------------------------------

describe("dispatchWebhookEvent", () => {
  it("returns 0 and does not call fetch when no active webhooks exist", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx } = createAwaitableExecutionCtx();

    // Use a workspace with no webhooks seeded
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Empty WS" });
    const count = await dispatchWebhookEvent(db, ctx, emptyWsId, "task.created", { test: true });

    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatches to an active webhook subscribed to the event", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Dispatch WS" });
    await seedWebhook(d1, ws, {
      url: "https://hooks.example.com/endpoint",
      events: JSON.stringify(["task.created", "task.updated"]),
      active: true,
    });

    const count = await dispatchWebhookEvent(db, ctx, ws, "task.created", { title: "New Task" });
    await flush();

    expect(count).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://hooks.example.com/endpoint");
    expect((calledInit as RequestInit).method).toBe("POST");
  });

  it("returns 0 when active webhook is NOT subscribed to the event", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "No Match WS" });
    await seedWebhook(d1, ws, {
      events: JSON.stringify(["project.created"]),
      active: true,
    });

    const count = await dispatchWebhookEvent(db, ctx, ws, "task.created", { test: true });
    await flush();

    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 0 for inactive webhooks", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Inactive WS" });
    await seedWebhook(d1, ws, {
      events: JSON.stringify(["task.created"]),
      active: false,
    });

    const count = await dispatchWebhookEvent(db, ctx, ws, "task.created", { test: true });
    await flush();

    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Project-scoped webhook filtering
  // -------------------------------------------------------------------------

  it("project-scoped webhook receives events from its project", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "ProjScope Match WS" });
    const projectId = await seedProject(d1, ws, { name: "Match Proj" });
    await seedWebhook(d1, ws, {
      url: "https://proj-match.example.com/hook",
      events: JSON.stringify(["task.created"]),
      active: true,
      projectId,
    });

    const count = await dispatchWebhookEvent(db, ctx, ws, "task.created", { title: "Test" }, projectId);
    await flush();

    expect(count).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("project-scoped webhook ignores events from other projects", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "ProjScope Diff WS" });
    const projA = await seedProject(d1, ws, { name: "Proj A" });
    const projB = await seedProject(d1, ws, { name: "Proj B" });
    await seedWebhook(d1, ws, {
      url: "https://proj-diff.example.com/hook",
      events: JSON.stringify(["task.created"]),
      active: true,
      projectId: projA,
    });

    const count = await dispatchWebhookEvent(db, ctx, ws, "task.created", { title: "Test" }, projB);
    await flush();

    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("project-scoped webhook ignores workspace-scoped events (no projectId in dispatch)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "ProjScope WS-Event WS" });
    const projId = await seedProject(d1, ws, { name: "WS Event Proj" });
    await seedWebhook(d1, ws, {
      url: "https://proj-ws-event.example.com/hook",
      events: JSON.stringify(["workspace.member_joined"]),
      active: true,
      projectId: projId,
    });

    // Dispatch without projectId (workspace-scoped event)
    const count = await dispatchWebhookEvent(db, ctx, ws, "workspace.member_joined", { userId: "u1" });
    await flush();

    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("workspace-level webhook still receives all events (backward compat)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "WS-Level Compat WS" });
    await seedWebhook(d1, ws, {
      url: "https://ws-level.example.com/hook",
      events: JSON.stringify(["task.created", "workspace.member_joined"]),
      active: true,
      // No projectId — workspace-level
    });

    // Project-scoped event should reach it
    const count1 = await dispatchWebhookEvent(db, ctx, ws, "task.created", { title: "Test" }, "some-proj");
    await flush();
    expect(count1).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockClear();

    // Workspace-scoped event should also reach it
    const { ctx: ctx2, flush: flush2 } = createAwaitableExecutionCtx();
    const count2 = await dispatchWebhookEvent(db, ctx2, ws, "workspace.member_joined", { userId: "u2" });
    await flush2();
    expect(count2).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("mixed: workspace + project-scoped webhooks filter correctly", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Mixed Scope WS" });
    const projX = await seedProject(d1, ws, { name: "Proj X" });
    // Workspace-level webhook
    await seedWebhook(d1, ws, {
      name: "WS Hook",
      url: "https://mixed-ws.example.com/hook",
      events: JSON.stringify(["task.created"]),
      active: true,
    });
    // Project-scoped webhook for projX
    await seedWebhook(d1, ws, {
      name: "Proj Hook",
      url: "https://mixed-proj.example.com/hook",
      events: JSON.stringify(["task.created"]),
      active: true,
      projectId: projX,
    });

    // Event from projX should reach both webhooks
    const count = await dispatchWebhookEvent(db, ctx, ws, "task.created", { title: "Mixed" }, projX);
    await flush();
    expect(count).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("dispatches to multiple matching webhooks and returns correct count", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
    const { ctx, flush } = createAwaitableExecutionCtx();

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Multi WS" });
    await seedWebhook(d1, ws, {
      name: "Hook A",
      url: "https://a.example.com/hook",
      events: JSON.stringify(["task.created"]),
      active: true,
    });
    await seedWebhook(d1, ws, {
      name: "Hook B",
      url: "https://b.example.com/hook",
      events: JSON.stringify(["task.created", "task.deleted"]),
      active: true,
    });
    await seedWebhook(d1, ws, {
      name: "Hook C (inactive)",
      url: "https://c.example.com/hook",
      events: JSON.stringify(["task.created"]),
      active: false,
    });

    const count = await dispatchWebhookEvent(db, ctx, ws, "task.created", { title: "Multi" });
    await flush();

    expect(count).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// deliverWebhook
// ---------------------------------------------------------------------------

describe("deliverWebhook", () => {
  it("records successful delivery and resets consecutiveFailures", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Deliver OK WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://success.example.com/hook",
      secret: "deliver-secret-ok",
      events: JSON.stringify(["task.created"]),
      consecutiveFailures: 3,
    });

    const webhookRow = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    const deliveryId = crypto.randomUUID();
    await deliverWebhook(db, webhookRow, deliveryId, "task.created", { title: "Test" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify delivery record
    const delivery = await db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.id, deliveryId))
      .then((rows) => rows[0]);

    expect(delivery).toBeDefined();
    expect(delivery.success).toBe(true);
    expect(delivery.statusCode).toBe(200);
    expect(delivery.attempts).toBe(1);
    expect(delivery.nextRetryAt).toBeNull();

    // Verify consecutive failures reset
    const updatedHook = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    expect(updatedHook.consecutiveFailures).toBe(0);
  });

  it("records failed delivery with nextRetryAt when fetch returns 500", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Deliver Fail WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://fail.example.com/hook",
      secret: "deliver-secret-fail",
      events: JSON.stringify(["task.created"]),
      consecutiveFailures: 0,
    });

    const webhookRow = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    const deliveryId = crypto.randomUUID();
    await deliverWebhook(db, webhookRow, deliveryId, "task.created", { title: "Fail" });

    const delivery = await db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.id, deliveryId))
      .then((rows) => rows[0]);

    expect(delivery).toBeDefined();
    expect(delivery.success).toBe(false);
    expect(delivery.statusCode).toBe(500);
    expect(delivery.attempts).toBe(1);
    // Attempt 1 failed, next is attempt 2 with 60s backoff
    expect(delivery.nextRetryAt).not.toBeNull();

    // Verify consecutive failures incremented
    const updatedHook = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    expect(updatedHook.consecutiveFailures).toBe(1);
  });

  it("records failed delivery when fetch throws (timeout/network error)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("The operation was aborted"));

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Deliver Timeout WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://timeout.example.com/hook",
      secret: "deliver-secret-timeout",
      events: JSON.stringify(["task.created"]),
      consecutiveFailures: 0,
    });

    const webhookRow = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    const deliveryId = crypto.randomUUID();
    await deliverWebhook(db, webhookRow, deliveryId, "task.created", { title: "Timeout" });

    const delivery = await db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.id, deliveryId))
      .then((rows) => rows[0]);

    expect(delivery).toBeDefined();
    expect(delivery.success).toBe(false);
    expect(delivery.statusCode).toBeNull();
    expect(delivery.response).toContain("aborted");
    expect(delivery.nextRetryAt).not.toBeNull();
  });

  it("auto-disables webhook after 10 consecutive failures", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Auto Disable WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://broken.example.com/hook",
      secret: "deliver-secret-disable",
      events: JSON.stringify(["task.created"]),
      active: true,
      consecutiveFailures: 9, // One more failure will hit the threshold of 10
    });

    const webhookRow = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    const deliveryId = crypto.randomUUID();
    await deliverWebhook(db, webhookRow, deliveryId, "task.created", { title: "Disable" });

    const updatedHook = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    expect(updatedHook.active).toBe(false);
    expect(updatedHook.consecutiveFailures).toBe(10);
  });

  it("sends correct webhook headers", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Headers WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://headers.example.com/hook",
      secret: "header-test-secret",
      events: JSON.stringify(["task.created"]),
    });

    const webhookRow = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    const deliveryId = "test-delivery-id-for-headers";
    await deliverWebhook(db, webhookRow, deliveryId, "task.created", { title: "Headers" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, calledInit] = fetchSpy.mock.calls[0];
    const headers = (calledInit as RequestInit).headers as Record<string, string>;

    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Webhook-Event"]).toBe("task.created");
    expect(headers["X-Webhook-Delivery-Id"]).toBe(deliveryId);
    expect(headers["User-Agent"]).toBe("Cadence-Webhooks/1.0");

    // Signature should be in sha256=<hex> format
    expect(headers["X-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    // Timestamp should be a numeric string (Unix seconds)
    expect(headers["X-Webhook-Timestamp"]).toMatch(/^\d+$/);
  });

  it("includes delivery ID in the payload body envelope", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Envelope WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://envelope.example.com/hook",
      secret: "envelope-secret",
      events: JSON.stringify(["task.created"]),
    });

    const webhookRow = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, hook.id))
      .then((rows) => rows[0]);

    const deliveryId = "envelope-delivery-id";
    await deliverWebhook(db, webhookRow, deliveryId, "task.created", { title: "Envelope Test" });

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as string;
    const parsed = JSON.parse(body) as Record<string, unknown>;

    expect(parsed.id).toBe(deliveryId);
    expect(parsed.title).toBe("Envelope Test");
  });
});

// ---------------------------------------------------------------------------
// processWebhookRetries
// ---------------------------------------------------------------------------

describe("processWebhookRetries", () => {
  it("returns 0 when no pending retries exist", async () => {
    // The base workspaceId has no deliveries needing retry
    const count = await processWebhookRetries(db);
    expect(count).toBe(0);
  });

  it("processes eligible retries and returns count", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Retry OK WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://retry-ok.example.com/hook",
      secret: "retry-secret-ok",
      events: JSON.stringify(["task.created"]),
      active: true,
      consecutiveFailures: 1,
    });

    // Seed a failed delivery whose nextRetryAt is in the past
    const pastRetryAt = new Date(Date.now() - 120_000); // 2 minutes ago
    const delivery = await seedWebhookDelivery(d1, hook.id, {
      event: "task.created",
      payload: JSON.stringify({ id: "retry-delivery", title: "Retry Me" }),
      statusCode: 500,
      response: "error",
      success: false,
      attempts: 1,
      maxAttempts: 5,
      nextRetryAt: pastRetryAt,
    });

    const count = await processWebhookRetries(db);

    expect(count).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).toHaveBeenCalled();

    // Verify the delivery was updated (since fetch returns 200, success should be true)
    const updatedDelivery = await db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.id, delivery.id))
      .then((rows) => rows[0]);

    expect(updatedDelivery.success).toBe(true);
    expect(updatedDelivery.attempts).toBe(2);
    expect(updatedDelivery.nextRetryAt).toBeNull();
  });

  it("skips inactive webhooks and clears their retry marker", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Retry Inactive WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://retry-inactive.example.com/hook",
      secret: "retry-secret-inactive",
      events: JSON.stringify(["task.created"]),
      active: false,
      consecutiveFailures: 5,
    });

    const pastRetryAt = new Date(Date.now() - 120_000);
    const delivery = await seedWebhookDelivery(d1, hook.id, {
      event: "task.created",
      payload: JSON.stringify({ id: "skip-delivery", title: "Skip" }),
      statusCode: 500,
      response: "error",
      success: false,
      attempts: 1,
      maxAttempts: 5,
      nextRetryAt: pastRetryAt,
    });

    const count = await processWebhookRetries(db);

    // Inactive webhook deliveries are skipped (not counted as processed)
    expect(count).toBe(0);
    // fetch should NOT have been called for this delivery
    // (other pending retries from previous tests may cause calls, so check this delivery specifically)
    const updatedDelivery = await db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.id, delivery.id))
      .then((rows) => rows[0]);

    // nextRetryAt should be cleared so it is not picked up again
    expect(updatedDelivery.nextRetryAt).toBeNull();
    // Still marked as failed
    expect(updatedDelivery.success).toBe(false);
  });

  it("respects the batch limit of 50", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));

    const ws = await seedWorkspace(d1, TEST_USER.id, { name: "Batch Limit WS" });
    const hook = await seedWebhook(d1, ws, {
      url: "https://batch.example.com/hook",
      secret: "batch-secret",
      events: JSON.stringify(["task.created"]),
      active: true,
      consecutiveFailures: 0,
    });

    // Seed 60 failed deliveries all eligible for retry
    const pastRetryAt = new Date(Date.now() - 120_000);
    for (let i = 0; i < 60; i++) {
      await seedWebhookDelivery(d1, hook.id, {
        event: "task.created",
        payload: JSON.stringify({ id: `batch-${i}`, index: i }),
        statusCode: 500,
        response: "error",
        success: false,
        attempts: 1,
        maxAttempts: 5,
        nextRetryAt: pastRetryAt,
      });
    }

    const count = await processWebhookRetries(db);

    // Should process at most 50 (RETRY_BATCH_LIMIT)
    expect(count).toBeLessThanOrEqual(50);
    // And at least some were processed
    expect(count).toBeGreaterThan(0);
  });
});
