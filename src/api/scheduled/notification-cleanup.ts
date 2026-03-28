import { and, eq, lt, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { notification } from "../../db/schema/notification";

/** Delete read notifications older than this many days. */
const READ_RETENTION_DAYS = 30;

/** Delete unread notifications older than this many days. */
const UNREAD_RETENTION_DAYS = 90;

/**
 * Batch size for delete operations to keep CPU usage within Cloudflare Workers
 * free-tier limits. Each batch deletes up to this many rows.
 */
const DELETE_BATCH_SIZE = 100;

/**
 * Clean up old notification records.
 *
 * Notifications are created for task assignments, comments, invitations, and
 * other collaborative events but are never automatically removed. Over time
 * this causes unbounded growth in the `notification` table.
 *
 * Applies two retention policies:
 * 1. **Read retention** -- Delete notifications the user has already read that
 *    are older than 30 days. The user has seen them so they have no further
 *    value.
 * 2. **Unread retention** -- Delete unread notifications older than 90 days.
 *    At this age they are stale and unlikely to be actionable.
 *
 * Each policy is independent — a failure in one does not prevent the other
 * from running. Deletes are batched at {@link DELETE_BATCH_SIZE} rows to stay
 * within Cloudflare Workers free-tier CPU limits.
 *
 * @returns Total number of notification records deleted.
 */
export async function cleanupNotifications(db: Database): Promise<number> {
  let totalDeleted = 0;

  // ---------------------------------------------------------------------------
  // Policy 1: Delete read notifications older than 30 days
  // ---------------------------------------------------------------------------
  try {
    const readCutoff = new Date(
      Date.now() - READ_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    let batchDeleted: number;
    do {
      const oldRows = await db
        .select({ id: notification.id })
        .from(notification)
        .where(
          and(
            eq(notification.read, true),
            lt(notification.createdAt, readCutoff),
          ),
        )
        .limit(DELETE_BATCH_SIZE);

      if (oldRows.length === 0) break;

      const idsToDelete = oldRows.map((r) => r.id);
      await db
        .delete(notification)
        .where(
          sql`${notification.id} IN (${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchDeleted = oldRows.length;
      totalDeleted += batchDeleted;
    } while (batchDeleted === DELETE_BATCH_SIZE);
  } catch (error) {
    console.error(
      "[notification-cleanup] Failed to delete old read notifications",
      error,
    );
  }

  // ---------------------------------------------------------------------------
  // Policy 2: Delete unread notifications older than 90 days
  // ---------------------------------------------------------------------------
  try {
    const unreadCutoff = new Date(
      Date.now() - UNREAD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    let batchDeleted: number;
    do {
      const oldRows = await db
        .select({ id: notification.id })
        .from(notification)
        .where(
          and(
            eq(notification.read, false),
            lt(notification.createdAt, unreadCutoff),
          ),
        )
        .limit(DELETE_BATCH_SIZE);

      if (oldRows.length === 0) break;

      const idsToDelete = oldRows.map((r) => r.id);
      await db
        .delete(notification)
        .where(
          sql`${notification.id} IN (${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchDeleted = oldRows.length;
      totalDeleted += batchDeleted;
    } while (batchDeleted === DELETE_BATCH_SIZE);
  } catch (error) {
    console.error(
      "[notification-cleanup] Failed to delete old unread notifications",
      error,
    );
  }

  return totalDeleted;
}
