import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimit } from "./rate-limit";

function createApp(options: Parameters<typeof rateLimit>[0]) {
  const app = new Hono();
  app.use("*", rateLimit(options));
  app.get("/test", (c) => c.json({ ok: true }));
  app.post("/test", (c) => c.json({ ok: true }));
  return app;
}

function req(
  path = "/test",
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost${path}`, { headers });
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within limit", async () => {
    const app = createApp({ max: 3, windowSeconds: 60 });

    for (let i = 0; i < 3; i++) {
      const res = await app.request(req());
      expect(res.status).toBe(200);
    }
  });

  it("blocks requests over limit with 429", async () => {
    const app = createApp({ max: 3, windowSeconds: 60 });

    for (let i = 0; i < 3; i++) {
      await app.request(req());
    }

    const res = await app.request(req());
    expect(res.status).toBe(429);

    const body = await res.json<{ error: string; retryAfter: number }>();
    expect(body.error).toBe("Too many requests");
    expect(typeof body.retryAfter).toBe("number");
  });

  it("returns correct rate limit headers on success", async () => {
    const app = createApp({ max: 5, windowSeconds: 60 });

    const res = await app.request(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("decrements remaining count on each request", async () => {
    const app = createApp({ max: 3, windowSeconds: 60 });

    const res1 = await app.request(req());
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2");

    const res2 = await app.request(req());
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1");

    const res3 = await app.request(req());
    expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("returns Retry-After header on 429", async () => {
    const app = createApp({ max: 1, windowSeconds: 60 });

    await app.request(req());
    const res = await app.request(req());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("resets after window expires", async () => {
    const app = createApp({ max: 2, windowSeconds: 10 });

    // Exhaust the limit
    await app.request(req());
    await app.request(req());

    const blocked = await app.request(req());
    expect(blocked.status).toBe(429);

    // Advance past the window
    vi.advanceTimersByTime(11_000);

    const res = await app.request(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("1");
  });

  it("isolates by client IP", async () => {
    const app = createApp({ max: 1, windowSeconds: 60 });

    const res1 = await app.request(
      req("/test", { "cf-connecting-ip": "1.1.1.1" })
    );
    expect(res1.status).toBe(200);

    // Same IP should be blocked
    const res2 = await app.request(
      req("/test", { "cf-connecting-ip": "1.1.1.1" })
    );
    expect(res2.status).toBe(429);

    // Different IP should be allowed
    const res3 = await app.request(
      req("/test", { "cf-connecting-ip": "2.2.2.2" })
    );
    expect(res3.status).toBe(200);
  });

  it("falls back to x-forwarded-for when cf-connecting-ip is missing", async () => {
    const app = createApp({ max: 1, windowSeconds: 60 });

    const res1 = await app.request(
      req("/test", { "x-forwarded-for": "3.3.3.3, 4.4.4.4" })
    );
    expect(res1.status).toBe(200);

    // Same first IP in x-forwarded-for chain should be blocked
    const res2 = await app.request(
      req("/test", { "x-forwarded-for": "3.3.3.3" })
    );
    expect(res2.status).toBe(429);
  });

  it("uses custom keyFn", async () => {
    const app = createApp({
      max: 1,
      windowSeconds: 60,
      keyFn: (c) => c.req.header("x-api-key") ?? "anon",
    });

    const res1 = await app.request(
      req("/test", { "x-api-key": "key-a" })
    );
    expect(res1.status).toBe(200);

    // Same key should be blocked
    const res2 = await app.request(
      req("/test", { "x-api-key": "key-a" })
    );
    expect(res2.status).toBe(429);

    // Different key should be allowed
    const res3 = await app.request(
      req("/test", { "x-api-key": "key-b" })
    );
    expect(res3.status).toBe(200);
  });

  it("uses prefix for namespacing", async () => {
    const app = new Hono();
    app.use("/a/*", rateLimit({ max: 1, windowSeconds: 60, prefix: "a" }));
    app.use("/b/*", rateLimit({ max: 1, windowSeconds: 60, prefix: "b" }));
    app.get("/a/test", (c) => c.json({ ok: true }));
    app.get("/b/test", (c) => c.json({ ok: true }));

    const res1 = await app.request(req("/a/test"));
    expect(res1.status).toBe(200);

    // Same prefix exhausted
    const res2 = await app.request(req("/a/test"));
    expect(res2.status).toBe(429);

    // Different prefix should be independent
    const res3 = await app.request(req("/b/test"));
    expect(res3.status).toBe(200);
  });

  it("returns 429 with remaining 0 on blocked requests", async () => {
    const app = createApp({ max: 1, windowSeconds: 60 });

    await app.request(req());
    const res = await app.request(req());

    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("1");
  });
});
