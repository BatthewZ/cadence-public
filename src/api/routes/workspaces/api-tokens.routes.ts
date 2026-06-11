/**
 * Route registrations for the Personal Access Token (PAT) management
 * surface. Kept in its own file because the token surface has a meaningful
 * amount of zod validation and lifecycle handlers, and inlining it into
 * `workspaces.routes.ts` would blur the per-resource route boundaries that
 * the rest of the workspaces module follows.
 *
 * Mount point: `/api/workspaces/:workspaceId/api-tokens`.
 *
 * Why these routes live under the workspaces module rather than as a
 * top-level `/api/api-tokens` group: tokens are workspace-scoped credentials
 * (per the design doc) and every middleware below the cookie-auth boundary
 * — membership, audit, scoped activity — keys off the workspace id from the
 * URL. Keeping the prefix consistent with the resource ownership model means
 * we never have to invent a parallel auth path.
 *
 * ## OpenAPI surface
 *
 * Every endpoint here is registered via `OpenAPIHono.openapi(...)` so it
 * appears in the spec at `/api/openapi.json` and renders in Scalar. The
 * `security` array lists both `bearerAuth` and `cookieAuth` to advertise
 * the auth methods, but at runtime the handlers also reject any PAT-
 * authenticated caller with 403 (`rejectPatCaller`). Documenting both auth
 * schemes is intentional — clients should still see that the cookie route
 * works for these endpoints even though the same Authorize button drives
 * other endpoints in the spec.
 */

import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  createApiTokenRequestSchema,
  createApiTokenResponseSchema,
  getApiTokenResponseSchema,
  listApiTokensResponseSchema,
  revokeApiTokenResponseSchema,
  rotateApiTokenResponseSchema,
} from "../../../shared/schemas/openapi-responses";
import type { AppEnv } from "../../env";
import { rejectPatAuth, requireWorkspaceMember } from "../../middleware/authorize";
import { noStoreCacheControl } from "../../middleware/cache-control";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validationHook } from "../../middleware/validate";
import {
  createApiToken,
  getApiToken,
  listApiTokens,
  listApiTokensQuerySchema,
  revokeApiToken,
  rotateApiToken,
} from "./api-tokens.handlers";

/**
 * Bridge between Hono's wide `Context<AppEnv>` handler return type and the
 * narrow `RouteHandler<R, AppEnv>` that `app.openapi()` expects.
 */
function asRouteHandler<R extends RouteConfig>(
  fn: (c: Context<AppEnv>) => unknown,
): RouteHandler<R, AppEnv> {
  return fn as unknown as RouteHandler<R, AppEnv>;
}

// ---------------------------------------------------------------------------
// Shared param + response definitions
// ---------------------------------------------------------------------------

const workspaceIdParam = z.object({
  workspaceId: z.string().openapi({
    param: { name: "workspaceId", in: "path" },
    description: "Workspace UUID",
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
});

const tokenIdParams = workspaceIdParam.extend({
  tokenId: z.string().openapi({
    param: { name: "tokenId", in: "path" },
    description: "API token ID (ULID)",
  }),
});

const unauthorizedResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Authentication required",
} as const;

const forbiddenResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description:
    "Caller cannot manage this token. PAT-authenticated callers always receive 403 on this surface — use session authentication.",
} as const;

const notFoundResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Token not found, or not visible to the caller.",
} as const;

const validationFailedResponse = {
  content: { "application/json": { schema: apiValidationErrorResponseSchema } },
  description: "Validation failed",
} as const;

/**
 * PAT (`bearerAuth`) callers are rejected at the middleware layer for every
 * route on this management surface — see `rejectPatAuth()` in
 * [authorize.ts](../../middleware/authorize.ts). Advertising `bearerAuth` here
 * would mislead Scalar users into pasting a PAT into the Authorize dialog and
 * receiving a 403 the docs said wouldn't happen, so the spec restricts these
 * operations to `cookieAuth` only. The root-level spec in
 * [routes/index.ts](../index.ts) still advertises both schemes, so every
 * *other* documented operation continues to accept either.
 */
const security: Array<Record<string, string[]>> = [{ cookieAuth: [] }];

/**
 * Per-user rate limit for the PAT management surface. Lower than the
 * default API limit because mint / rotate / revoke are sensitive lifecycle
 * actions that should never be issued in bursts by legitimate UI traffic
 * — and the email side-effects of mint and rotate make burst issuance an
 * abuse vector.
 *
 * The key function uses `defaultRateLimitKey`, which falls through to
 * `user:<id>` for cookie-authenticated callers (the only auth that
 * reaches these handlers — PAT callers are rejected at the middleware
 * level below). One bucket per authenticated user means a single user
 * cannot exhaust the budget for the rest of the workspace.
 */
const tokenMgmtRateLimit = rateLimit({
  max: 20,
  windowSeconds: 60,
  prefix: "api-token-mgmt",
  keyFn: defaultRateLimitKey,
});

/**
 * Mount order matters:
 *   1. `requireAuth` — establishes the caller's identity from session/PAT.
 *   2. `rejectPatAuth()` — IMMEDIATELY blocks PAT-authenticated callers.
 *      A leaked PAT must not be able to mint siblings or enumerate
 *      tokens, and the lockout must run before any other middleware
 *      consults the request. See [authorize.ts](../../middleware/authorize.ts).
 *   3. `requireWorkspaceMember()` — verifies the caller belongs to the
 *      workspace named in the URL.
 *   4. `tokenMgmtRateLimit` — caps the issuance rate.
 *   5. `noStoreCacheControl()` — token metadata (prefix, scopes, last-used
 *      timestamps) must never sit in a shared cache, even though the
 *      hash never leaves the DB. Pre-empting any future misconfigured
 *      intermediary CDN is cheap defense-in-depth.
 */
