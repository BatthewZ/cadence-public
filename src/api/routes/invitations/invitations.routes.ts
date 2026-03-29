import { Hono } from "hono";

import {
  acceptInvitationSchema,
  createInvitationSchema,
} from "../../../shared/schemas/invitation";
import type { AppEnv } from "../../env";
import { requireWorkspaceRole } from "../../middleware/authorize";
import { rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import {
  acceptInvitation,
  createInvitation,
  getInvitation,
  listInvitations,
  listMyPendingInvitations,
  revokeInvitation,
} from "./invitations.handlers";

const app = new Hono<AppEnv>();

// Create invitation
app.post(
  "/workspaces/:workspaceId/invitations",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(createInvitationSchema),
  createInvitation,
);

// List pending invitations
app.get(
  "/workspaces/:workspaceId/invitations",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  listInvitations,
);

// Revoke invitation
app.delete(
  "/workspaces/:workspaceId/invitations/:id",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  revokeInvitation,
);

// List pending invitations for the authenticated user
app.get("/invitations/pending", requireAuth, listMyPendingInvitations);

// Get invitation by token (public, no auth)
app.get(
  "/invitations/:token",
  rateLimit({ max: 10, windowSeconds: 60, prefix: "invitation-lookup" }),
  getInvitation,
);

// Accept invitation
app.post(
  "/invitations/accept",
  requireAuth,
  rateLimit({ max: 10, windowSeconds: 60, prefix: "invitation-accept" }),
  validateBody(acceptInvitationSchema),
  acceptInvitation,
);

export default app;
