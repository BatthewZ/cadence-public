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

// ---------------------------------------------------------------------------
// createWebhook
// ---------------------------------------------------------------------------

export async function createWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createWebhookSchema);

  // Validate the target URL against SSRF rules (relaxed in dev mode for localhost testing)
  const urlValidation = validateWebhookUrl(body.url, { allowInsecure: isDevMode(c) });
  if (!urlValidation.valid) {
    return errorResponse(c, urlValidation.error, 400);
  }

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

export async function listWebhooks(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  const rows = await db
    .select()
    .from(webhook)
    .where(eq(webhook.workspaceId, workspaceId));

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

  // If URL is being changed, re-validate it
  if (body.url !== undefined && body.url !== existing.url) {
    const urlValidation = validateWebhookUrl(body.url, { allowInsecure: isDevMode(c) });
    if (!urlValidation.valid) {
      return errorResponse(c, urlValidation.error, 400);
    }
  }

  // Validate projectId if being changed
  if (body.projectId !== undefined && body.projectId !== null) {
    if (!(await projectBelongsToWorkspace(db, body.projectId, workspaceId))) {
      return errorResponse(c, "Project not found in this workspace", 400);
    }
  }

  // Cross-validate: project-scoped webhooks cannot have workspace-scoped events
  const effectiveProjectId =
    body.projectId !== undefined ? body.projectId : existing.projectId;
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

  const [existing] = await db
    .select({ id: webhook.id })
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
