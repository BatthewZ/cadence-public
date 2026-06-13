/**
 * Route registrations for the calendar feature: the public ICS feed endpoint
 * and the cookie-only feed-management surface.
 *
 * ## Why the feed route is a plain Hono registration (not `createRoute`)
 *
 * `GET /calendar/feed/:token` is a capability URL whose path segment IS the
 * credential. Documenting it in the OpenAPI spec would invite Scalar users to
 * paste live feed tokens into a "Try it" box (and into Scalar's request
 * history) — exactly the secret-handling pattern the separate `cdn_cal_`
 * credential class exists to avoid. Calendar clients discover the URL from
 * the management surface's mint response, never from API docs, so the spec
 * entry would have no legitimate consumer. It also carries no `requireAuth`:
 * calendar providers cannot send headers, so token-in-path is the only
 * possible auth and the handler does its own verification.
 *
 * ## Management surface middleware chain (mirrors the PAT surface)
 *
 * Mount order matters — see `baseMiddleware` below. The chain is copied from
 * [api-tokens.routes.ts](../workspaces/api-tokens.routes.ts) because the two
 * surfaces share a threat model: both mint long-lived credentials, so both
 * must be unreachable via PAT auth and uncacheable by intermediaries.
 *
 * OpenAPI schemas for this surface are defined inline here (not in
 * `shared/schemas/openapi-responses.ts`) — the shapes are consumed only by
 * these three routes and the settings UI, so co-locating them keeps the
 * schema next to the only registration that uses it.
 */

import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { AppEnv } from "../../env";
import { rejectPatAuth, requireWorkspaceMember } from "../../middleware/authorize";
import { noStoreCacheControl } from "../../middleware/cache-control";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validationHook } from "../../middleware/validate";
import {
  createCalendarFeed,
  deleteCalendarFeed,
  getCalendarFeed,
  getCalendarFeedStatus,
} from "./calendar.handlers";

/**
 * Bridge between Hono's wide `Context<AppEnv>` handler return type and the
 * narrow `RouteHandler<R, AppEnv>` that `app.openapi()` expects. Same
 * pattern as the other OpenAPI route files.
 */
function asRouteHandler<R extends RouteConfig>(
  fn: (c: Context<AppEnv>) => unknown,
): RouteHandler<R, AppEnv> {
  return fn as unknown as RouteHandler<R, AppEnv>;
}

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------

/**
 * Feed-endpoint limiter, keyed by the token path segment.
 *
 * Why token (not IP) is the primary key: calendar providers fetch feeds from
 * large rotating egress fleets (Google Calendar alone refreshes from many
 * IPs), so an IP key would both fragment one subscriber's budget across
 * buckets and let one noisy provider IP starve unrelated users' feeds.
 * Keying by token gives each feed URL a stable budget regardless of who
 * fetches it. Brute-force concerns do not change the calculus: tokens carry
 * 256 bits of CSPRNG entropy behind a cheap prefix-reject and a uniform 404,
 * so guessing is computationally irrelevant with or without IP limiting.
 *
 * The `.ics` suffix is stripped so `…/feed/<token>` and `…/feed/<token>.ics`
 * share one bucket — they are the same credential.
 *
 * Requests without a token param (cannot happen on this route, but keyFn
 * must be total) fall back to `defaultRateLimitKey` (user, then IP).
 */
const feedRateLimit = rateLimit({
  max: 30,
  windowSeconds: 60,
  prefix: "calendar-feed",
  keyFn: (c) => {
    const token = c.req.param("token");
    if (!token) return defaultRateLimitKey(c);
    return `feed:${token.endsWith(".ics") ? token.slice(0, -".ics".length) : token}`;
  },
});

/**
 * Per-user limiter for the management surface. Mint/revoke are sensitive
 * lifecycle actions never issued in bursts by legitimate UI traffic; 20/min
 * matches the PAT-management budget so both credential surfaces share one
 * auditable policy. `defaultRateLimitKey` resolves to `user:<id>` here —
 * the only callers that reach the limiter are cookie-authenticated (PAT
 * callers are rejected earlier in the chain).
 */
const feedMgmtRateLimit = rateLimit({
  max: 20,
  windowSeconds: 60,
  prefix: "calendar-feed-mgmt",
  keyFn: defaultRateLimitKey,
});

// ---------------------------------------------------------------------------
// Management-surface middleware + OpenAPI plumbing
// ---------------------------------------------------------------------------

/**
 * Mount order matters (mirrors the PAT management surface):
 *  1. `requireAuth` — establishes identity.
 *  2. `rejectPatAuth()` — a leaked PAT must not be able to mint a calendar
 *     feed (a second, independently-revocable credential) for its user.
 *  3. `requireWorkspaceMember()` — caller belongs to the workspace in the URL.
 *  4. `feedMgmtRateLimit` — caps issuance rate per user.
 *  5. `noStoreCacheControl()` — the mint response contains the one-time feed
 *     URL (a live credential); status responses contain usage telemetry.
 *     Neither may ever sit in a shared cache.
 */
