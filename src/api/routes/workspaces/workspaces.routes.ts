/**
 * Workspace route registrations.
 *
 * `list` and `detail` are documented via OpenAPI so they surface in the
 * Scalar UI at `/api/docs`. The other endpoints (mutations + members) stay
 * on the plain Hono `app.get/post/...` API for now — Batch 5 D1 only scoped
 * read paths for workspaces, and converting every endpoint would balloon
 * this file without adding documentation value the integrations team needs
 * today.
 *
 * Conversion pattern mirrors webhooks.routes.ts: `createRoute({...})`
 * declarative metadata, `app.openapi(routeDef, asRouteHandler(handler))`
 * to wire to the existing handler. The handler implementations are
 * unchanged.
 */

import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  apiErrorResponseSchema,
  getWorkspaceResponseSchema,
  listWorkspacesResponseSchema,
} from "../../../shared/schemas/openapi-responses";
import {
  createWorkspaceSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from "../../../shared/schemas/workspace";
import type { AppEnv } from "../../env";
import {
  requireReadScopeForResource,
  requireWorkspaceMember,
  requireWorkspaceRole,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody, validationHook } from "../../middleware/validate";
import apiTokensRoutes from "./api-tokens.routes";
import { exportWorkspace } from "./export.handlers";
import { getWorkspaceFreshness } from "./freshness.handler";
import { importWorkspaceData } from "./import.handlers";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  updateMemberRole,
  updateWorkspace,
} from "./workspaces.handlers";

/**
 * Same adapter pattern as webhooks.routes.ts — Hono's handler return type is
 * wider than the narrow `RouteHandler<R>` that `app.openapi()` expects
 * because `c.json()` returns a union over every documented status code. The
 * intermediate `unknown` cast bridges the structural gap without affecting
 * runtime behavior.
 */
function asRouteHandler<R extends RouteConfig>(
  fn: (c: Context<AppEnv>) => unknown,
): RouteHandler<R, AppEnv> {
  return fn as unknown as RouteHandler<R, AppEnv>;
}

const workspaceIdParam = z.object({
  workspaceId: z.string().openapi({
    param: { name: "workspaceId", in: "path" },
    description: "Workspace UUID",
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
});

const unauthorizedResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Authentication required",
} as const;

const forbiddenResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Caller is not a member of this workspace",
} as const;

const notFoundResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Workspace not found",
} as const;

const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }];

const listWorkspacesRoute = createRoute({
  method: "get",
  path: "/workspaces",
  tags: ["Workspaces"],
  summary: "List workspaces",
  description:
    "Returns every workspace the calling principal belongs to, each enriched with `memberCount` and the caller's `role`. Cookie-auth and PAT-auth callers see the same shape.",
  security,
  middleware: [requireAuth],
  request: {},
  responses: {
    200: {
      content: { "application/json": { schema: listWorkspacesResponseSchema } },
      description: "Workspaces the caller can access",
    },
    401: unauthorizedResponse,
  },
});

const getWorkspaceRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}",
  tags: ["Workspaces"],
  summary: "Get a workspace",
  description: "Returns a single workspace with `memberCount`. Caller must be a member.",
  security,
  middleware: [requireAuth, requireWorkspaceMember()],
  request: {
    params: workspaceIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: getWorkspaceResponseSchema } },
      description: "Workspace details",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

const app = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Workspace scope covers list/detail and the mutations on workspace-level
// resources here (workspace itself, freshness, members). The `workspace`
// resource per the doc has read + write — there is no `workspace:delete`,
// so allowDelete is false and DELETE falls under `workspace:write`. The
// api-tokens management sub-resource is mounted under `/workspaces/:id`
// but rejects PAT callers entirely via its own `rejectPatAuth()` mount,
// so adding it to the workspace scope check would never fire.
const workspaceReadScope = requireReadScopeForResource("workspace");
const workspaceWriteScope = requireWriteScopeForResource({ resource: "workspace" });

app.use("/workspaces", workspaceReadScope, workspaceWriteScope);
app.use("/workspaces/:workspaceId", workspaceReadScope, workspaceWriteScope);
app.use("/workspaces/:workspaceId/freshness", workspaceReadScope, workspaceWriteScope);
app.use("/workspaces/:workspaceId/members", workspaceReadScope, workspaceWriteScope);
app.use("/workspaces/:workspaceId/members/:userId", workspaceReadScope, workspaceWriteScope);
// Export is a GET, so only the read scope can ever fire — but a PAT with
// `workspace:read` can pull the workspace-wide archive, which is exactly
// why the route ALSO requires owner/admin role + a 5/hour rate limit below.
app.use("/workspaces/:workspaceId/export", workspaceReadScope, workspaceWriteScope);
// Import is a POST, so the WRITE scope fires: a PAT needs `workspace:write`
// to ingest data — mirroring export's mount so the two halves of the
// data-portability surface live under the same scope policy.
app.use("/workspaces/:workspaceId/import", workspaceReadScope, workspaceWriteScope);

// Mount the API token management sub-resource. The sub-app declares its
// own per-route `requireAuth` + `requireWorkspaceMember` middleware so it
// stays self-contained.
app.route("/", apiTokensRoutes);

// Documented routes
app.openapi(listWorkspacesRoute, asRouteHandler<typeof listWorkspacesRoute>(listWorkspaces));
app.openapi(getWorkspaceRoute, asRouteHandler<typeof getWorkspaceRoute>(getWorkspace));

// Remaining (plain-Hono) routes — not yet documented in OpenAPI.

app.post(
  "/workspaces",
  requireAuth,
  validateBody(createWorkspaceSchema),
  createWorkspace,
);

app.get(
  "/workspaces/:workspaceId/freshness",
  requireAuth,
  requireWorkspaceMember(),
  getWorkspaceFreshness,
);

// Workspace export — the most privileged READ in the API (full data
// egress), so it carries the strictest stack: owner/admin role only and a
// hard 5/hour limit keyed by PAT > user > IP (`defaultRateLimitKey`).
// Every successful export is additionally written to the audit ledger by
// the handler itself.
app.get(
  "/workspaces/:workspaceId/export",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  rateLimit({
    max: 5,
    windowSeconds: 3600,
    prefix: "workspace-export",
    keyFn: defaultRateLimitKey,
  }),
  exportWorkspace,
);

// Workspace import — the write-side counterpart of export: a multipart
// file upload that creates NEW projects in this workspace (Cadence or
// Trello files; `?dryRun=true` previews without writing). Owner/admin only
// and 10/hour — slightly looser than export's 5 because the stateless
// preview→confirm flow legitimately costs two requests per real import.
// Commits are written to the audit ledger by the handler (dry runs are
// not — see import.handlers.ts for the rationale).
app.post(
  "/workspaces/:workspaceId/import",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  rateLimit({
    max: 10,
    windowSeconds: 3600,
    prefix: "workspace-import",
    keyFn: defaultRateLimitKey,
  }),
  importWorkspaceData,
);

app.patch(
  "/workspaces/:workspaceId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(updateWorkspaceSchema),
  updateWorkspace,
);

app.delete(
  "/workspaces/:workspaceId",
  requireAuth,
  requireWorkspaceRole("owner"),
  deleteWorkspace,
);

app.get(
  "/workspaces/:workspaceId/members",
  requireAuth,
  requireWorkspaceMember(),
  listMembers,
);

app.patch(
  "/workspaces/:workspaceId/members/:userId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(updateMemberRoleSchema),
  updateMemberRole,
);

app.delete(
  "/workspaces/:workspaceId/members/:userId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  removeMember,
);

export default app;
