import { and,desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../../db";
import { project } from "../../../db/schema/project";
import { webhook, webhookDelivery } from "../../../db/schema/webhook";
import { createWebhookSchema, updateWebhookSchema } from "../../../shared/schemas/webhook";
import { type WebhookEventType, WORKSPACE_SCOPED_EVENTS } from "../../../shared/types/webhook";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import {
  deliverWebhook,
  generateWebhookSecret,
  isDevMode,
  MAX_WEBHOOKS_PER_WORKSPACE,
  omitSecret,
  scheduleWebhookCreatedEmail,
  validateWebhookUrl,
} from "../../lib/webhooks";
import {
  enforceTokenProjectBinding,
  enforceTokenWorkspaceWideAccess,
  tokenProjectScopeFilter,
} from "../../middleware/authorize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify that a project belongs to the given workspace.
 * Returns true if the project exists in the workspace, false otherwise.
 */
async function projectBelongsToWorkspace(
  db: Database,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const [proj] = await db
    .select({ id: project.id })
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return !!proj;
}

/**
 * Enforce the caller's PAT project binding against a webhook's target scope.
 *
 * A webhook is a **standing egress pipe**: once registered it streams event
 * payloads — task titles, descriptions, assignees, comment bodies — to an
 * arbitrary URL for as long as it exists, with no further authentication of
 * the original caller. That makes it the single most consequential thing a
 * narrowed token can create, and the reason it needs its own binding rule
 * rather than inheriting the generic workspace-role guard on these routes:
 * `projectBelongsToWorkspace` above answers only "is this project in this
 * workspace?", which every sibling project the token was denied also satisfies.
 *
 * The rule has two branches because a webhook's scope has two shapes:
 *
 *  - **`projectId` set** — a project-scoped subscription. Delegates to
 *    {@link enforceTokenProjectBinding}, the same predicate every project route
 *    uses, so "may this token act on project X?" has exactly one answer in the
 *    codebase (CLAUDE.md rule 4).
 *  - **`projectId` null** — a workspace-wide subscription, which receives
 *    `task.*` events from EVERY project in the workspace. There is no partial
 *    version of that, so a project-narrowed token is refused outright via
 *    {@link enforceTokenWorkspaceWideAccess}. Without this branch the fix would
 *    be trivially bypassable: denied project P2 directly, a token would simply
 *    register a null-project webhook and receive P2's events anyway.
 *
 * Cookie sessions and `projectScope: "all"` tokens pass both branches
 * unchanged. Read paths call this too — a webhook row carries its target URL,
 * event list and failure state, all of which describe how a project outside
 * the token's list is wired up.
 */
function enforceTokenWebhookBinding(
  c: Context<AppEnv>,
  workspaceId: string,
  projectId: string | null,
): Response | null {
  if (projectId === null) return enforceTokenWorkspaceWideAccess(c);
  return enforceTokenProjectBinding(c, { id: projectId, workspaceId });
}

// ---------------------------------------------------------------------------
// createWebhook
// ---------------------------------------------------------------------------

/**
 * `POST /workspaces/:workspaceId/webhooks`
 *
 * Registers a webhook subscription and returns its signing secret exactly once.
 *
 * Guard order is deliberate and must not be rearranged: SSRF URL validation,
 * then the PAT binding (403), then "is this project in this workspace?" (400),
 * then the per-workspace limit.
 *
 * The PAT binding comes BEFORE the existence check specifically to close an
 * existence oracle. Run the other way round, a narrowed token learns which
 * project ids are real: an id that exists in the workspace but is off its list
 * answers `403`, while an unknown id answers `400 Project not found in this
 * workspace`. Checking the binding first collapses both to the same `403`,
 * because an unknown id is off-list too. That is the uniform-denial property
 * `enforceTokenProjectBinding` documents, and this is the one call site where
 * the order of two *body*-driven checks decides whether it holds. Cookie
 * sessions and `all`-scope tokens pass the binding unconditionally, so they
 * still get the more useful `400` for a bad id.
 */
export async function createWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createWebhookSchema);

  // Validate the target URL against SSRF rules (relaxed in dev mode for localhost testing)
  const urlValidation = validateWebhookUrl(body.url, { allowInsecure: isDevMode(c) });
  if (!urlValidation.valid) {
    return errorResponse(c, urlValidation.error, 400);
  }

  // PAT binding: a narrowed token may only subscribe to a project on its list,
  // and may not open a workspace-wide subscription at all. Before the
  // existence check — see the jsdoc for why the order is the security property.
  const denied = enforceTokenWebhookBinding(c, workspaceId, body.projectId ?? null);
  if (denied) return denied;

  // Validate projectId belongs to this workspace
  if (body.projectId) {
    if (!(await projectBelongsToWorkspace(db, body.projectId, workspaceId))) {
      return errorResponse(c, "Project not found in this workspace", 400);
    }
  }

  // Enforce per-workspace webhook limit
  const existing = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(eq(webhook.workspaceId, workspaceId));

  if (existing.length >= MAX_WEBHOOKS_PER_WORKSPACE) {
    return errorResponse(c, `Maximum of ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks per workspace exceeded`, 409);
  }

  const id = crypto.randomUUID();
  const secret = generateWebhookSecret();
  const now = new Date();

  const [created] = await db
    .insert(webhook)
    .values({
      id,
      workspaceId,
      projectId: body.projectId ?? null,
      name: body.name,
      url: body.url,
      secret,
      events: JSON.stringify(body.events),
      active: true,
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Out-of-band security email. Webhooks are exfiltration pipes by design,
  // so an unexpected registration is a high-signal indicator that a
  // session or PAT may be compromised. We notify the actor so they can
  // cross-check against their integration inventory. Deferred so a slow
  // email provider never blocks the API response.
  scheduleWebhookCreatedEmail(c, {
    workspaceId,
    webhookName: created.name,
    webhookUrl: created.url,
    events: body.events,
    projectId: created.projectId,
    createdAt: created.createdAt,
  });

  // Return the secret on creation — this is the only time it is exposed
  return c.json({ webhook: created }, 201);
}

// ---------------------------------------------------------------------------
// listWebhooks
// ---------------------------------------------------------------------------

/**
 * `GET /workspaces/:workspaceId/webhooks`
 *
 * Lists the workspace's webhooks with secrets stripped.
 *
 * For a project-narrowed PAT the list is filtered to webhooks targeting a
 * project on its list. Note what the filter does with `projectId IS NULL`
 * rows: `inArray` never matches NULL, so workspace-wide webhooks drop out
 * automatically — which is the correct outcome and not an accident of SQL.
 * A workspace-wide webhook's URL and event list describe an egress path
 * carrying every project's events, so it is not the narrowed token's to see,
 * exactly as it is not the narrowed token's to create.
 */
export async function listWebhooks(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  const rows = await db
    .select()
    .from(webhook)
    .where(
      and(
        eq(webhook.workspaceId, workspaceId),
        tokenProjectScopeFilter(c, webhook.projectId),
      ),
    );

  return c.json({ webhooks: rows.map(omitSecret) });
}

// ---------------------------------------------------------------------------
// getWebhook
// ---------------------------------------------------------------------------

export async function getWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, webhookId } = requireParams(c, "workspaceId", "webhookId");

  // Fetch webhook and recent deliveries in a single DB round-trip.
  // The two queries are independent so we batch them to cut latency.
  const [webhookRows, deliveries] = await db.batch([
    db
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.id, webhookId),
          eq(webhook.workspaceId, workspaceId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.webhookId, webhookId))
      .orderBy(desc(webhookDelivery.createdAt))
      .limit(20),
  ] as const);

  const row = webhookRows[0];

  if (!row) {
    return errorResponse(c, "Webhook not found", 404);
  }

  // PAT binding — the delivery history below echoes response bodies from the
  // subscriber, so an out-of-scope webhook is a read of another project.
  const denied = enforceTokenWebhookBinding(c, workspaceId, row.projectId);
  if (denied) return denied;

  return c.json({ webhook: omitSecret(row), deliveries });
}

