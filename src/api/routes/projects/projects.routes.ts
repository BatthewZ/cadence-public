import { Hono } from "hono";

import { createLabelSchema, updateLabelSchema } from "../../../shared/schemas/label";
import {
  addProjectMemberSchema,
  createProjectSchema,
  duplicateProjectSchema,
  reorderProjectSchema,
  updateProjectSchema,
} from "../../../shared/schemas/project";
import { unsplashCoverPayloadSchema } from "../../../shared/schemas/unsplash";
import { createWebhookSchema, updateWebhookSchema } from "../../../shared/schemas/webhook";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
  requireProjectRole,
  requireWorkspaceMember,
} from "../../middleware/authorize";
import { rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import { getProjectFreshness } from "./freshness.handler";
import {
  createLabel,
  deleteLabel,
  listLabels,
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
  updateProject,
  uploadProjectCover,
} from "./projects.handlers";

const app = new Hono<AppEnv>();

// Workspace-scoped project routes
app.post(
  "/workspaces/:workspaceId/projects",
  requireAuth,
  requireWorkspaceMember(),
  validateBody(createProjectSchema),
  createProject,
);

app.get(
  "/workspaces/:workspaceId/projects",
  requireAuth,
  requireWorkspaceMember(),
  listProjects,
);

// Project freshness polling endpoint
app.get("/projects/:projectId/freshness", requireAuth, requireProjectAccess(), getProjectFreshness);

// Project-scoped routes
app.get("/projects/:projectId", requireAuth, requireProjectAccess(), getProject);

app.patch(
  "/projects/:projectId",
  requireAuth,
  requireProjectRole("admin"),
  validateBody(updateProjectSchema),
  updateProject,
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

app.post(
  "/projects/:projectId/duplicate",
  requireAuth,
  requireProjectRole("admin"),
  validateBody(duplicateProjectSchema),
  duplicateProject,
);

// Project cover image routes
app.put(
  "/projects/:projectId/cover",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 10, windowSeconds: 60, prefix: "project-cover-upload" }),
  uploadProjectCover,
);

app.put(
  "/projects/:projectId/cover/unsplash",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 10, windowSeconds: 60, prefix: "project-cover-unsplash" }),
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

app.delete(
  "/projects/:projectId/members/:userId",
  requireAuth,
  requireProjectRole("admin"),
  removeMember,
);

// ---------------------------------------------------------------------------
// Label routes
// ---------------------------------------------------------------------------

app.post(
  "/projects/:projectId/labels",
  requireAuth,
  requireProjectRole("admin", "member"),
  validateBody(createLabelSchema),
  createLabel,
);

app.get(
  "/projects/:projectId/labels",
  requireAuth,
  requireProjectAccess(),
  listLabels,
);

app.patch(
  "/projects/:projectId/labels/:labelId",
  requireAuth,
  requireProjectRole("admin", "member"),
  validateBody(updateLabelSchema),
  updateLabel,
);

app.delete(
  "/projects/:projectId/labels/:labelId",
  requireAuth,
  requireProjectRole("admin"),
  deleteLabel,
);

// ---------------------------------------------------------------------------
// Project-scoped webhook routes
// ---------------------------------------------------------------------------

app.get(
  "/projects/:projectId/webhooks",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 60, windowSeconds: 60, prefix: "project-webhook-read" }),
  listProjectWebhooks,
);

app.post(
  "/projects/:projectId/webhooks",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 20, windowSeconds: 60, prefix: "project-webhook-write" }),
  validateBody(createWebhookSchema),
  createProjectWebhook,
);

app.get(
  "/projects/:projectId/webhooks/:webhookId",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 60, windowSeconds: 60, prefix: "project-webhook-read" }),
  getProjectWebhook,
);

app.patch(
  "/projects/:projectId/webhooks/:webhookId",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 20, windowSeconds: 60, prefix: "project-webhook-write" }),
  validateBody(updateWebhookSchema),
  updateProjectWebhook,
);

app.delete(
  "/projects/:projectId/webhooks/:webhookId",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 20, windowSeconds: 60, prefix: "project-webhook-write" }),
  deleteProjectWebhook,
);

app.post(
  "/projects/:projectId/webhooks/:webhookId/test",
  requireAuth,
  requireProjectRole("admin"),
  rateLimit({ max: 5, windowSeconds: 60, prefix: "project-webhook-test" }),
  testProjectWebhook,
);

export default app;
