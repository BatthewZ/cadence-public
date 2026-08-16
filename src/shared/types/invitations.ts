/**
 * Canonical invitation type used across the application.
 *
 * Consolidates the previously duplicated invitation interfaces from
 * PendingInvitations, Notifications, InviteAccept, and WorkspaceMembers.
 * Each consumer may only use a subset of these fields, but having a single
 * source of truth prevents drift and ensures API response shapes stay
 * consistent across the codebase.
 *
 * There is deliberately no `token` field. The invitation token is a bearer
 * credential and no list endpoint returns it any more (audit finding 04) —
 * `GET /api/invitations/pending` and `GET /api/workspaces/:id/invitations`
 * both omit it. Signed-in users accept with `{ invitationId }`; the emailed
 * `/invite/:token` link is the only place a token appears client-side, and it
 * comes from the URL, not from this type. Re-adding the field here would let
 * a consumer quietly start depending on the exposure again.
 */
export interface Invitation {
  id: string;
  email?: string;
  role: string;
  expiresAt?: string;
  createdAt?: string;
  workspace?: { id: string; name: string } | null;
  invitedBy?: { id: string; name: string; email: string } | null;
}
