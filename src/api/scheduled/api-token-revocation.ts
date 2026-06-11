import { and, isNull, lte, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { apiToken } from "../../db/schema/api-token";

/**
 * Batch size for the revocation sweep. Sized to match the other scheduled
 * cleanup tasks ({@link cleanupInvitations}, {@link cleanupNotifications})
 * so the entire cron run stays within Cloudflare Workers' free-tier CPU
 * budget even when several backlogs land in the same tick.
 */
const REVOKE_BATCH_SIZE = 100;

/**
 * Finalise scheduled API token revocations.
 *
 * The rotation flow (POST `/api/workspaces/:workspaceId/api-tokens/:id/rotate`)
 * does not immediately revoke the old token — it sets `revokeAt = now + 7d`
 * so live integrations have a grace window to swap secrets before the old
 * plaintext stops working. This task is the only thing that turns that
 * scheduled revocation into a final `revokedAt` timestamp.
 *
 * ## Why this exists as its own task
 *
 * Inlining the revocation into the rotation handler would either (a) delay
 * the HTTP response by 7 days (obviously absurd) or (b) require a separate
 * "in 7 days" worker queue we don't currently operate. A scheduled-handler
 * sweep is the cheapest, most auditable model that matches our existing
 * pattern for retention-style cleanup ({@link cleanupInvitations},
 * {@link cleanupWebhookDeliveries}). Each tick we look for any token whose
 * `revokeAt` has passed and stamp it revoked.
 *
 * ## Why we re-check `revokedAt IS NULL` in the WHERE
 *
 * The same row may have been manually revoked by the owner between the
 * rotation and the sweep (e.g. they noticed a leak and pressed the revoke
 * button). Writing `revokedAt = now` again would silently move the
 * revocation timestamp forward, breaking the audit trail. The `IS NULL`
 * predicate ensures we only stamp tokens that have not already been
 * tombstoned.
 *
 * ## Failure isolation
 *
 * The function never throws — any SQL error is caught, logged, and
 * surfaced via the returned count (0). The caller in
 * [src/api/scheduled/index.ts](./index.ts) wraps every task in `runTask`
 * which also catches, so this is double-belt-and-braces: a corrupt index
 * here must not block webhook retries, auth cleanup, or any sibling task.
 *
 * @returns Number of tokens revoked in this run (for telemetry / logging).
 */
export async function processScheduledTokenRevocations(
  db: Database,
): Promise<number> {
  const now = new Date();
  let totalRevoked = 0;

  try {
    let batchRevoked: number;
    do {
      const dueRows = await db
        .select({ id: apiToken.id })
        .from(apiToken)
        .where(
          and(
            // `lte` so a token whose revokeAt exactly equals now still
            // qualifies — there is no value in waiting another 5 minutes.
            lte(apiToken.revokeAt, now),
            isNull(apiToken.revokedAt),
          ),
        )
        .limit(REVOKE_BATCH_SIZE);

      if (dueRows.length === 0) break;

      const ids = dueRows.map((r) => r.id);
      // Single UPDATE per batch (not per row) — D1 round-trip count is the
      // dominant cost. The `IN (...)` list is bounded by REVOKE_BATCH_SIZE
      // so we never exceed the SQLite parameter limit.
      await db
        .update(apiToken)
        .set({ revokedAt: now })
        .where(
          sql`${apiToken.id} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchRevoked = dueRows.length;
      totalRevoked += batchRevoked;
    } while (batchRevoked === REVOKE_BATCH_SIZE);
  } catch (error) {
    console.error(
      "[api-token-revocation] Failed to process scheduled revocations",
      error,
    );
  }

  return totalRevoked;
}
