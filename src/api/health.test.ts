import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("returns { ok: true } with status 200", async () => {
    const app = new Hono();
    app.get("/api/health", (c) => c.json({ ok: true }));

    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
