import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "./env";
import { requestIdMiddleware } from "./middleware/request-id";

describe("Global error handler", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use("*", requestIdMiddleware);

    app.onError((err, c) => {
      const requestId = c.get("requestId") ?? "unknown";

      return c.json({ error: "Internal Server Error", requestId }, 500);
    });

    app.get("/unexpected-error", () => {
      throw new Error("something broke");
    });

    return app;
  }

  it("returns 500 for unexpected errors", async () => {
    const app = createApp();
    const res = await app.request("/unexpected-error");

    expect(res.status).toBe(500);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Internal Server Error");
  });

  it("includes requestId in unexpected error responses", async () => {
    const app = createApp();
    const res = await app.request("/unexpected-error");

    const body = await res.json<{ requestId: string }>();
    expect(body.requestId).toBeDefined();
    expect(typeof body.requestId).toBe("string");
  });
});
