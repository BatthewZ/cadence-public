import { describe, expect, it } from "vitest";

import { NoopSink } from "./noop";
import type {
  CronRunEvent,
  CronTaskEvent,
  HttpRequestEvent,
  WebhookDeliveryEvent,
  WebhookRetryEvent,
} from "./types";

describe("NoopSink", () => {
  // ---------------------------------------------------------------------------
  // track() — must silently accept every event variant without throwing
  // ---------------------------------------------------------------------------

  it("accepts an http_request event without throwing", () => {
    const sink = new NoopSink();
    const event: HttpRequestEvent = {
      type: "http_request",
      method: "GET",
      path: "/api/projects",
      status: 200,
      durationMs: 42,
      requestId: "req-1",
      userId: "user-1",
      workspaceId: "ws-1",
    };
    expect(() => sink.track(event)).not.toThrow();
  });

  it("accepts an http_request event with nullable fields set to null", () => {
    const sink = new NoopSink();
    const event: HttpRequestEvent = {
      type: "http_request",
      method: "POST",
      path: "/api/tasks",
      status: 401,
      durationMs: 5,
      requestId: "req-2",
      userId: null,
      workspaceId: null,
    };
    expect(() => sink.track(event)).not.toThrow();
  });

  it("accepts a webhook_delivery event without throwing", () => {
    const sink = new NoopSink();
    const event: WebhookDeliveryEvent = {
      type: "webhook_delivery",
      webhookId: "wh-1",
      deliveryId: "del-1",
      event: "task.created",
      success: true,
      statusCode: 200,
      durationMs: 150,
      attempt: 1,
      workspaceId: "ws-1",
    };
    expect(() => sink.track(event)).not.toThrow();
  });

  it("accepts a webhook_retry event without throwing", () => {
    const sink = new NoopSink();
    const event: WebhookRetryEvent = {
      type: "webhook_retry",
      webhookId: "wh-2",
      deliveryId: "del-2",
      event: "task.updated",
      success: false,
      statusCode: null,
      durationMs: 3000,
      attempt: 3,
      workspaceId: "ws-2",
    };
    expect(() => sink.track(event)).not.toThrow();
  });

  it("accepts a cron_run event without throwing", () => {
    const sink = new NoopSink();
    const event: CronRunEvent = {
      type: "cron_run",
      durationMs: 800,
      tasksRun: 4,
      errors: 0,
    };
    expect(() => sink.track(event)).not.toThrow();
  });

  it("accepts a cron_task event without throwing", () => {
    const sink = new NoopSink();
    const event: CronTaskEvent = {
      type: "cron_task",
      taskName: "cleanup_stale_deliveries",
      durationMs: 200,
      count: 12,
      success: true,
    };
    expect(() => sink.track(event)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // flush() — must resolve without error
  // ---------------------------------------------------------------------------

  it("flush() resolves without error", async () => {
    const sink = new NoopSink();
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // General contract
  // ---------------------------------------------------------------------------

  it("returns undefined from track()", () => {
    const sink = new NoopSink();
    const result = sink.track({
      type: "http_request",
      method: "GET",
      path: "/",
      status: 200,
      durationMs: 1,
      requestId: "req-0",
    });
    expect(result).toBeUndefined();
  });

  it("can be called multiple times without accumulating state", async () => {
    const sink = new NoopSink();
    for (let i = 0; i < 100; i++) {
      sink.track({
        type: "cron_run",
        durationMs: i,
        tasksRun: 1,
        errors: 0,
      });
    }
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});
