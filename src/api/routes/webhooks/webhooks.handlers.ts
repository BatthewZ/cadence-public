import { and,desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { webhook, webhookDelivery } from "../../../db/schema/webhook";
import type { CreateWebhookInput, UpdateWebhookInput } from "../../../shared/schemas/webhook";
import type { AppEnv } from "../../env";
import {
  deliverWebhook,
  generateWebhookSecret,
  validateWebhookUrl,
} from "../../lib/webhooks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maximum number of webhooks allowed per workspace. */
const MAX_WEBHOOKS_PER_WORKSPACE = 20;

/** Check if the worker is running in local dev mode. */
function isDevMode(c: Context<AppEnv>): boolean {
  const authUrl = c.env.BETTER_AUTH_URL ?? "";
  return authUrl.includes("localhost") || authUrl.includes("127.0.0.1");
}

/**
 * Strip the `secret` field from a webhook row.
 *
 * Webhook secrets must only be exposed on creation or explicit regeneration
 * to avoid accidental leakage through list/detail endpoints.
 */
function omitSecret<T extends Record<string, unknown> & { secret: string }>(
  row: T,
): Omit<T, "secret"> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "secret"),
  ) as Omit<T, "secret">;
}

// ---------------------------------------------------------------------------
// createWebhook
// ---------------------------------------------------------------------------

export async function createWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId } = c.req.param();
  const body = c.req.valid("json" as never) as CreateWebhookInput;

  // Validate the target URL against SSRF rules (relaxed in dev mode for localhost testing)
  const urlValidation = validateWebhookUrl(body.url, { allowInsecure: isDevMode(c) });
  if (!urlValidation.valid) {
    return c.json({ error: urlValidation.error }, 400);
  }

  // Enforce per-workspace webhook limit
  const existing = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(eq(webhook.workspaceId, workspaceId));

  if (existing.length >= MAX_WEBHOOKS_PER_WORKSPACE) {
    return c.json(
      { error: `Maximum of ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks per workspace exceeded` },
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

  // Return the secret on creation — this is the only time it is exposed
  return c.json({ webhook: created }, 201);
}

// ---------------------------------------------------------------------------
// listWebhooks
// ---------------------------------------------------------------------------

export async function listWebhooks(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId } = c.req.param();

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
  const { workspaceId, webhookId } = c.req.param();

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
    return c.json({ error: "Webhook not found" }, 404);
  }

  return c.json({ webhook: omitSecret(row), deliveries });
}

// ---------------------------------------------------------------------------
// updateWebhook
// ---------------------------------------------------------------------------

export async function updateWebhook(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, webhookId } = c.req.param();
  const body = c.req.valid("json" as never) as UpdateWebhookInput;

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
    return c.json({ error: "Webhook not found" }, 404);
  }

  // If URL is being changed, re-validate it
  if (body.url !== undefined && body.url !== existing.url) {
    const urlValidation = validateWebhookUrl(body.url, { allowInsecure: isDevMode(c) });
    if (!urlValidation.valid) {
      return c.json({ error: urlValidation.error }, 400);
    }
  }

  const now = new Date();
  let newSecret: string | null = null;

  // Build update payload from only provided fields
  const updatePayload: Record<string, unknown> = { updatedAt: now };

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
  const { workspaceId, webhookId } = c.req.param();

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
    return c.json({ error: "Webhook not found" }, 404);
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
  const { workspaceId, webhookId } = c.req.param();

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
    return c.json({ error: "Webhook not found" }, 404);
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
