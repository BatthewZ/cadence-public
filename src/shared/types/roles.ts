export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_ROLES = ["admin", "member", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const TEAM_ROLES = ["lead", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TASK_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PROJECT_STATUSES = ["active", "archived", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "invitation_received",
  "task_assigned",
  "task_comment_mention",
  "task_completed",
  "project_member_added",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
  lead: "Lead",
};

export function parseWorkspaceRole(value: string): WorkspaceRole {
  if (!WORKSPACE_ROLES.includes(value as WorkspaceRole)) {
    throw new Error(`Invalid workspace role: ${value}`);
  }
  return value as WorkspaceRole;
}

export function parseProjectRole(value: string): ProjectRole {
  if (!PROJECT_ROLES.includes(value as ProjectRole)) {
    throw new Error(`Invalid project role: ${value}`);
  }
  return value as ProjectRole;
}

export function parseTeamRole(value: string): TeamRole {
  if (!TEAM_ROLES.includes(value as TeamRole)) {
    throw new Error(`Invalid team role: ${value}`);
  }
  return value as TeamRole;
}
