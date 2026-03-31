import { Hono } from "hono";

import {
  createWorkspaceSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from "../../../shared/schemas/workspace";
import type { AppEnv } from "../../env";
import {
  requireWorkspaceMember,
  requireWorkspaceRole,
} from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import { getWorkspaceFreshness } from "./freshness.handler";
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

const app = new Hono<AppEnv>();

app.post(
  "/workspaces",
  requireAuth,
  validateBody(createWorkspaceSchema),
  createWorkspace,
);

app.get("/workspaces", requireAuth, listWorkspaces);

app.get(
  "/workspaces/:workspaceId/freshness",
  requireAuth,
  requireWorkspaceMember(),
  getWorkspaceFreshness,
);

app.get(
  "/workspaces/:workspaceId",
  requireAuth,
  requireWorkspaceMember(),
  getWorkspace,
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
