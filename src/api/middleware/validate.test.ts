import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { validateBody, validateQuery } from "./validate";

interface ValidationErrorBody {
  error: string;
  details: Array<{ path: string; message: string }>;
}

interface SuccessBody<T = unknown> {
  ok: boolean;
  data: T;
}

function createApp() {
  const app = new Hono();

  const bodySchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  const nestedSchema = z.object({
    user: z.object({
      name: z.string(),
      address: z.object({
        city: z.string(),
      }),
    }),
  });

  const querySchema = z.object({
    page: z.string(),
    limit: z.string(),
  });

  const coerceSchema = z.object({
    page: z.coerce.number(),
    active: z.coerce.boolean(),
  });

  app.post("/body", validateBody(bodySchema), (c) => {
    const data = c.req.valid("json" as never);
    return c.json({ ok: true, data });
  });

  app.post("/nested", validateBody(nestedSchema), (c) => {
    const data = c.req.valid("json" as never);
    return c.json({ ok: true, data });
  });

  app.get("/query", validateQuery(querySchema), (c) => {
    const data = c.req.valid("query" as never);
    return c.json({ ok: true, data });
  });

  app.get("/coerce", validateQuery(coerceSchema), (c) => {
    const data = c.req.valid("query" as never);
    return c.json({ ok: true, data });
  });

  return app;
}

describe("validateBody", () => {
  it("passes valid JSON body through", async () => {
    const app = createApp();
    const res = await app.request("/body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", age: 30 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json<SuccessBody<{ name: string; age: number }>>();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ name: "Alice", age: 30 });
  });

  it("rejects invalid body with 400", async () => {
    const app = createApp();
    const res = await app.request("/body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json<ValidationErrorBody>();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeInstanceOf(Array);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("returns correct detail format with path and message", async () => {
    const app = createApp();
    const res = await app.request("/body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json<ValidationErrorBody>();

    for (const detail of body.details) {
      expect(typeof detail.path).toBe("string");
      expect(typeof detail.message).toBe("string");
    }
  });

  it("handles nested object validation with dot-joined paths", async () => {
    const app = createApp();
    const res = await app.request("/nested", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { name: "Alice", address: {} } }),
    });

    expect(res.status).toBe(400);
    const body = await res.json<ValidationErrorBody>();
    const cityError = body.details.find(
      (d) => d.path === "user.address.city"
    );
    expect(cityError).toBeDefined();
    expect(typeof cityError?.message).toBe("string");
  });

  it("handles multiple validation errors", async () => {
    const app = createApp();
    const res = await app.request("/body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json<ValidationErrorBody>();
    expect(body.details.length).toBeGreaterThanOrEqual(2);

    const paths = body.details.map((d) => d.path);
    expect(paths).toContain("name");
    expect(paths).toContain("age");
  });
});

describe("validateQuery", () => {
  it("passes valid query params through", async () => {
    const app = createApp();
    const res = await app.request("/query?page=1&limit=10");

    expect(res.status).toBe(200);
    const body = await res.json<SuccessBody<{ page: string; limit: string }>>();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ page: "1", limit: "10" });
  });

  it("rejects invalid query params with 400", async () => {
    const app = createApp();
    const res = await app.request("/query?page=1");

    expect(res.status).toBe(400);
    const body = await res.json<ValidationErrorBody>();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeInstanceOf(Array);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("coerces query string types when schema uses coerce", async () => {
    const app = createApp();
    const res = await app.request("/coerce?page=5&active=true");

    expect(res.status).toBe(200);
    const body = await res.json<SuccessBody<{ page: number; active: boolean }>>();
    expect(body.ok).toBe(true);
    expect(body.data.page).toBe(5);
    expect(body.data.active).toBe(true);
  });
});