const baseMiddleware = [
  requireAuth,
  rejectPatAuth(),
  requireWorkspaceMember(),
  feedMgmtRateLimit,
  noStoreCacheControl(),
];

/**
 * PAT (`bearerAuth`) callers are rejected at runtime by `rejectPatAuth()`,
 * so the spec advertises `cookieAuth` only — advertising bearer here would
 * mislead Scalar users into a guaranteed 403. Same reasoning as the PAT
 * management surface.
 */
const security: Array<Record<string, string[]>> = [{ cookieAuth: [] }];

const workspaceIdParam = z.object({
  workspaceId: z.string().openapi({
    param: { name: "workspaceId", in: "path" },
    description: "Workspace UUID",
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
});

const calendarErrorSchema = z.object({
  error: z.string().openapi({ example: "Forbidden" }),
  requestId: z.string().openapi({ example: "req_abc123" }),
});

const unauthorizedResponse = {
  content: { "application/json": { schema: calendarErrorSchema } },
  description: "Authentication required",
} as const;

const forbiddenResponse = {
  content: { "application/json": { schema: calendarErrorSchema } },
  description:
    "Caller is not a member of the workspace, or is PAT-authenticated. PAT callers always receive 403 on this surface — use session authentication.",
} as const;

const calendarFeedStatusResponseSchema = z.object({
  exists: z.boolean().openapi({
    description: "Whether the calling user has a live feed for this workspace.",
    example: true,
  }),
  createdAt: z
    .string()
    .nullable()
    .openapi({
      description:
        "When the current feed token was minted (ISO 8601), or null when no feed exists. Reset on regenerate.",
      example: "2026-06-01T12:00:00.000Z",
    }),
  lastUsedAt: z
    .string()
    .nullable()
    .openapi({
      description:
        "When a calendar client last fetched the feed (ISO 8601), or null if never fetched / no feed exists.",
      example: "2026-06-11T08:30:00.000Z",
    }),
});

const createCalendarFeedResponseSchema = z.object({
  url: z.string().openapi({
    description:
      "Absolute ICS subscription URL containing the feed token. Returned exactly once — the server stores only a hash. Regenerating replaces the token and kills this URL instantly.",
    example:
      "https://cadence.example.com/api/calendar/feed/cdn_cal_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  }),
});

const deleteCalendarFeedResponseSchema = z.object({
  ok: z.boolean().openapi({ example: true }),
});

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const getCalendarFeedStatusRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/calendar-feed",
  tags: ["Calendar"],
  summary: "Get calendar feed status",
  description:
    "Reports whether the calling user has an ICS feed for this workspace, with mint and last-fetch timestamps. The feed URL itself is never returned here — it is shown exactly once at mint time. Lost the URL? Regenerate.",
  security,
  middleware: baseMiddleware,
  request: { params: workspaceIdParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: calendarFeedStatusResponseSchema },
      },
      description: "Feed status for the calling user in this workspace",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const createCalendarFeedRoute = createRoute({
  method: "post",
  path: "/workspaces/{workspaceId}/calendar-feed",
  tags: ["Calendar"],
  summary: "Create or regenerate the calendar feed",
  description:
    "Mints a personal ICS subscription URL for the calling user in this workspace (one feed per user per workspace). If a feed already exists it is replaced atomically — the old URL stops working immediately. The returned URL contains the secret token and is shown **only** in this response.",
  security,
  middleware: baseMiddleware,
  request: { params: workspaceIdParam },
  responses: {
    201: {
      content: {
        "application/json": { schema: createCalendarFeedResponseSchema },
      },
      description:
        "Feed minted. `url` is the secret subscription URL — paste it into a calendar client now; it cannot be retrieved again.",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const deleteCalendarFeedRoute = createRoute({
  method: "delete",
  path: "/workspaces/{workspaceId}/calendar-feed",
  tags: ["Calendar"],
  summary: "Revoke the calendar feed",
  description:
    "Deletes the calling user's feed token for this workspace. Any calendar client subscribed to the old URL starts receiving 404s on its next refresh. Idempotent — revoking an already-revoked feed still returns `ok: true`.",
  security,
  middleware: baseMiddleware,
  request: { params: workspaceIdParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: deleteCalendarFeedResponseSchema },
      },
      description: "Feed revoked (or no feed existed)",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

// Public ICS feed — token-in-path auth, verified inside the handler. See the
// module JSDoc for why this is intentionally NOT an OpenAPI-documented route
// and carries no `requireAuth`.
app.get("/calendar/feed/:token", feedRateLimit, getCalendarFeed);

app.openapi(
  getCalendarFeedStatusRoute,
  asRouteHandler<typeof getCalendarFeedStatusRoute>(getCalendarFeedStatus),
);
app.openapi(
  createCalendarFeedRoute,
  asRouteHandler<typeof createCalendarFeedRoute>(createCalendarFeed),
);
app.openapi(
  deleteCalendarFeedRoute,
  asRouteHandler<typeof deleteCalendarFeedRoute>(deleteCalendarFeed),
);

export default app;
