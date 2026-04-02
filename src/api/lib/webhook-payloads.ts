import { eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../db";
import { user } from "../../db/schema/auth";
import { invitation } from "../../db/schema/invitation";
import { project } from "../../db/schema/project";
import { task } from "../../db/schema/task";
import { workspace } from "../../db/schema/workspace";
import type {
  WebhookEventType,
  WebhookPayloadEnvelope,
} from "../../shared/types/webhook";
import type { AppEnv } from "../env";
import { dispatchWebhookEvent } from "./webhooks";

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

export interface WebhookContext {
  workspace: { id: string; name: string; slug: string };
  project?: { id: string; name: string };
  actor: { id: string; name: string; email: string };
}

interface FetchWebhookContextOpts {
  workspaceId: string;
  projectId?: string;
  actorId: string;
}

// Drizzle select result types derived from schema tables
type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type InvitationRow = typeof invitation.$inferSelect;

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

/**
 * Build a WebhookPayloadEnvelope ready for dispatch.
 *
 * The `id` field is left as an empty string — the dispatch layer fills it in
 * with the delivery ID so each delivery has a unique, traceable identifier.
 */
export function buildWebhookPayload(
  event: WebhookEventType,
  context: WebhookContext,
  data: Record<string, unknown>,
  changes?: Record<string, { from: unknown; to: unknown }>,
): WebhookPayloadEnvelope {
  return {
    id: "", // filled in by dispatch with deliveryId
    event,
    timestamp: new Date().toISOString(),
    workspace: context.workspace,
    project: context.project,
    actor: context.actor,
    data,
    changes,
  };
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

/**
 * Compare `before` and `after` objects across the specified `fields` and
 * return a changes record containing only the fields that actually differ.
 *
 * Returns `undefined` when nothing changed — callers can pass the result
 * directly to `buildWebhookPayload` without additional null checks.
 *
 * Comparison uses strict equality after serialising Date objects to ISO
 * strings so that timestamp columns are compared by value rather than by
 * reference.
 */
export function computeChanges<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> | undefined {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  let hasChanges = false;

  for (const field of fields) {
    const fromVal = normaliseValue(before[field]);
    const toVal = normaliseValue(after[field]);

    if (fromVal !== toVal) {
      changes[field] = { from: fromVal, to: toVal };
      hasChanges = true;
    }
  }

  return hasChanges ? changes : undefined;
}

/**
 * Normalise a value for comparison and serialisation.
 *
 * Dates are converted to ISO strings so that two Date objects representing
 * the same instant compare as equal. All other values pass through unchanged.
 */
function normaliseValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

// ---------------------------------------------------------------------------
// Domain-specific data extractors
// ---------------------------------------------------------------------------

/**
 * Extract the webhook-relevant fields from a task row.
 *
 * Timestamp columns are serialised to ISO 8601 strings so that the payload
 * is JSON-safe and consistent across time zones.
 */
export function buildTaskEventData(taskRow: TaskRow): Record<string, unknown> {
  return {
    id: taskRow.id,
    title: taskRow.title,
    description: taskRow.description,
    projectId: taskRow.projectId,
    taskGroupId: taskRow.taskGroupId,
    assigneeId: taskRow.assigneeId,
    priority: taskRow.priority,
    dueDate: taskRow.dueDate?.toISOString() ?? null,
    cost: taskRow.cost,
    completed: taskRow.completed,
    completedAt: taskRow.completedAt?.toISOString() ?? null,
    completedBy: taskRow.completedBy,
    position: taskRow.position,
    icon: taskRow.icon,
    recurrenceRule: taskRow.recurrenceRule ?? null,
    recurrenceParentId: taskRow.recurrenceParentId ?? null,
    recurrenceSeriesId: taskRow.recurrenceSeriesId ?? null,
    createdAt: taskRow.createdAt.toISOString(),
    updatedAt: taskRow.updatedAt.toISOString(),
  };
}

/**
 * Extract the webhook-relevant fields from a project row.
 */
export function buildProjectEventData(
  projectRow: ProjectRow,
): Record<string, unknown> {
  return {
    id: projectRow.id,
    workspaceId: projectRow.workspaceId,
    name: projectRow.name,
    description: projectRow.description,
    status: projectRow.status,
    icon: projectRow.icon,
    budget: projectRow.budget,
    createdAt: projectRow.createdAt.toISOString(),
    updatedAt: projectRow.updatedAt.toISOString(),
  };
}

/**
 * Extract the webhook-relevant fields from an invitation row.
 */
export function buildInvitationEventData(
  invitationRow: InvitationRow,
): Record<string, unknown> {
  return {
    id: invitationRow.id,
    workspaceId: invitationRow.workspaceId,
    email: invitationRow.email,
    role: invitationRow.role,
    status: invitationRow.status,
    expiresAt: invitationRow.expiresAt.toISOString(),
    createdAt: invitationRow.createdAt.toISOString(),
  };
}

/**
 * Build the webhook data payload for workspace/project member events.
 *
 * The shape is intentionally flat — `workspaceId` or `projectId` is provided
 * depending on the event domain.
 */
export function buildMemberEventData(
  member: { userId: string; workspaceId?: string; projectId?: string },
  role?: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    userId: member.userId,
    role: role ?? null,
  };

  if (member.workspaceId) {
    data.workspaceId = member.workspaceId;
  }
  if (member.projectId) {
    data.projectId = member.projectId;
  }

  return data;
}

// ---------------------------------------------------------------------------
// Additional event detection
// ---------------------------------------------------------------------------

/**
 * Detect secondary webhook events that should fire alongside a primary
 * `task.updated` event based on which fields changed.
 *
 * For example, when a task is reassigned, the handler fires `task.updated`
 * as the primary event and this function returns `["task.assigned"]` (or
 * `["task.unassigned"]`) so the dispatch layer can fire those as well.
 *
 * Only applies to `task.updated` — returns an empty array for all other
 * event types so callers don't need conditional logic.
 */
export function detectAdditionalEvents(
  event: WebhookEventType,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): WebhookEventType[] {
  if (event !== "task.updated") {
    return [];
  }

  const additional: WebhookEventType[] = [];

  // Assignee changes
  const prevAssignee = before.assigneeId ?? null;
  const nextAssignee = after.assigneeId ?? null;

  if (prevAssignee !== nextAssignee) {
    if (prevAssignee === null && nextAssignee !== null) {
      additional.push("task.assigned");
    } else if (prevAssignee !== null && nextAssignee === null) {
      additional.push("task.unassigned");
    } else {
      // Reassignment: unassigned old, assigned new
      additional.push("task.unassigned");
      additional.push("task.assigned");
    }
  }

  // Task moved between groups
  if (before.taskGroupId !== after.taskGroupId) {
    additional.push("task.moved");
  }

  return additional;
}

// ---------------------------------------------------------------------------
// Context fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch the workspace, optional project, and actor information needed to
 * populate the `WebhookContext` for a webhook payload envelope.
 *
 * Uses individual queries rather than a complex multi-table join because:
 * 1. Workspace is always required, project is optional — a single join
 *    would need a LEFT JOIN on project which complicates the query.
 * 2. These are primary-key lookups on small tables and are extremely fast.
 * 3. This function is called once per handler invocation (not per webhook),
 *    so the overhead of 2-3 fast PK lookups is negligible.
 *
 * Throws if the workspace or actor cannot be found — callers should only
 * invoke this after validating that the workspace and user exist (which
 * auth middleware already guarantees).
 */
export async function fetchWebhookContext(
  db: Database,
  opts: FetchWebhookContextOpts,
): Promise<WebhookContext> {
  // Fire workspace + actor queries in parallel; project is conditional
  const queries: [
    Promise<{ id: string; name: string; slug: string } | undefined>,
    Promise<{ id: string; name: string; email: string } | undefined>,
    Promise<{ id: string; name: string } | undefined>,
  ] = [
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      })
      .from(workspace)
      .where(eq(workspace.id, opts.workspaceId))
      .limit(1)
      .then((rows) => rows[0]),

    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .where(eq(user.id, opts.actorId))
      .limit(1)
      .then((rows) => rows[0]),

    opts.projectId
      ? db
          .select({
            id: project.id,
            name: project.name,
          })
          .from(project)
          .where(eq(project.id, opts.projectId))
          .limit(1)
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
  ];

  const [ws, actor, proj] = await Promise.all(queries);

  if (!ws) {
    throw new Error(
      `fetchWebhookContext: workspace "${opts.workspaceId}" not found`,
    );
  }
  if (!actor) {
    throw new Error(
      `fetchWebhookContext: actor (user) "${opts.actorId}" not found`,
    );
  }

  return {
    workspace: ws,
    project: proj,
    actor,
  };
}

