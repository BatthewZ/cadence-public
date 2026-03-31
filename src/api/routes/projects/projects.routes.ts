import { Hono } from "hono";

import { createLabelSchema, updateLabelSchema } from "../../../shared/schemas/label";
import {
  addProjectMemberSchema,
  createProjectSchema,
  duplicateProjectSchema,
  updateProjectSchema,
} from "../../../shared/schemas/project";
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
  addMember,
  createProject,
  deleteProject,
  deleteProjectCover,
  duplicateProject,
  getProject,
  listMembers,
  listProjects,
  removeMember,
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

export default app;
