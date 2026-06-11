import type { Context } from "hono";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiToken } from "../../db/schema";
import type { AppEnv } from "../env";
import {
  defaultRateLimitKey,
  RATE_LIMIT_DEFAULTS,
  rateLimit,
  rateLimitPatAware,
} from "./rate-limit";

function createApp(options: Parameters<typeof rateLimit>[0]) {
  const app = new Hono<AppEnv>();
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

/**
 * Build a typed-but-loosely-modeled ApiToken stub for context priming.
 *
 * Why: full ApiToken rows contain many fields irrelevant to rate-limit keying
 * (scopes, projectIds, expiry, etc.). The limiter only ever reads `id`, so we
 * mint a minimal stub and cast through `unknown` to keep the test focused.
 * The cast is acceptable because the keyFn never touches the other fields;
 * if that contract ever broadens we want the compiler to fail loudly here.
 */
function fakeToken(id: string): ApiToken {
  return { id } as unknown as ApiToken;
}

function fakeUser(id: string): NonNullable<AppEnv["Variables"]["user"]> {
  return { id } as unknown as NonNullable<AppEnv["Variables"]["user"]>;
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
    const app = new Hono<AppEnv>();
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

describe("defaultRateLimitKey", () => {
  /**
   * Build a context-shaped stub that only exposes `.get()` because that is the
   * sole surface the keyFn reads. Going through `unknown` keeps the test
   * narrowly scoped — if the keyFn ever begins to consume additional context
   * methods (e.g. headers directly), the cast will break and force us to
   * update the stub deliberately.
   */
  function buildContext(state: {
    apiToken?: ApiToken | null;
    user?: NonNullable<AppEnv["Variables"]["user"]> | null;
    cfIp?: string;
  }): Context<AppEnv> {
    const headerValue = (name: string): string | undefined => {
      if (name === "cf-connecting-ip") return state.cfIp;
      return undefined;
    };

    return {
      get(key: string) {
        if (key === "apiToken") return state.apiToken ?? undefined;
        if (key === "user") return state.user ?? undefined;
        return undefined;
      },
      req: {
        header: headerValue,
      },
    } as unknown as Context<AppEnv>;
  }

  it("returns pat:<id> when apiToken is set (even if user also present)", () => {
    const c = buildContext({
      apiToken: fakeToken("tok_123"),
      user: fakeUser("user_xyz"),
      cfIp: "9.9.9.9",
    });
    expect(defaultRateLimitKey(c)).toBe("pat:tok_123");
  });

  it("returns user:<id> when only user is set", () => {
    const c = buildContext({
      user: fakeUser("user_abc"),
      cfIp: "9.9.9.9",
    });
    expect(defaultRateLimitKey(c)).toBe("user:user_abc");
  });

  it("returns ip:<addr> when neither apiToken nor user is set", () => {
    const c = buildContext({ cfIp: "5.6.7.8" });
    expect(defaultRateLimitKey(c)).toBe("ip:5.6.7.8");
  });

  it("returns ip:unknown when no IP headers are present", () => {
    const c = buildContext({});
    expect(defaultRateLimitKey(c)).toBe("ip:unknown");
  });
});

describe("RATE_LIMIT_DEFAULTS", () => {
  it("documents PAT quota at 5x cookie quota", () => {
    // Why: the doc comment on RATE_LIMIT_DEFAULTS commits to this ratio.
    // Locking it in a test catches accidental drift between code and docs.
    expect(RATE_LIMIT_DEFAULTS.PAT_MAX).toBe(RATE_LIMIT_DEFAULTS.COOKIE_MAX * 5);
  });

  it("uses the same window for both populations by default", () => {
    expect(RATE_LIMIT_DEFAULTS.PAT_WINDOW_SECONDS).toBe(
      RATE_LIMIT_DEFAULTS.COOKIE_WINDOW_SECONDS
    );
  });
});

describe("rateLimitPatAware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mount the PAT-aware limiter behind a tiny priming middleware so each test
   * can simulate "cookie-authed request" vs "PAT-authed request" by toggling
   * which context keys are populated. Production code populates these from
   * auth.ts (Batch 3); here we wire them directly to keep the test focused on
   * the limiter's dispatch logic.
   */
  function createPatAwareApp(opts: {
    cookieMax: number;
    patMax: number;
    windowSeconds: number;
    prefix?: string;
  }) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      const tokenId = c.req.header("x-test-pat");
      const userId = c.req.header("x-test-user");
      if (tokenId) c.set("apiToken", fakeToken(tokenId));
      else c.set("apiToken", null);
      if (userId) c.set("user", fakeUser(userId));
      else c.set("user", null);
      await next();
    });
    app.use("*", rateLimitPatAware(opts));
    app.get("/test", (c) => c.json({ ok: true }));
    return app;
  }

  it("applies the cookie max when no apiToken is present", async () => {
    const app = createPatAwareApp({
      cookieMax: 2,
      patMax: 100,
      windowSeconds: 60,
    });

    const headers = { "x-test-user": "user_cookie" };

    const res1 = await app.request(req("/test", headers));
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-RateLimit-Limit")).toBe("2");

    const res2 = await app.request(req("/test", headers));
    expect(res2.status).toBe(200);

    const res3 = await app.request(req("/test", headers));
    expect(res3.status).toBe(429);
  });

  it("applies the higher PAT max when apiToken is present", async () => {
    const app = createPatAwareApp({
      cookieMax: 2,
      patMax: 5,
      windowSeconds: 60,
    });

    const headers = { "x-test-pat": "tok_machine" };

    // Issue more than the cookie max but under the PAT max — should all succeed.
    for (let i = 0; i < 5; i++) {
      const res = await app.request(req("/test", headers));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    }

    // The 6th request crosses the PAT max.
    const blocked = await app.request(req("/test", headers));
    expect(blocked.status).toBe(429);
  });

  it("tracks PAT and cookie counters independently for the same caller", async () => {
    const app = createPatAwareApp({
      cookieMax: 1,
      patMax: 1,
      windowSeconds: 60,
    });

    // Cookie request: exhausts the cookie bucket for user_shared.
    const cookieRes1 = await app.request(
      req("/test", { "x-test-user": "user_shared" })
    );
    expect(cookieRes1.status).toBe(200);

    const cookieRes2 = await app.request(
      req("/test", { "x-test-user": "user_shared" })
    );
    expect(cookieRes2.status).toBe(429);

    // A PAT-keyed request from "the same caller" must NOT be affected by the
    // cookie bucket exhaustion — they live in separate underlying limiters.
    const patRes1 = await app.request(
      req("/test", { "x-test-pat": "tok_shared" })
    );
    expect(patRes1.status).toBe(200);

    // And the PAT bucket exhausts independently.
    const patRes2 = await app.request(
      req("/test", { "x-test-pat": "tok_shared" })
    );
    expect(patRes2.status).toBe(429);
  });

  it("isolates different PATs from each other", async () => {
    const app = createPatAwareApp({
      cookieMax: 100,
      patMax: 1,
      windowSeconds: 60,
    });

    const a1 = await app.request(req("/test", { "x-test-pat": "tok_a" }));
    expect(a1.status).toBe(200);

    const a2 = await app.request(req("/test", { "x-test-pat": "tok_a" }));
    expect(a2.status).toBe(429);

    const b1 = await app.request(req("/test", { "x-test-pat": "tok_b" }));
    expect(b1.status).toBe(200);
  });
});
