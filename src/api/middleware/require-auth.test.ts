import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { requireAuth } from "./require-auth";

function createApp(options?: { setUser?: boolean; user?: unknown }) {
  const app = new Hono();

  if (options?.setUser) {
    app.use("*", async (c, next) => {
      c.set("user" as never, options.user as never);
      await next();
    });
  }

  app.use("*", requireAuth as never);
  app.get("/protected", (c) => c.json({ ok: true }));

  return app;
}

describe("requireAuth", () => {
  it("returns 401 when no user is set in context", async () => {
    const app = createApp();
    const res = await app.request("/protected");

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Unauthorized");
  });

  it("passes through when user is set in context", async () => {
    const app = createApp({
      setUser: true,
      user: { id: "1", email: "test@example.com", name: "Test" },
    });
    const res = await app.request("/protected");

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("returns 401 when user is explicitly null", async () => {
    const app = createApp({ setUser: true, user: null });
    const res = await app.request("/protected");

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Unauthorized");
  });
});
