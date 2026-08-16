/**
 * Project + label route registrations.
 *
 * The in-scope endpoints for Batch 5 D1 (list/detail/create/update on
 * projects, the full label CRUD set) are wired through `app.openapi()` so
 * they appear in the spec. Everything else stays on plain Hono
 * registrations and will be documented in a follow-up pass.
 */

import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { createLabelSchema, updateLabelSchema } from "../../../shared/schemas/label";
import {
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  createLabelResponseSchema,
  createProjectResponseSchema,
  deleteLabelResponseSchema,
  getProjectResponseSchema,
  listLabelsResponseSchema,
  listProjectsResponseSchema,
  listWorkspaceLabelsResponseSchema,
  updateLabelResponseSchema,
  updateProjectResponseSchema,
} from "../../../shared/schemas/openapi-responses";
import {
  addProjectMemberSchema,
  createProjectSchema,
  duplicateProjectSchema,
  reorderProjectSchema,
  updateProjectMemberRoleSchema,
  updateProjectSchema,
} from "../../../shared/schemas/project";
import {
  createSavedViewSchema,
  updateSavedViewSchema,
} from "../../../shared/schemas/saved-view";
import { unsplashCoverPayloadSchema } from "../../../shared/schemas/unsplash";
import { createWebhookSchema, updateWebhookSchema } from "../../../shared/schemas/webhook";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
  requireProjectCreation,
  requireProjectRole,
  requireReadScopeForResource,
  requireWorkspaceMember,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody, validationHook } from "../../middleware/validate";
import { exportProjectCsv } from "./export-csv.handler";
import { getProjectFreshness } from "./freshness.handler";
import {
  createLabel,
  deleteLabel,
  listLabels,
  listWorkspaceLabels,
  updateLabel,
} from "./labels.handlers";
import {
  createProjectWebhook,
  deleteProjectWebhook,
  getProjectWebhook,
  listProjectWebhooks,
  testProjectWebhook,
  updateProjectWebhook,
} from "./project-webhooks.handlers";
import {
  addMember,
  applyProjectUnsplashCover,
  createProject,
  deleteProject,
  deleteProjectCover,
  duplicateProject,
  getProject,
  listMembers,
  listProjects,
  removeMember,
  reorderProject,
  updateMemberRole,
  updateProject,
  uploadProjectCover,
} from "./projects.handlers";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from "./saved-views.handlers";

