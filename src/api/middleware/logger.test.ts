import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { requestLogger } from "./logger";

interface LogEntry {
  method: string;
  path: string;
  status: number;
  duration: number;
  userAgent: string | null;
  ip: string | null;
}

describe("requestLogger", () => {
  it("logs method, path, status, and duration as JSON", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", requestLogger);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as LogEntry;
    expect(logged.method).toBe("GET");
    expect(logged.path).toBe("/test");
    expect(logged.status).toBe(200);
    expect(typeof logged.duration).toBe("number");
    expect(logged.duration).toBeGreaterThanOrEqual(0);

    logSpy.mockRestore();
  });

  it("logs POST requests correctly", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", requestLogger);
    app.post("/submit", (c) => c.json({ created: true }, 201));

    const req = new Request("http://localhost/submit", { method: "POST" });
    await app.request(req);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as LogEntry;
    expect(logged.method).toBe("POST");
    expect(logged.path).toBe("/submit");
    expect(logged.status).toBe(201);

    logSpy.mockRestore();
  });

  it("includes user-agent when present", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", requestLogger);
    app.get("/test", (c) => c.json({ ok: true }));

    const req = new Request("http://localhost/test", {
      headers: { "User-Agent": "TestAgent/1.0" },
    });
    await app.request(req);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as LogEntry;
    expect(logged.userAgent).toBe("TestAgent/1.0");

    logSpy.mockRestore();
  });

  it("truncates user-agent to 128 characters", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", requestLogger);
    app.get("/test", (c) => c.json({ ok: true }));

    const longUA = "A".repeat(200);
    const req = new Request("http://localhost/test", {
      headers: { "User-Agent": longUA },
    });
    await app.request(req);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as LogEntry;
    expect(logged.userAgent).toBe("A".repeat(128));

    logSpy.mockRestore();
  });

  it("sets ip and userAgent to null when headers are missing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", requestLogger);
    app.get("/test", (c) => c.json({ ok: true }));

    const req = new Request("http://localhost/test");
    // Remove the default user-agent if any
    req.headers.delete("user-agent");
    await app.request(req);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as LogEntry;
    expect(logged.ip).toBeNull();

    logSpy.mockRestore();
  });

  it("includes cf-connecting-ip when present", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", requestLogger);
    app.get("/test", (c) => c.json({ ok: true }));

    const req = new Request("http://localhost/test", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    await app.request(req);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as LogEntry;
    expect(logged.ip).toBe("1.2.3.4");

    logSpy.mockRestore();
  });

  it("logs error responses from downstream handlers", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", requestLogger);
    app.onError((_err, c) => c.json({ error: "fail" }, 500));
    app.get("/error", () => {
      throw new Error("boom");
    });

    await app.request("/error");

    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as LogEntry;
    expect(logged.method).toBe("GET");
    expect(logged.path).toBe("/error");
    expect(logged.status).toBe(500);

    logSpy.mockRestore();
  });
});
