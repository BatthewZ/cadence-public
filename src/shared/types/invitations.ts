/**
 * Canonical invitation type used across the application.
 *
 * Consolidates the previously duplicated invitation interfaces from
 * PendingInvitations, Notifications, InviteAccept, and WorkspaceMembers.
 * Each consumer may only use a subset of these fields, but having a single
 * source of truth prevents drift and ensures API response shapes stay
 * consistent across the codebase.
 */
export interface Invitation {
  id: string;
  token?: string;
  email?: string;
  role: string;
  expiresAt?: string;
  createdAt?: string;
  workspace?: { id: string; name: string } | null;
  invitedBy?: { id: string; name: string; email: string } | null;
}