/**
 * Bridge between Hono's wide `Context<AppEnv>` handler return type and the
 * narrow `RouteHandler<R, AppEnv>` that `app.openapi()` expects. See the
 * webhooks routes for the rationale — runtime behavior is unchanged.
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

const projectIdParam = z.object({
  projectId: z.string().openapi({
    param: { name: "projectId", in: "path" },
    description: "Project UUID",
    example: "660e8400-e29b-41d4-a716-446655440000",
  }),
});

const labelIdParams = projectIdParam.extend({
  labelId: z.string().openapi({
    param: { name: "labelId", in: "path" },
    description: "Label ID",
  }),
});

const unauthorizedResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Authentication required",
} as const;

const forbiddenResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Caller lacks the required workspace/project role",
} as const;

const projectNotFoundResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Project not found",
} as const;

const labelNotFoundResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Label not found",
} as const;

const validationFailedResponse = {
  content: { "application/json": { schema: apiValidationErrorResponseSchema } },
  description: "Validation failed",
} as const;

const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }];

// ---------------------------------------------------------------------------
// Project route definitions
// ---------------------------------------------------------------------------

const listProjectsRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/projects",
  tags: ["Projects"],
  summary: "List projects in a workspace",
  description:
    "Returns every project the caller can see in the workspace. Owners/admins see all projects; members only see projects they belong to. Each project is enriched with `memberCount` and `taskGroupCount` for cheap dashboard rendering.",
  security,
  middleware: [requireAuth, requireWorkspaceMember()],
  request: {
    params: workspaceIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: listProjectsResponseSchema } },
      description: "List of projects",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const getProjectRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}",
  tags: ["Projects"],
  summary: "Get a project",
  description: "Returns a single project. Caller must have workspace or project access.",
  security,
  middleware: [requireAuth, requireProjectAccess()],
  request: {
    params: projectIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: getProjectResponseSchema } },
      description: "Project details",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: projectNotFoundResponse,
  },
});

const createProjectRoute = createRoute({
  method: "post",
  path: "/workspaces/{workspaceId}/projects",
  tags: ["Projects"],
  summary: "Create a project",
  description:
    "Create a new project inside a workspace. The calling user is automatically added as a project admin. Three default task groups (`To Do`, `In Progress`, `Done`) are created in the same atomic batch.\n\nWorkspace owners and admins may always create projects. Members may only do so while the workspace's `allowMemberProjectCreation` policy is enabled (the default); when an admin turns it off, a member's request answers `403`.",
  security,
  middleware: [requireAuth, requireWorkspaceMember(), requireProjectCreation()],
  request: {
    params: workspaceIdParam,
    body: {
      content: { "application/json": { schema: createProjectSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: createProjectResponseSchema } },
      description: "Project created",
    },
    400: validationFailedResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const updateProjectRoute = createRoute({
  method: "patch",
  path: "/projects/{projectId}",
  tags: ["Projects"],
  summary: "Update a project",
  description:
    "Update mutable fields on a project. Requires the `admin` project role. Setting `status` to `archived` deletes any project-scoped webhooks (workspace-scoped webhooks still receive `project.archived`).",
  security,
  middleware: [requireAuth, requireProjectRole("admin")],
  request: {
    params: projectIdParam,
    body: {
      content: { "application/json": { schema: updateProjectSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: updateProjectResponseSchema } },
      description: "Project updated",
    },
    400: validationFailedResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: projectNotFoundResponse,
  },
});

// ---------------------------------------------------------------------------
// Label route definitions
// ---------------------------------------------------------------------------

const listLabelsRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/labels",
  tags: ["Labels"],
  summary: "List project labels",
  description: "Returns every label in the project with an aggregated `taskCount`.",
  security,
  middleware: [requireAuth, requireProjectAccess()],
  request: {
    params: projectIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: listLabelsResponseSchema } },
      description: "Project labels",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const listWorkspaceLabelsRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/labels",
  tags: ["Labels"],
  summary: "List workspace labels",
  description:
    "Returns labels across every active project the caller can see in the workspace, deduplicated by case-insensitive name (`MIN(name)`/`MIN(color)` per group, ordered by name). Owners/admins see labels from all projects; members only from projects they belong to. Intended for workspace-level filter UIs such as the My Tasks label filter.",
  security,
  middleware: [requireAuth, requireWorkspaceMember()],
  request: {
    params: workspaceIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: listWorkspaceLabelsResponseSchema } },
      description: "Deduplicated labels across the caller's visible active projects",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const createLabelRoute = createRoute({
  method: "post",
  path: "/projects/{projectId}/labels",
  tags: ["Labels"],
  summary: "Create a label",
  description:
    "Create a label inside a project. Name uniqueness is enforced case-insensitively. Hard cap of 50 labels per project.",
  security,
  middleware: [requireAuth, requireProjectRole("admin", "member")],
  request: {
    params: projectIdParam,
    body: {
      content: { "application/json": { schema: createLabelSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: createLabelResponseSchema } },
      description: "Label created",
    },
    400: validationFailedResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: {
      content: { "application/json": { schema: apiErrorResponseSchema } },
      description: "A label with this name already exists in the project",
    },
  },
});

const updateLabelRoute = createRoute({
  method: "patch",
  path: "/projects/{projectId}/labels/{labelId}",
  tags: ["Labels"],
  summary: "Update a label",
  description: "Update a label's name and/or color. Name uniqueness is enforced case-insensitively.",
  security,
  middleware: [requireAuth, requireProjectRole("admin", "member")],
  request: {
    params: labelIdParams,
    body: {
      content: { "application/json": { schema: updateLabelSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: updateLabelResponseSchema } },
      description: "Label updated",
    },
    400: validationFailedResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: labelNotFoundResponse,
    409: {
      content: { "application/json": { schema: apiErrorResponseSchema } },
      description: "A label with this name already exists in the project",
    },
  },
});

const deleteLabelRoute = createRoute({
  method: "delete",
  path: "/projects/{projectId}/labels/{labelId}",
  tags: ["Labels"],
  summary: "Delete a label",
  description:
    "Delete a label. Task assignments cascade-delete via the `taskLabel` FK so callers do not need to clean up references first.",
  security,
  middleware: [requireAuth, requireProjectRole("admin")],
  request: {
    params: labelIdParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: deleteLabelResponseSchema } },
      description: "Label deleted",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: labelNotFoundResponse,
  },
});

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Project / label / webhook scopes are mounted per exact path so a token
// with `label:write` only is not rejected for failing a `project:write`
// check on the labels routes — the doc's scope grammar treats labels and
// webhooks as first-class resources with their own scopes, even when they
// live under a project path. The factories are no-ops on cookie auth and
// on the wrong HTTP method, so over-mounting is cheap.
//
// Project scope covers everything that is unambiguously a project op:
// the project resource itself, plus cover/duplicate/reorder/freshness/
// members which are project metadata mutations. `members` falls under
// `project` rather than getting its own scope because the doc's grammar
// does not define a `member:*` scope — membership is a property of the
// project, edited via `project:write`.
const projectReadScope = requireReadScopeForResource("project");
const projectWriteScope = requireWriteScopeForResource({ resource: "project", allowDelete: true });
const labelReadScope = requireReadScopeForResource("label");
const labelWriteScope = requireWriteScopeForResource({ resource: "label" });
const webhookReadScope = requireReadScopeForResource("webhook");
const webhookWriteScope = requireWriteScopeForResource({ resource: "webhook" });

app.use("/workspaces/:workspaceId/projects", projectReadScope, projectWriteScope);
app.use("/projects/:projectId", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/duplicate", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/reorder", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/freshness", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/cover", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/cover/unsplash", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/members", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/members/:userId", projectReadScope, projectWriteScope);

// CSV export is read-only project data egress, so only the read scope
// mounts — a `project:read` PAT can export, mirroring how the same token
// can already page through every exported field via the task list API.
app.use("/projects/:projectId/export/csv", projectReadScope);

app.use("/projects/:projectId/labels", labelReadScope, labelWriteScope);
app.use("/projects/:projectId/labels/:labelId", labelReadScope, labelWriteScope);
// Workspace-level label listing is read-only, so only the read scope mounts.
app.use("/workspaces/:workspaceId/labels", labelReadScope);

app.use("/projects/:projectId/webhooks", webhookReadScope, webhookWriteScope);
app.use("/projects/:projectId/webhooks/:webhookId", webhookReadScope, webhookWriteScope);
app.use("/projects/:projectId/webhooks/:webhookId/test", webhookReadScope, webhookWriteScope);

// Saved views ride the `project` scope: the PAT scope grammar has no
// `view:*` resource, and views are project-scoped personal state — the same
// reasoning that puts members/freshness under `project` rather than minting
// a new scope.
app.use("/projects/:projectId/views", projectReadScope, projectWriteScope);
app.use("/projects/:projectId/views/:viewId", projectReadScope, projectWriteScope);

// Documented routes
app.openapi(listProjectsRoute, asRouteHandler<typeof listProjectsRoute>(listProjects));
app.openapi(getProjectRoute, asRouteHandler<typeof getProjectRoute>(getProject));
app.openapi(createProjectRoute, asRouteHandler<typeof createProjectRoute>(createProject));
app.openapi(updateProjectRoute, asRouteHandler<typeof updateProjectRoute>(updateProject));

app.openapi(listLabelsRoute, asRouteHandler<typeof listLabelsRoute>(listLabels));
app.openapi(
  listWorkspaceLabelsRoute,
  asRouteHandler<typeof listWorkspaceLabelsRoute>(listWorkspaceLabels),
);
app.openapi(createLabelRoute, asRouteHandler<typeof createLabelRoute>(createLabel));
app.openapi(updateLabelRoute, asRouteHandler<typeof updateLabelRoute>(updateLabel));
app.openapi(deleteLabelRoute, asRouteHandler<typeof deleteLabelRoute>(deleteLabel));

// ---------------------------------------------------------------------------
// Remaining plain-Hono routes (not yet documented)
// ---------------------------------------------------------------------------

// Project freshness polling endpoint
app.get("/projects/:projectId/freshness", requireAuth, requireProjectAccess(), getProjectFreshness);

// Per-project CSV export. ANY project member (including viewers) may export:
// viewers can already read every exported field via the task APIs, so a
// tighter role gate here would be theater, not a control (plan decision 3).
// Rate-limited per caller because each export is a full project table scan.
app.get(
  "/projects/:projectId/export/csv",
  requireAuth,
  requireProjectAccess(),
  rateLimit({ max: 30, windowSeconds: 3600, prefix: "project-export-csv", keyFn: defaultRateLimitKey }),
  exportProjectCsv,
);

app.patch(
  "/projects/:projectId/reorder",
  requireAuth,
  requireProjectAccess(),
  validateBody(reorderProjectSchema),
  reorderProject,
);

app.delete(
  "/projects/:projectId",
  requireAuth,
  requireProjectRole("admin"),
  deleteProject,
);

// Duplicating is a project-creating path, so it carries the workspace's
// project-creation policy as well as the project-admin check. Without it the
// policy would be trivially bypassable: `createProject` makes its caller a
// project admin, so any member who created a project while the setting was on
// keeps passing `requireProjectRole("admin")` on it forever and could go on
// minting projects from that seed after an admin turned the setting off.
// `requireProjectCreation` must run AFTER `requireProjectRole` — it reads the
// owning workspace from the project access that guard resolves and caches.
app.post(
  "/projects/:projectId/duplicate",
  requireAuth,
  requireProjectRole("admin"),
  requireProjectCreation(),
  validateBody(duplicateProjectSchema),
  duplicateProject,
);

// Project cover image routes
app.put(
  "/projects/:projectId/cover",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 10, windowSeconds: 60, prefix: "project-cover-upload", keyFn: defaultRateLimitKey }),
  uploadProjectCover,
);

app.put(
  "/projects/:projectId/cover/unsplash",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 10, windowSeconds: 60, prefix: "project-cover-unsplash", keyFn: defaultRateLimitKey }),
  validateBody(unsplashCoverPayloadSchema),
  applyProjectUnsplashCover,
);

app.delete(
  "/projects/:projectId/cover",
  requireAuth,
  requireProjectRole("admin"),
  deleteProjectCover,
);

// Project member routes
app.get(
  "/projects/:projectId/members",
  requireAuth,
  requireProjectAccess(),
  listMembers,
);

app.post(
  "/projects/:projectId/members",
  requireAuth,
  requireProjectRole("admin"),
  validateBody(addProjectMemberSchema),
  addMember,
);

app.patch(
  "/projects/:projectId/members/:userId",
  requireAuth,
  requireProjectRole("admin"),
  validateBody(updateProjectMemberRoleSchema),
  updateMemberRole,
);

app.delete(
  "/projects/:projectId/members/:userId",
  requireAuth,
  requireProjectRole("admin"),
  removeMember,
);

// ---------------------------------------------------------------------------
// Project-scoped webhook routes
// ---------------------------------------------------------------------------

app.get(
  "/projects/:projectId/webhooks",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 60, windowSeconds: 60, prefix: "project-webhook-read", keyFn: defaultRateLimitKey }),
  listProjectWebhooks,
);

app.post(
  "/projects/:projectId/webhooks",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 20, windowSeconds: 60, prefix: "project-webhook-write", keyFn: defaultRateLimitKey }),
  validateBody(createWebhookSchema),
  createProjectWebhook,
);

app.get(
  "/projects/:projectId/webhooks/:webhookId",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 60, windowSeconds: 60, prefix: "project-webhook-read", keyFn: defaultRateLimitKey }),
  getProjectWebhook,
);

app.patch(
  "/projects/:projectId/webhooks/:webhookId",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 20, windowSeconds: 60, prefix: "project-webhook-write", keyFn: defaultRateLimitKey }),
  validateBody(updateWebhookSchema),
  updateProjectWebhook,
);

app.delete(
  "/projects/:projectId/webhooks/:webhookId",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 20, windowSeconds: 60, prefix: "project-webhook-write", keyFn: defaultRateLimitKey }),
  deleteProjectWebhook,
);

app.post(
  "/projects/:projectId/webhooks/:webhookId/test",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 5, windowSeconds: 60, prefix: "project-webhook-test", keyFn: defaultRateLimitKey }),
  testProjectWebhook,
);

// ---------------------------------------------------------------------------
// Saved view routes (private per-user-per-project board bookmarks)
// ---------------------------------------------------------------------------
//
// `requireProjectAccess()` (any member, including viewers — views bookmark
// read-only board state) is deliberately the only role gate: the handlers
// scope every query by creatorId, so cross-user access yields 404 rather
// than 403. See saved-views.handlers.ts for why that distinction matters.

app.get(
  "/projects/:projectId/views",
  requireAuth,
  requireProjectAccess(),
  listSavedViews,
);

app.post(
  "/projects/:projectId/views",
  requireAuth,
  requireProjectAccess(),
  validateBody(createSavedViewSchema),
  createSavedView,
);

app.patch(
  "/projects/:projectId/views/:viewId",
  requireAuth,
  requireProjectAccess(),
  validateBody(updateSavedViewSchema),
  updateSavedView,
);

app.delete(
  "/projects/:projectId/views/:viewId",
  requireAuth,
  requireProjectAccess(),
  deleteSavedView,
);

export default app;
