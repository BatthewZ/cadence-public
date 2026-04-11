import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TelemetryEvent, TelemetrySink } from "../lib/telemetry";

vi.mock("../lib/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/telemetry")>();
  return {
    ...actual,
    createTelemetrySink: vi.fn(),
  };
});

import { createTelemetrySink } from "../lib/telemetry";
import { telemetryMiddleware } from "./telemetry";

const mockCreateTelemetrySink = vi.mocked(createTelemetrySink);

function createMockSink() {
  return {
    track: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

describe("telemetryMiddleware", () => {
  let mockSink: ReturnType<typeof createMockSink>;

  beforeEach(() => {
    mockSink = createMockSink();
    mockCreateTelemetrySink.mockReset();
    mockCreateTelemetrySink.mockReturnValue(mockSink);
  });

  it("sets the telemetry sink on context so downstream handlers can access it", async () => {
    let capturedSink: TelemetrySink | undefined;

    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.get("/test", (c) => {
      capturedSink = c.get("telemetry" as never) as TelemetrySink | undefined;
      return c.json({ ok: true });
    });

    await app.request("/test");

    expect(capturedSink).toBe(mockSink);
  });

  it("tracks an http_request event with correct method, path, and status", async () => {
    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.get("/api/tasks", (c) => c.json({ tasks: [] }));

    await app.request("/api/tasks");

    expect(mockSink.track).toHaveBeenCalledOnce();
    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent;
    expect(event).toMatchObject({
      type: "http_request",
      method: "GET",
      path: "/api/tasks",
      status: 200,
    });
  });

  it("tracks POST requests with non-200 status codes", async () => {
    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.post("/api/projects", (c) => c.json({ id: "p1" }, 201));

    const req = new Request("http://localhost/api/projects", { method: "POST" });
    await app.request(req);

    expect(mockSink.track).toHaveBeenCalledOnce();
    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent;
    expect(event).toMatchObject({
      type: "http_request",
      method: "POST",
      path: "/api/projects",
      status: 201,
    });
  });

  it("records a non-negative duration in milliseconds", async () => {
    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent & { durationMs: number };
    expect(typeof event.durationMs).toBe("number");
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes requestId from upstream middleware", async () => {
    const app = new Hono();
    // Simulate requestId middleware setting the value before telemetry runs
    app.use("*", async (c, next) => {
      c.set("requestId" as never, "req-abc-123");
      await next();
    });
    app.use("*", telemetryMiddleware as never);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent & { requestId: string };
    expect(event.requestId).toBe("req-abc-123");
  });

  it("falls back to 'unknown' requestId when no upstream middleware sets it", async () => {
    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent & { requestId: string };
    expect(event.requestId).toBe("unknown");
  });

  it("sets userId and workspaceId to null when no auth context is present", async () => {
    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent & {
      userId: string | null;
      workspaceId: string | null;
    };
    expect(event.userId).toBeNull();
    expect(event.workspaceId).toBeNull();
  });

  it("includes userId and workspaceId when auth context is set", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as never, { id: "user-42" });
      c.set("workspaceMembership" as never, { id: "m1", workspaceId: "ws-7", role: "owner" });
      await next();
    });
    app.use("*", telemetryMiddleware as never);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent & {
      userId: string | null;
      workspaceId: string | null;
    };
    expect(event.userId).toBe("user-42");
    expect(event.workspaceId).toBe("ws-7");
  });

  it("tracks error responses from downstream handlers", async () => {
    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.onError((_err, c) => c.json({ error: "fail" }, 500));
    app.get("/error", () => {
      throw new Error("boom");
    });

    await app.request("/error");

    expect(mockSink.track).toHaveBeenCalledOnce();
    const event = mockSink.track.mock.calls[0][0] as TelemetryEvent;
    expect(event).toMatchObject({
      type: "http_request",
      method: "GET",
      path: "/error",
      status: 500,
    });
  });

  it("calls createTelemetrySink with the request env", async () => {
    const app = new Hono();
    app.use("*", telemetryMiddleware as never);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    expect(mockCreateTelemetrySink).toHaveBeenCalledOnce();
  });
});
