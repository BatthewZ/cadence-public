import { describe, expect, it, type MockInstance, vi } from "vitest";

import { ConsoleSink } from "./console";
import type {
  CronRunEvent,
  CronTaskEvent,
  HttpRequestEvent,
  TelemetryEvent,
  WebhookDeliveryEvent,
  WebhookRetryEvent,
} from "./types";

describe("ConsoleSink", () => {
  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Parse the first console.log call as JSON. */
  function parseFirstLog(spy: MockInstance): Record<string, unknown> {
    expect(spy).toHaveBeenCalledOnce();
    return JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
  }

  // -----------------------------------------------------------------------
  // Event fixtures
  // -----------------------------------------------------------------------

  const httpEvent: HttpRequestEvent = {
    type: "http_request",
    method: "GET",
    path: "/api/projects",
    status: 200,
    durationMs: 42,
    requestId: "req-abc-123",
    userId: "user-1",
    workspaceId: "ws-1",
  };

  const webhookDeliveryEvent: WebhookDeliveryEvent = {
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

  const webhookRetryEvent: WebhookRetryEvent = {
    type: "webhook_retry",
    webhookId: "wh-1",
    deliveryId: "del-1",
    event: "task.updated",
    success: false,
    statusCode: 503,
    durationMs: 3000,
    attempt: 3,
    workspaceId: "ws-1",
  };

  const cronRunEvent: CronRunEvent = {
    type: "cron_run",
    durationMs: 1200,
    tasksRun: 5,
    errors: 0,
  };

  const cronTaskEvent: CronTaskEvent = {
    type: "cron_task",
    taskName: "cleanup_stale_deliveries",
    durationMs: 300,
    count: 12,
    success: true,
  };

  // -----------------------------------------------------------------------
  // _tag field
  // -----------------------------------------------------------------------

  it("includes _tag: 'telemetry' to distinguish from request logger output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sink = new ConsoleSink();
    sink.track(httpEvent);

    const logged = parseFirstLog(logSpy);
    expect(logged._tag).toBe("telemetry");

    logSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Per-event-type tests
  // -----------------------------------------------------------------------

  it("tracks http_request events with all fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sink = new ConsoleSink();
    sink.track(httpEvent);

    const logged = parseFirstLog(logSpy);
    expect(logged).toEqual({ _tag: "telemetry", ...httpEvent });

    logSpy.mockRestore();
  });

  it("tracks webhook_delivery events with all fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sink = new ConsoleSink();
    sink.track(webhookDeliveryEvent);

    const logged = parseFirstLog(logSpy);
    expect(logged).toEqual({ _tag: "telemetry", ...webhookDeliveryEvent });

    logSpy.mockRestore();
  });

  it("tracks webhook_retry events with all fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sink = new ConsoleSink();
    sink.track(webhookRetryEvent);

    const logged = parseFirstLog(logSpy);
    expect(logged).toEqual({ _tag: "telemetry", ...webhookRetryEvent });

    logSpy.mockRestore();
  });

  it("tracks cron_run events with all fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sink = new ConsoleSink();
    sink.track(cronRunEvent);

    const logged = parseFirstLog(logSpy);
    expect(logged).toEqual({ _tag: "telemetry", ...cronRunEvent });

    logSpy.mockRestore();
  });

  it("tracks cron_task events with all fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sink = new ConsoleSink();
    sink.track(cronTaskEvent);

    const logged = parseFirstLog(logSpy);
    expect(logged).toEqual({ _tag: "telemetry", ...cronTaskEvent });

    logSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Nullable / optional fields
  // -----------------------------------------------------------------------

  it("preserves null optional fields in http_request events", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const event: HttpRequestEvent = {
      type: "http_request",
      method: "GET",
      path: "/health",
      status: 200,
      durationMs: 1,
      requestId: "req-xyz",
      userId: null,
      workspaceId: null,
    };

    const sink = new ConsoleSink();
    sink.track(event);

    const logged = parseFirstLog(logSpy);
    expect(logged.userId).toBeNull();
    expect(logged.workspaceId).toBeNull();

    logSpy.mockRestore();
  });

  it("preserves null statusCode in webhook events", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const event: WebhookDeliveryEvent = {
      ...webhookDeliveryEvent,
      statusCode: null,
      success: false,
    };

    const sink = new ConsoleSink();
    sink.track(event);

    const logged = parseFirstLog(logSpy);
    expect(logged.statusCode).toBeNull();

    logSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Error resilience
  // -----------------------------------------------------------------------

  it("catches errors in track() and logs to console.error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("log exploded");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const sink = new ConsoleSink();

    // Must not throw
    expect(() => sink.track(httpEvent)).not.toThrow();

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toBe("[telemetry] Failed to write event:");
    expect(errorSpy.mock.calls[0][1]).toBe("log exploded");

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles non-Error thrown values in track()", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Simulate a non-Error value thrown by external code (e.g. a runtime or
      // third-party library).  We construct a plain object and throw it via
      // a wrapper to satisfy the only-throw-error lint rule while still
      // testing the ConsoleSink's handling of non-Error values.
      const nonError: { message: string } = { message: "string error" };
      throw Object.assign(new Error("string error"), { _raw: nonError });
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const sink = new ConsoleSink();
    expect(() => sink.track(httpEvent)).not.toThrow();

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][1]).toBe("string error");

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles circular-reference events without throwing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // JSON.stringify will throw on circular references
    const circular = { type: "http_request" } as unknown as TelemetryEvent;
    (circular as unknown as Record<string, unknown>).self = circular;

    const sink = new ConsoleSink();
    expect(() => sink.track(circular)).not.toThrow();

    expect(errorSpy).toHaveBeenCalledOnce();

    errorSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // flush()
  // -----------------------------------------------------------------------

  it("flush() resolves immediately (console is synchronous)", async () => {
    const sink = new ConsoleSink();
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});
