import type { Context, MiddlewareHandler } from "hono";

import type { AppEnv } from "../env";

type RateLimitOptions = {
  /** Maximum requests allowed in the window */
  max: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Optional key extractor — defaults to client IP */
  keyFn?: (c: Context) => string;
  /** Optional prefix to namespace different limiters */
  prefix?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

function getClientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function setRateLimitHeaders(
  c: Context,
  max: number,
  remaining: number,
  resetAt: number
) {
  c.header("X-RateLimit-Limit", String(max));
  c.header("X-RateLimit-Remaining", String(remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
}

export function rateLimit(
  options: RateLimitOptions
): MiddlewareHandler<AppEnv> {
  const { max, windowSeconds, prefix = "rl" } = options;
  const keyFn = options.keyFn ?? getClientIp;
  const store = new Map<string, RateLimitEntry>();
  let requestCount = 0;

  return async (c, next) => {
    const now = Date.now();
    const key = `${prefix}:${keyFn(c)}`;

    // Periodic cleanup every 100 requests
    if (++requestCount % 100 === 0) {
      for (const [k, v] of store) {
        if (v.resetAt <= now) store.delete(k);
      }
    }

    const entry = store.get(key);
    const windowMs = windowSeconds * 1000;

    if (entry && entry.resetAt > now) {
      if (entry.count >= max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        setRateLimitHeaders(c, max, 0, entry.resetAt);
        return c.json({ error: "Too many requests", retryAfter }, 429);
      }
      entry.count++;
      setRateLimitHeaders(c, max, max - entry.count, entry.resetAt);
    } else {
      const resetAt = now + windowMs;
      store.set(key, { count: 1, resetAt });
      setRateLimitHeaders(c, max, max - 1, resetAt);
    }

    await next();
  };
}
