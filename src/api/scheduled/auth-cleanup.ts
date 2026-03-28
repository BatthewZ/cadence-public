import { lt, sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import type { Database } from "../../db";
import { session, verification } from "../../db/schema/auth";

/**
 * Batch size for delete operations to keep CPU usage within Cloudflare Workers
 * free-tier limits. Each batch deletes up to this many rows.
 */
const DELETE_BATCH_SIZE = 100;

/**
 * Delete expired rows from a table that has `id` and `expiresAt` columns.
 *
 * Selects and deletes in batches of {@link DELETE_BATCH_SIZE} to keep
 * CPU usage within Cloudflare Workers free-tier limits.
 *
 * @returns Number of expired records deleted.
 */
async function batchDeleteExpired(
  db: Database,
  table: SQLiteTable,
  idColumn: SQLiteColumn,
  expiresAtColumn: SQLiteColumn,
  label: string,
): Promise<number> {
  let totalDeleted = 0;

  try {
    const now = new Date();
    let batchDeleted: number;

    do {
      const expiredRows = await db
        .select({ id: idColumn })
        .from(table)
        .where(lt(expiresAtColumn, now))
        .limit(DELETE_BATCH_SIZE);

      if (expiredRows.length === 0) break;

      const idsToDelete = expiredRows.map((r) => r.id);
      await db
        .delete(table)
        .where(
          sql`${idColumn} IN (${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchDeleted = expiredRows.length;
      totalDeleted += batchDeleted;
    } while (batchDeleted === DELETE_BATCH_SIZE);
  } catch (error) {
    console.error(`[auth-cleanup] Failed to delete expired ${label}`, error);
  }

  return totalDeleted;
}

/**
 * Clean up expired auth records (sessions and verification tokens).
 *
 * Better Auth sets an `expiresAt` timestamp on every session (default 7 days)
 * and checks it at query time, but never removes the row. Similarly,
 * verification tokens for email verification and password reset flows are
 * created by Better Auth but abandoned tokens are never cleaned up.
 *
 * This function prunes both tables in batches to keep them bounded and D1
 * storage healthy. Each cleanup is independent — a failure in one does not
 * prevent the other from running.
 *
 * @returns Total number of expired auth records deleted.
 */
export async function cleanupAuthTables(db: Database): Promise<number> {
  const sessions = await batchDeleteExpired(
    db,
    session,
    session.id,
    session.expiresAt,
    "sessions",
  );
  const verifications = await batchDeleteExpired(
    db,
    verification,
    verification.id,
    verification.expiresAt,
    "verification tokens",
  );
  return sessions + verifications;
}
