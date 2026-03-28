import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "./env";
import { requestIdMiddleware } from "./middleware/request-id";

describe("API 404 handler", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use("/api/*", requestIdMiddleware);
    app.get("/api/health", (c) => c.json({ ok: true }));
    app.all("/api/*", (c) => {
      const requestId = c.get("requestId") ?? "unknown";
      return c.json({ error: "Not Found", requestId }, 404);
    });
    return app;
  }

  it("returns JSON 404 for undefined API routes", async () => {
    const app = createApp();
    const res = await app.request("/api/nonexistent");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json<{ error: string; requestId: string }>();
    expect(body.error).toBe("Not Found");
    expect(body.requestId).toBeDefined();
  });

  it("still serves defined API routes normally", async () => {
    const app = createApp();
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json<{ ok: boolean }>()).toEqual({ ok: true });
  });

  it("returns 404 for different HTTP methods", async () => {
    const app = createApp();
    const res = await app.request("/api/nonexistent", { method: "POST" });

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Not Found");
  });
});
