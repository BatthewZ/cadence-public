import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { webhook, webhookDelivery } from "../../../db/schema/webhook";
import { createWebhookSchema, updateWebhookSchema } from "../../../shared/schemas/webhook";
import {
  type WebhookEventType,
  WORKSPACE_SCOPED_EVENTS,
} from "../../../shared/types/webhook";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { requireParam } from "../../lib/params";
import { validJson } from "../../lib/validated";
import {
  deliverWebhook,
  generateWebhookSecret,
  isDevMode,
  MAX_WEBHOOKS_PER_WORKSPACE,
  omitSecret,
  validateWebhookUrl,
} from "../../lib/webhooks";

/**
 * Extract projectId and workspaceId from the request.
 *
 * The `requireProjectRole` middleware caches `currentProject` in context,
 * which contains the resolved workspaceId. This avoids an extra DB lookup.
 */
function getProjectContext(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  const currentProject = c.get("currentProject");
  if (!currentProject) {
    throw new Error("currentProject must be set by requireProjectRole middleware");
  }
  return { projectId, workspaceId: currentProject.workspaceId };
}

// ---------------------------------------------------------------------------
// listProjectWebhooks
// ---------------------------------------------------------------------------

export async function listProjectWebhooks(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = getProjectContext(c);

  const rows = await db
    .select()
    .from(webhook)
    .where(eq(webhook.projectId, projectId));

  return c.json({ webhooks: rows.map(omitSecret) });
}

// ---------------------------------------------------------------------------
// createProjectWebhook
// ---------------------------------------------------------------------------

export async function createProjectWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId, workspaceId } = getProjectContext(c);
  const body = validJson(c, createWebhookSchema);

  // Validate the target URL against SSRF rules
  const urlValidation = validateWebhookUrl(body.url, {
    allowInsecure: isDevMode(c),
  });
  if (!urlValidation.valid) {
    return errorResponse(c, urlValidation.error, 400);
  }

  // Reject workspace-scoped events — project webhooks only handle project events
  if (body.events.some((e) => WORKSPACE_SCOPED_EVENTS.has(e))) {
    return errorResponse(
      c,
      "Project-scoped webhooks cannot subscribe to workspace or invitation events",
      400,
    );
  }

  // Enforce per-workspace webhook limit
  const existing = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(eq(webhook.workspaceId, workspaceId));

  if (existing.length >= MAX_WEBHOOKS_PER_WORKSPACE) {
    return errorResponse(
      c,
      `Maximum of ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks per workspace exceeded`,
      409,
    );
  }

  const id = crypto.randomUUID();
  const secret = generateWebhookSecret();
  const now = new Date();

  const [created] = await db
    .insert(webhook)
    .values({
      id,
      workspaceId,
      projectId,
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

  return c.json({ webhook: created }, 201);
}

// ---------------------------------------------------------------------------
// getProjectWebhook
// ---------------------------------------------------------------------------

export async function getProjectWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = getProjectContext(c);
  const webhookId = requireParam(c, "webhookId");

  const [webhookRows, deliveries] = await db.batch([
    db
      .select()
      .from(webhook)
      .where(
        and(eq(webhook.id, webhookId), eq(webhook.projectId, projectId)),
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
// updateProjectWebhook
// ---------------------------------------------------------------------------

export async function updateProjectWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = getProjectContext(c);
  const webhookId = requireParam(c, "webhookId");
  const body = validJson(c, updateWebhookSchema);

  const [existing] = await db
    .select()
    .from(webhook)
    .where(
      and(eq(webhook.id, webhookId), eq(webhook.projectId, projectId)),
    )
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Webhook not found", 404);
  }

  // Re-validate URL if changed
  if (body.url !== undefined && body.url !== existing.url) {
    const urlValidation = validateWebhookUrl(body.url, {
      allowInsecure: isDevMode(c),
    });
    if (!urlValidation.valid) {
      return errorResponse(c, urlValidation.error, 400);
    }
  }

  // Block workspace-scoped events
  const effectiveEvents: WebhookEventType[] =
    body.events ?? (JSON.parse(existing.events) as WebhookEventType[]);
  if (effectiveEvents.some((e) => WORKSPACE_SCOPED_EVENTS.has(e))) {
    return errorResponse(
      c,
      "Project-scoped webhooks cannot subscribe to workspace or invitation events",
      400,
    );
  }

  const now = new Date();
  let newSecret: string | null = null;

  const updatePayload: Record<string, unknown> = { updatedAt: now };
  // projectId is never changed via this endpoint — it's implicit
  if (body.name !== undefined) updatePayload.name = body.name;
  if (body.url !== undefined) updatePayload.url = body.url;
  if (body.events !== undefined)
    updatePayload.events = JSON.stringify(body.events);
  if (body.active !== undefined) {
    updatePayload.active = body.active;
    if (body.active && !existing.active) updatePayload.consecutiveFailures = 0;
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

  if (newSecret) {
    return c.json({ webhook: updated });
  }
  return c.json({ webhook: omitSecret(updated) });
}

// ---------------------------------------------------------------------------
// deleteProjectWebhook
// ---------------------------------------------------------------------------

export async function deleteProjectWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = getProjectContext(c);
  const webhookId = requireParam(c, "webhookId");

  const [existing] = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(eq(webhook.id, webhookId), eq(webhook.projectId, projectId)),
    )
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Webhook not found", 404);
  }

  await db.delete(webhook).where(eq(webhook.id, webhookId));
  return c.body(null, 204);
}

// ---------------------------------------------------------------------------
// testProjectWebhook
// ---------------------------------------------------------------------------

export async function testProjectWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = getProjectContext(c);
  const webhookId = requireParam(c, "webhookId");

  const [row] = await db
    .select()
    .from(webhook)
    .where(
      and(eq(webhook.id, webhookId), eq(webhook.projectId, projectId)),
    )
    .limit(1);

  if (!row) {
    return errorResponse(c, "Webhook not found", 404);
  }

  const deliveryId = crypto.randomUUID();
  const testPayload: Record<string, unknown> = {
    event: "webhook.test",
    timestamp: new Date().toISOString(),
    workspace: { id: row.workspaceId },
    project: { id: projectId },
    data: { message: "This is a test webhook delivery" },
  };

  await deliverWebhook(
    db,
    row,
    deliveryId,
    "webhook.test" as never,
    testPayload,
  );

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
