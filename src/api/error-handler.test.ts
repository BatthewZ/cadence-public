import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "./env";
import { requestIdMiddleware } from "./middleware/request-id";

describe("Global error handler", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use("*", requestIdMiddleware);

    app.onError((err, c) => {
      const requestId = c.get("requestId") ?? "unknown";

      if (err instanceof HTTPException) {
        return c.json({ error: err.message, requestId }, err.status);
      }

      return c.json({ error: "Internal Server Error", requestId }, 500);
    });

    app.get("/http-exception-403", () => {
      throw new HTTPException(403, { message: "Forbidden" });
    });

    app.get("/http-exception-400", () => {
      throw new HTTPException(400, { message: "Bad Request" });
    });

    app.get("/unexpected-error", () => {
      throw new Error("something broke");
    });

    return app;
  }

  it("returns correct status and message for HTTPException (403)", async () => {
    const app = createApp();
    const res = await app.request("/http-exception-403");

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Forbidden");
  });

  it("returns correct status and message for HTTPException (400)", async () => {
    const app = createApp();
    const res = await app.request("/http-exception-400");

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Bad Request");
  });

  it("returns 500 for unexpected errors", async () => {
    const app = createApp();
    const res = await app.request("/unexpected-error");

    expect(res.status).toBe(500);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Internal Server Error");
  });

  it("includes requestId in HTTPException responses", async () => {
    const app = createApp();
    const res = await app.request("/http-exception-403");

    const body = await res.json<{ requestId: string }>();
    expect(body.requestId).toBeDefined();
    expect(typeof body.requestId).toBe("string");
  });

  it("includes requestId in unexpected error responses", async () => {
    const app = createApp();
    const res = await app.request("/unexpected-error");

    const body = await res.json<{ requestId: string }>();
    expect(body.requestId).toBeDefined();
    expect(typeof body.requestId).toBe("string");
  });
});
