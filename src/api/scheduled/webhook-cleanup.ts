import { and, lt, notInArray, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { webhookDelivery } from "../../db/schema/webhook";

/** Maximum age for webhook delivery records (30 days). */
const RETENTION_DAYS = 30;

/**
 * Maximum number of delivery records to keep per webhook.
 *
 * Webhooks with more deliveries than this will have the oldest records pruned
 * even if they are within the 30-day retention window. This prevents a single
 * high-traffic webhook from accumulating unbounded history.
 */
const MAX_DELIVERIES_PER_WEBHOOK = 200;

/**
 * Batch size for delete operations to keep CPU usage within Cloudflare Workers
 * free-tier limits. Each batch deletes up to this many rows.
 */
const DELETE_BATCH_SIZE = 100;

/**
 * Clean up old webhook delivery records.
 *
 * Applies two retention policies:
 * 1. **Time-based retention** -- Delete all deliveries older than 30 days.
 * 2. **Per-webhook cap** -- For webhooks with more than 200 deliveries, delete
 *    the oldest records beyond the cap.
 *
 * This keeps the `webhook_delivery` table bounded so that D1 storage and query
 * performance remain healthy without requiring manual intervention.
 *
 * @returns Total number of records deleted across both policies.
 */
export async function cleanupWebhookDeliveries(db: Database): Promise<number> {
  let totalDeleted = 0;

  // -------------------------------------------------------------------------
  // Policy 1: Delete deliveries older than 30 days
  // -------------------------------------------------------------------------
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Batch the deletes to stay within CPU budget
    let batchDeleted: number;
    do {
      // Select IDs to delete in this batch
      const oldRows = await db
        .select({ id: webhookDelivery.id })
        .from(webhookDelivery)
        .where(lt(webhookDelivery.createdAt, cutoff))
        .limit(DELETE_BATCH_SIZE);

      if (oldRows.length === 0) break;

      const idsToDelete = oldRows.map((r) => r.id);
      await db
        .delete(webhookDelivery)
        .where(
          sql`${webhookDelivery.id} IN (${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchDeleted = oldRows.length;
      totalDeleted += batchDeleted;
    } while (batchDeleted === DELETE_BATCH_SIZE);
  } catch (error) {
    console.error("[webhook-cleanup] Failed to delete old deliveries", error);
  }

  // -------------------------------------------------------------------------
  // Policy 2: Per-webhook cap — keep only the most recent 200 per webhook
  // -------------------------------------------------------------------------
  try {
    // Find webhooks that have more than MAX_DELIVERIES_PER_WEBHOOK rows.
    // We use a grouped count to identify offenders.
    const overflowWebhooks = await db
      .select({
        webhookId: webhookDelivery.webhookId,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(webhookDelivery)
      .groupBy(webhookDelivery.webhookId)
      .having(sql`count(*) > ${MAX_DELIVERIES_PER_WEBHOOK}`);

    for (const { webhookId, count } of overflowWebhooks) {
      const excess = count - MAX_DELIVERIES_PER_WEBHOOK;
      if (excess <= 0) continue;

      // Find the IDs of the most recent deliveries to keep.
      // We select the top MAX_DELIVERIES_PER_WEBHOOK by createdAt DESC, then
      // delete everything else for this webhook.
      const keepRows = await db
        .select({ id: webhookDelivery.id })
        .from(webhookDelivery)
        .where(sql`${webhookDelivery.webhookId} = ${webhookId}`)
        .orderBy(sql`${webhookDelivery.createdAt} DESC`)
        .limit(MAX_DELIVERIES_PER_WEBHOOK);

      const keepIds = keepRows.map((r) => r.id);

      if (keepIds.length === 0) continue;

      // Delete all deliveries for this webhook that are NOT in the keep set.
      // Batch this as well for safety.
      let batchDeleted: number;
      do {
        const excessRows = await db
          .select({ id: webhookDelivery.id })
          .from(webhookDelivery)
          .where(
            and(
              sql`${webhookDelivery.webhookId} = ${webhookId}`,
              notInArray(webhookDelivery.id, keepIds),
            ),
          )
          .limit(DELETE_BATCH_SIZE);

        if (excessRows.length === 0) break;

        const idsToDelete = excessRows.map((r) => r.id);
        await db
          .delete(webhookDelivery)
          .where(
            sql`${webhookDelivery.id} IN (${sql.join(
              idsToDelete.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );

        batchDeleted = excessRows.length;
        totalDeleted += batchDeleted;
      } while (batchDeleted === DELETE_BATCH_SIZE);
    }
  } catch (error) {
    console.error(
      "[webhook-cleanup] Failed to enforce per-webhook delivery cap",
      error,
    );
  }

  return totalDeleted;
}
