import { Hono } from "hono";

import {
  acceptInvitationSchema,
  createInvitationSchema,
} from "../../../shared/schemas/invitation";
import type { AppEnv } from "../../env";
import {
  requireWorkspaceRole,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
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

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Per the doc, `invitation:write` is the only invitation scope — there is
// no `invitation:read` in v1 because listing invitations is admin-only and
// admins can use a cookie session for that view. The mounts below apply
// only to workspace-scoped invitation routes; the public `/invitations/*`
// lookup/accept paths do not require a PAT scope (they cannot be reached
// by a PAT — `getInvitation` is unauthenticated and `acceptInvitation`
// runs in the cookie-auth user context).
const invitationWriteScope = requireWriteScopeForResource({ resource: "invitation" });

app.use("/workspaces/:workspaceId/invitations", invitationWriteScope);
app.use("/workspaces/:workspaceId/invitations/:id", invitationWriteScope);

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
  rateLimit({ max: 10, windowSeconds: 60, prefix: "invitation-accept", keyFn: defaultRateLimitKey }),
  validateBody(acceptInvitationSchema),
  acceptInvitation,
);

export default app;
