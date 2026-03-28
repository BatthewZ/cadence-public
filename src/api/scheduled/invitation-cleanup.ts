import { and, eq, lt, ne, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { invitation } from "../../db/schema/invitation";

/**
 * Grace period (in days) before expired pending invitations are removed.
 *
 * Pending invitations that have passed their `expiresAt` are kept for this
 * many additional days so that workspace admins and invitees can still see the
 * expired state in the UI before the record disappears.
 */
const PENDING_GRACE_DAYS = 7;

/**
 * Batch size for delete operations to keep CPU usage within Cloudflare Workers
 * free-tier limits. Each batch deletes up to this many rows.
 */
const DELETE_BATCH_SIZE = 100;

/**
 * Clean up expired invitation records.
 *
 * Invitations have an `expiresAt` timestamp and a `status` field (`pending`,
 * `accepted`, `expired`, `revoked`) but are never automatically removed after
 * they reach a terminal state. Over time this causes unbounded growth in the
 * `invitation` table.
 *
 * Applies two retention policies:
 * 1. **Non-pending expired** -- Delete invitations with status `accepted`,
 *    `expired`, or `revoked` whose `expiresAt` is in the past. These have
 *    already been acted upon and serve no further purpose.
 * 2. **Pending expired with grace period** -- Delete `pending` invitations
 *    whose `expiresAt` is more than 7 days in the past. The grace period
 *    allows users to see the expired state before the record is removed.
 *
 * Each policy is independent — a failure in one does not prevent the other
 * from running. Deletes are batched at {@link DELETE_BATCH_SIZE} rows to stay
 * within Cloudflare Workers free-tier CPU limits.
 *
 * @returns Total number of invitation records deleted.
 */
export async function cleanupInvitations(db: Database): Promise<number> {
  let totalDeleted = 0;

  // ---------------------------------------------------------------------------
  // Policy 1: Delete non-pending invitations past expiresAt
  // ---------------------------------------------------------------------------
  try {
    const now = new Date();

    let batchDeleted: number;
    do {
      const oldRows = await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            ne(invitation.status, "pending"),
            lt(invitation.expiresAt, now),
          ),
        )
        .limit(DELETE_BATCH_SIZE);

      if (oldRows.length === 0) break;

      const idsToDelete = oldRows.map((r) => r.id);
      await db
        .delete(invitation)
        .where(
          sql`${invitation.id} IN (${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchDeleted = oldRows.length;
      totalDeleted += batchDeleted;
    } while (batchDeleted === DELETE_BATCH_SIZE);
  } catch (error) {
    console.error(
      "[invitation-cleanup] Failed to delete non-pending expired invitations",
      error,
    );
  }

  // ---------------------------------------------------------------------------
  // Policy 2: Delete pending invitations expired more than 7 days ago
  // ---------------------------------------------------------------------------
  try {
    const graceCutoff = new Date(
      Date.now() - PENDING_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    let batchDeleted: number;
    do {
      const oldRows = await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.status, "pending"),
            lt(invitation.expiresAt, graceCutoff),
          ),
        )
        .limit(DELETE_BATCH_SIZE);

      if (oldRows.length === 0) break;

      const idsToDelete = oldRows.map((r) => r.id);
      await db
        .delete(invitation)
        .where(
          sql`${invitation.id} IN (${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchDeleted = oldRows.length;
      totalDeleted += batchDeleted;
    } while (batchDeleted === DELETE_BATCH_SIZE);
  } catch (error) {
    console.error(
      "[invitation-cleanup] Failed to delete expired pending invitations",
      error,
    );
  }

  return totalDeleted;
}
