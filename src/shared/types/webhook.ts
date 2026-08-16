export const WEBHOOK_EVENT_TYPES = [
  // Task events (11)
  "task.created",
  "task.updated",
  "task.completed",
  "task.uncompleted",
  "task.deleted",
  "task.assigned",
  "task.unassigned",
  "task.moved",
  "task.comment_created",
  "task.label_added",
  "task.label_removed",
  // Project events (7)
  "project.created",
  "project.updated",
  "project.archived",
  "project.deleted",
  "project.member_added",
  "project.member_removed",
  "project.member_role_changed",
  // Workspace events (3)
  "workspace.member_joined",
  "workspace.member_removed",
  "workspace.member_role_changed",
  // Invitation events (3)
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Events that belong to a specific project (task.* and project.*). */
export const PROJECT_SCOPED_EVENTS: ReadonlySet<WebhookEventType> = new Set(
  WEBHOOK_EVENT_TYPES.filter(
    (e) => e.startsWith("task.") || e.startsWith("project."),
  ),
);

/** Events that are workspace-wide and have no project context (workspace.* and invitation.*). */
export const WORKSPACE_SCOPED_EVENTS: ReadonlySet<WebhookEventType> = new Set(
  WEBHOOK_EVENT_TYPES.filter(
    (e) => e.startsWith("workspace.") || e.startsWith("invitation."),
  ),
);

/** Groups derived from WEBHOOK_EVENT_TYPES by prefix so new events are automatically categorized. */
export const WEBHOOK_EVENT_GROUPS = WEBHOOK_EVENT_TYPES.reduce<
  Record<string, WebhookEventType[]>
>((groups, event) => {
  const prefix = event.split(".")[0];
  const label = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  (groups[label] ??= []).push(event);
  return groups;
}, {}) as Record<string, readonly WebhookEventType[]>;

export interface WebhookPayloadEnvelope {
  [key: string]: unknown;
  id: string;
  event: WebhookEventType;
  timestamp: string; // ISO 8601
  workspace: { id: string; name: string; slug: string };
  project?: { id: string; name: string };
  actor: { id: string; name: string; email: string };
  data: Record<string, unknown>;
  changes?: Record<string, { from: unknown; to: unknown }>;
}