// ---------------------------------------------------------------------------
// updateWebhook
// ---------------------------------------------------------------------------

export async function updateWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, webhookId } = requireParams(c, "workspaceId", "webhookId");
  const body = validJson(c, updateWebhookSchema);

  const [existing] = await db
    .select()
    .from(webhook)
    .where(
      and(
        eq(webhook.id, webhookId),
        eq(webhook.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Webhook not found", 404);
  }

  // PAT binding on the webhook's CURRENT target: a token that may not read a
  // webhook must not be able to repoint, rename, re-enable or re-secret it.
  const deniedCurrent = enforceTokenWebhookBinding(c, workspaceId, existing.projectId);
  if (deniedCurrent) return deniedCurrent;

  // If URL is being changed, re-validate it
  if (body.url !== undefined && body.url !== existing.url) {
    const urlValidation = validateWebhookUrl(body.url, { allowInsecure: isDevMode(c) });
    if (!urlValidation.valid) {
      return errorResponse(c, urlValidation.error, 400);
    }
  }

  const effectiveProjectId =
    body.projectId !== undefined ? body.projectId : existing.projectId;

  // PAT binding on the webhook's NEW target. Checked separately from the
  // current target because the two differ precisely in the attack that
  // matters: a token allowed to edit its own project's webhook must not be
  // able to widen it to a sibling project, or to `null` (workspace-wide) —
  // and, in the other direction, must not be able to seize a SIBLING's webhook
  // by repointing it onto its own list (which the current-target check above
  // is what stops). Placed before the existence check below for the same
  // no-oracle reason as `createWebhook`.
  const deniedNext = enforceTokenWebhookBinding(c, workspaceId, effectiveProjectId);
  if (deniedNext) return deniedNext;

  // Validate projectId if being changed
  if (body.projectId !== undefined && body.projectId !== null) {
    if (!(await projectBelongsToWorkspace(db, body.projectId, workspaceId))) {
      return errorResponse(c, "Project not found in this workspace", 400);
    }
  }

  // Cross-validate: project-scoped webhooks cannot have workspace-scoped events
  if (effectiveProjectId) {
    const effectiveEvents: WebhookEventType[] = body.events ?? (JSON.parse(existing.events) as WebhookEventType[]);
    if (effectiveEvents.some((e) => WORKSPACE_SCOPED_EVENTS.has(e))) {
      return errorResponse(
        c,
        "Project-scoped webhooks cannot subscribe to workspace or invitation events",
        400,
      );
    }
  }

  const now = new Date();
  let newSecret: string | null = null;

  // Build update payload from only provided fields
  const updatePayload: Record<string, unknown> = { updatedAt: now };

  if (body.projectId !== undefined) {
    updatePayload.projectId = body.projectId;
  }
  if (body.name !== undefined) {
    updatePayload.name = body.name;
  }
  if (body.url !== undefined) {
    updatePayload.url = body.url;
  }
  if (body.events !== undefined) {
    updatePayload.events = JSON.stringify(body.events);
  }
  if (body.active !== undefined) {
    updatePayload.active = body.active;
    // Reset consecutive failures when re-enabling
    if (body.active && !existing.active) {
      updatePayload.consecutiveFailures = 0;
    }
  }
  if (body.regenerateSecret) {
    newSecret = generateWebhookSecret();
    updatePayload.secret = newSecret;
  }

  const [updated] = await db
    .update(webhook)
    .set(updatePayload)
    .where(eq(webhook.id, webhookId))
    .returning();

  // Expose the secret only when it was explicitly regenerated
  if (newSecret) {
    return c.json({ webhook: updated });
  }

  return c.json({ webhook: omitSecret(updated) });
}

// ---------------------------------------------------------------------------
// deleteWebhook
// ---------------------------------------------------------------------------

export async function deleteWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, webhookId } = requireParams(c, "workspaceId", "webhookId");

  // `projectId` is selected purely so the PAT binding below can be evaluated
  // without a second round-trip.
  const [existing] = await db
    .select({ id: webhook.id, projectId: webhook.projectId })
    .from(webhook)
    .where(
      and(
        eq(webhook.id, webhookId),
        eq(webhook.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Webhook not found", 404);
  }

  // PAT binding — deleting another project's webhook is a denial-of-service on
  // that project's integrations, so it is bound the same way reads are.
  const denied = enforceTokenWebhookBinding(c, workspaceId, existing.projectId);
  if (denied) return denied;

  // Cascade delete handles associated webhook_delivery rows
  await db.delete(webhook).where(eq(webhook.id, webhookId));

  return c.body(null, 204);
}

// ---------------------------------------------------------------------------
// testWebhook
// ---------------------------------------------------------------------------

export async function testWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, webhookId } = requireParams(c, "workspaceId", "webhookId");

  const [row] = await db
    .select()
    .from(webhook)
    .where(
      and(
        eq(webhook.id, webhookId),
        eq(webhook.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!row) {
    return errorResponse(c, "Webhook not found", 404);
  }

  // PAT binding — `/test` fires a real signed delivery to the registered URL,
  // so it is a write against the subscriber for a project the token may not
  // hold, and it confirms that project's endpoint is live.
  const denied = enforceTokenWebhookBinding(c, workspaceId, row.projectId);
  if (denied) return denied;

  const deliveryId = crypto.randomUUID();
  const testPayload: Record<string, unknown> = {
    event: "webhook.test",
    timestamp: new Date().toISOString(),
    workspace: { id: workspaceId },
    data: { message: "This is a test webhook delivery" },
  };

  // Deliver synchronously so we can return the result to the caller
  await deliverWebhook(db, row, deliveryId, "webhook.test" as never, testPayload);

  // Fetch the delivery record created by deliverWebhook
  const [delivery] = await db
    .select()
    .from(webhookDelivery)
    .where(eq(webhookDelivery.id, deliveryId))
    .limit(1);

  return c.json({
    delivery: delivery
      ? {
          id: delivery.id,
          success: delivery.success,
          statusCode: delivery.statusCode,
          response: delivery.response,
        }
      : null,
  });
}