const baseMiddleware = [
  requireAuth,
  rejectPatAuth(),
  requireWorkspaceMember(),
  tokenMgmtRateLimit,
  noStoreCacheControl(),
];

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

/**
 * Query parameters for the list endpoint. Wired through OpenAPI so the
 * generated spec / Scalar docs surface the toggle, and so the `validQuery`
 * extractor in the handler sees pre-parsed data.
 */
const listApiTokensQueryParams = listApiTokensQuerySchema.extend({
  includeRevoked: listApiTokensQuerySchema.shape.includeRevoked.openapi({
    param: { name: "includeRevoked", in: "query" },
    description:
      "When `true`, include soft-revoked tokens in the response. Omitted or `false` (the default) hides revoked rows. Revoked tokens are kept in the database indefinitely for audit attribution, but excluded from listings by default so the workspace settings UI does not grow unboundedly over time.",
  }),
});

const listApiTokensRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/api-tokens",
  tags: ["API Tokens"],
  summary: "List API tokens",
  description:
    "Members see their own tokens; workspace owners and admins additionally see every member's tokens for incident response. Revoked tokens are hidden by default — pass `?includeRevoked=true` to include them (used by the settings UI's \"Show revoked\" toggle). `tokenHash` is never returned, and plaintext is unavailable once minted — list responses contain only the `tokenPrefix` for UI display.",
  security,
  middleware: baseMiddleware,
  request: {
    params: workspaceIdParam,
    query: listApiTokensQueryParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: listApiTokensResponseSchema } },
      description: "Tokens visible to the caller",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const createApiTokenRoute = createRoute({
  method: "post",
  path: "/workspaces/{workspaceId}/api-tokens",
  tags: ["API Tokens"],
  summary: "Mint a new API token",
  description:
    "Generates a Personal Access Token. The plaintext is returned **only** in this response; the server stores nothing more than `sha256(plaintext)` afterwards. A non-blocking creation-notification email is dispatched to the owner. Defaults: `expiresInDays = 365`, `projectScope = all` (must be supplied by the caller).",
  security,
  middleware: baseMiddleware,
  request: {
    params: workspaceIdParam,
    body: {
      content: { "application/json": { schema: createApiTokenRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: createApiTokenResponseSchema } },
      description:
        "Token minted. `token.plaintext` is the secret — store it immediately, it cannot be retrieved again.",
    },
    400: validationFailedResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const getApiTokenRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/api-tokens/{tokenId}",
  tags: ["API Tokens"],
  summary: "Get an API token",
  description:
    "Owner sees their token; workspace admins see any token. Non-owners receive 404.",
  security,
  middleware: baseMiddleware,
  request: {
    params: tokenIdParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: getApiTokenResponseSchema } },
      description: "Token details (no plaintext)",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

const rotateApiTokenRoute = createRoute({
  method: "post",
  path: "/workspaces/{workspaceId}/api-tokens/{tokenId}/rotate",
  tags: ["API Tokens"],
  summary: "Rotate an API token",
  description:
    "Mints a sibling that inherits the original's scopes, project scope, and absolute `expiresAt`. The old token enters a 7-day grace window (`revokeAt = now + 7d`) before the scheduled handler finalises revocation. Owner-only.",
  security,
  middleware: baseMiddleware,
  request: {
    params: tokenIdParams,
  },
  responses: {
    201: {
      content: { "application/json": { schema: rotateApiTokenResponseSchema } },
      description:
        "New token minted. `token.plaintext` is the secret for the new sibling — store it immediately.",
    },
    401: unauthorizedResponse,
    403: {
      content: { "application/json": { schema: apiErrorResponseSchema } },
      description: "Only the token owner can rotate; PAT-authenticated callers cannot manage tokens",
    },
    404: notFoundResponse,
    409: {
      content: { "application/json": { schema: apiErrorResponseSchema } },
      description: "Token is already revoked or already rotating",
    },
  },
});

const revokeApiTokenRoute = createRoute({
  method: "delete",
  path: "/workspaces/{workspaceId}/api-tokens/{tokenId}",
  tags: ["API Tokens"],
  summary: "Revoke an API token",
  description:
    "Soft-revoke: sets `revokedAt = now` without deleting the row so historical activity attribution survives. Owner or any workspace admin/owner can revoke. Idempotent on already-revoked tokens (200 with `alreadyRevoked: true`).",
  security,
  middleware: baseMiddleware,
  request: {
    params: tokenIdParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: revokeApiTokenResponseSchema } },
      description: "Token revoked (or already-revoked)",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

app.openapi(listApiTokensRoute, asRouteHandler<typeof listApiTokensRoute>(listApiTokens));
app.openapi(createApiTokenRoute, asRouteHandler<typeof createApiTokenRoute>(createApiToken));
app.openapi(getApiTokenRoute, asRouteHandler<typeof getApiTokenRoute>(getApiToken));
app.openapi(rotateApiTokenRoute, asRouteHandler<typeof rotateApiTokenRoute>(rotateApiToken));
app.openapi(revokeApiTokenRoute, asRouteHandler<typeof revokeApiTokenRoute>(revokeApiToken));

export default app;