// ---------------------------------------------------------------------------
// Fire-and-forget dispatch helper
// ---------------------------------------------------------------------------

interface WebhookEventDescriptor {
  event: WebhookEventType;
  data: Record<string, unknown>;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Non-blocking helper that fetches webhook context, builds payload envelopes,
 * and dispatches one or more webhook events for a workspace.
 *
 * Consolidates the repeated fetchWebhookContext → buildWebhookPayload →
 * dispatchWebhookEvent → catch pattern into a single call. The context query
 * runs once regardless of how many events are dispatched.
 */
export function fireWebhookEvent(
  db: Database,
  getExecutionCtx: () => ExecutionContext,
  contextOpts: FetchWebhookContextOpts,
  events: WebhookEventDescriptor[],
): void {
  let ctx: ExecutionContext;
  try {
    ctx = getExecutionCtx();
  } catch {
    // No ExecutionContext available (e.g. test environment) — skip webhook dispatch silently
    return;
  }
  console.log("[webhooks] Dispatching events:", events.map(e => e.event).join(", "), "for workspace:", contextOpts.workspaceId);
  ctx.waitUntil(
    fetchWebhookContext(db, contextOpts)
      .then((context) =>
        Promise.all(
          events.map(({ event, data, changes }) => {
            const payload = buildWebhookPayload(event, context, data, changes);
            return dispatchWebhookEvent(
              db,
              ctx,
              contextOpts.workspaceId,
              event,
              payload,
            );
          }),
        ),
      )
      .catch((err) => console.error("[webhooks] dispatch failed:", err)),
  );
}

/**
 * Convenience wrapper that extracts the workspace ID, database, and execution
 * context from a Hono handler context before dispatching webhook events.
 * No-ops silently when the workspace ID is unavailable (e.g. missing project context).
 */
export function dispatchWebhook(
  c: Context<AppEnv>,
  projectId: string,
  events: WebhookEventDescriptor[],
): void {
  const workspaceId = c.get("currentProject")?.workspaceId;
  if (!workspaceId) return;
  const db = c.get("db");
  const actorId = c.get("user")!.id;
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId, projectId }, events);
}
