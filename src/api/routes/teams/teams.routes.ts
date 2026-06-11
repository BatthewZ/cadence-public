import { Hono } from "hono";

import { addTeamMemberSchema, createTeamSchema, updateTeamSchema } from "../../../shared/schemas/team";
import type { AppEnv } from "../../env";
import {
  requireReadScopeForResource,
  requireWorkspaceMember,
  requireWorkspaceRole,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeamDetail,
  listTeams,
  removeTeamMember,
  updateTeam,
} from "./teams.handlers";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Team scope covers list/detail, CRUD, and team-member mutations.
// `team:read` for GET and `team:write` for POST/PATCH/DELETE per the doc.
// No `team:delete` exists in the v1 grammar, so DELETE falls under
// `team:write`.
const teamReadScope = requireReadScopeForResource("team");
const teamWriteScope = requireWriteScopeForResource({ resource: "team" });

app.use("/workspaces/:workspaceId/teams", teamReadScope, teamWriteScope);
app.use("/workspaces/:workspaceId/teams/:teamId", teamReadScope, teamWriteScope);
app.use("/workspaces/:workspaceId/teams/:teamId/members", teamReadScope, teamWriteScope);
app.use("/workspaces/:workspaceId/teams/:teamId/members/:userId", teamReadScope, teamWriteScope);

// Create team
app.post(
  "/workspaces/:workspaceId/teams",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(createTeamSchema),
  createTeam,
);

// List teams in workspace
app.get(
  "/workspaces/:workspaceId/teams",
  requireAuth,
  requireWorkspaceMember(),
  listTeams,
);

// Get team detail
app.get(
  "/workspaces/:workspaceId/teams/:teamId",
  requireAuth,
  requireWorkspaceMember(),
  getTeamDetail,
);

// Update team
app.patch(
  "/workspaces/:workspaceId/teams/:teamId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(updateTeamSchema),
  updateTeam,
);

// Delete team
app.delete(
  "/workspaces/:workspaceId/teams/:teamId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  deleteTeam,
);

// Add team member
app.post(
  "/workspaces/:workspaceId/teams/:teamId/members",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(addTeamMemberSchema),
  addTeamMember,
);

// Remove team member
app.delete(
  "/workspaces/:workspaceId/teams/:teamId/members/:userId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  removeTeamMember,
);

export default app;
