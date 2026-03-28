import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../../env";
import { requireAuth } from "../../middleware/require-auth";
import { getMe } from "./users.handlers";

function createTestApp() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);
  app.get("/me", getMe);
  return app;
}

describe("GET /me", () => {
  it("returns 401 when no user is set in context", async () => {
    const app = createTestApp();
    const res = await app.request("/me");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns user when authenticated", async () => {
    const app = new Hono<AppEnv>();
    // Simulate auth middleware setting user
    app.use("/*", async (c, next) => {
      c.set("user", {
        id: "test-user-id",
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        image: null,
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-01"),
      });
      c.set("session", null);
      await next();
    });
    app.get("/me", getMe);

    const res = await app.request("/me");

    expect(res.status).toBe(200);
    const body = await res.json<{ user: { id: string; name: string; email: string } }>();
    expect(body.user).toMatchObject({
      id: "test-user-id",
      name: "Test User",
      email: "test@example.com",
    });
  });
});
