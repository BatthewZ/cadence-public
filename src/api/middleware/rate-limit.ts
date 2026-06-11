import type { Context, MiddlewareHandler } from "hono";

import type { AppEnv } from "../env";
import { errorResponse } from "../lib/error-response";

/**
 * Named defaults for rate-limit windows and quotas.
 *
 * Why: spreading magic numbers across call sites makes it hard to audit our
 * burst budgets and even harder to keep cookie- vs PAT-authenticated requests
 * coherent. Centralising the defaults gives reviewers (and the rate-limit
 * docs) a single place to discuss the policy.
 *
 * - `COOKIE_*` mirrors the historical default behaviour for human sessions.
 *   The library default below (`max: 120, windowSeconds: 60`) matches these
 *   constants so existing call sites that omit the values keep their current
 *   limits.
 * - `PAT_*` is a higher quota intended for trusted machine clients (Slackbots,
 *   GitHub Actions, internal automation). Machine clients legitimately fan
 *   out far more requests per minute than a human; per the Batch 2 plan we
 *   start at 5x the cookie ceiling.
 */
export const RATE_LIMIT_DEFAULTS = {
  COOKIE_WINDOW_SECONDS: 60,
  COOKIE_MAX: 120,
  PAT_WINDOW_SECONDS: 60,
  PAT_MAX: 600,
} as const;

type RateLimitOptions = {
  /** Maximum requests allowed in the window */
  max: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /**
   * Optional key extractor — defaults to client IP.
   *
   * Receives the typed `AppEnv` context so PAT-aware callers can reach
   * `c.get("apiToken")` and `c.get("user")` without casting.
   */
  keyFn?: (c: Context<AppEnv>) => string;
  /** Optional prefix to namespace different limiters */
  prefix?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

function getClientIp(c: Context<AppEnv>): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Standard key function that prefers PAT identity over user identity over IP.
 *
 * Why this ordering matters:
 * - A PAT is the strongest, most stable identifier the request can carry. It
 *   uniquely identifies a machine client even when the client rotates IPs
 *   (Lambda, CI runners, Slack's egress fleet, etc.) and even when multiple
 *   machine clients share an IP (NAT, corporate egress). Keying by PAT id
 *   prevents one noisy integration from starving siblings on the same IP.
 * - User id is the next-best identity — falling back here means a logged-in
 *   human's burst budget follows them across networks (laptop → mobile)
 *   instead of being shared with whoever else is behind the same gateway.
 * - IP is the last-resort key for unauthenticated traffic (sign-in, invite
 *   lookup), preserving the original behaviour for those routes.
 *
 * Use this as the default `keyFn` for routes that want PAT-aware limiting.
 */
export function defaultRateLimitKey(c: Context<AppEnv>): string {
  const token = c.get("apiToken");
  if (token) return `pat:${token.id}`;
  const user = c.get("user");
  if (user) return `user:${user.id}`;
  return `ip:${getClientIp(c)}`;
}

function setRateLimitHeaders(
  c: Context<AppEnv>,
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
        return errorResponse(c, "Too many requests", 429, { retryAfter });
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

type RateLimitPatAwareOptions = {
  /** Quota for cookie-authenticated or anonymous requests in `windowSeconds`. */
  cookieMax: number;
  /** Quota for PAT-authenticated requests in `windowSeconds`. */
  patMax: number;
  /** Shared window length applied to both branches. */
  windowSeconds: number;
  /** Optional prefix to namespace the limiter. Defaults to "rl-pat-aware". */
  prefix?: string;
};

/**
 * Convenience wrapper: applies a stricter limit for cookie/IP requests and a
 * higher limit for PAT-authenticated requests, automatically choosing based on
 * the request's auth context. Uses `defaultRateLimitKey` for cache keys.
 *
 * Why a wrapper instead of a single limiter with a dynamic `max`:
 * - The PAT and cookie populations must be tracked in separate counter spaces.
 *   If we let them share a counter, a single noisy PAT could starve human
 *   users on the same IP, and a single human burst could throttle a healthy
 *   PAT. Two underlying limiters keep the budgets independent.
 * - Each underlying limiter still uses `defaultRateLimitKey`, so the PAT
 *   counter is keyed by `pat:<id>` (one bucket per token) while the cookie
 *   counter is keyed by `user:<id>` or `ip:<…>` (one bucket per human / IP).
 *   This is the correct shape for a per-identity limiter; the dispatch only
 *   chooses which limiter to consult.
 *
 * Use this in routes that may be reached by either humans or machine clients
 * once PAT auth lands in Batch 3 — until then the PAT branch simply remains
 * dormant because nothing populates `c.get("apiToken")`.
 */
export function rateLimitPatAware(
  options: RateLimitPatAwareOptions
): MiddlewareHandler<AppEnv> {
  const { cookieMax, patMax, windowSeconds, prefix = "rl-pat-aware" } = options;

  const cookieLimiter = rateLimit({
    max: cookieMax,
    windowSeconds,
    keyFn: defaultRateLimitKey,
    prefix: `${prefix}:cookie`,
  });

  const patLimiter = rateLimit({
    max: patMax,
    windowSeconds,
    keyFn: defaultRateLimitKey,
    prefix: `${prefix}:pat`,
  });

  return async (c, next) => {
    const limiter = c.get("apiToken") ? patLimiter : cookieLimiter;
    return limiter(c, next);
  };
}
