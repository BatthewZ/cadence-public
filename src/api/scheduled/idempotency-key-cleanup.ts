import { lt, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { idempotencyKey } from "../../db/schema/idempotency-key";
import { IDEMPOTENCY_TTL_DAYS } from "../../shared/constants/offline-sync";

/** Rows deleted per statement, to stay within Workers CPU limits. */
const DELETE_BATCH_SIZE = 100;

/**
 * Delete idempotency keys older than {@link IDEMPOTENCY_TTL_DAYS}. A retry
 * after that re-executes; creates carrying a client `id` then answer 409
 * `id_conflict` instead of duplicating.
 *
 * @returns Number of rows deleted.
 */
export async function cleanupIdempotencyKeys(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;

  let batchDeleted: number;
  do {
    const deleted = await db
      .delete(idempotencyKey)
      .where(
        sql`rowid IN (SELECT rowid FROM ${idempotencyKey} WHERE ${lt(idempotencyKey.createdAt, cutoff)} LIMIT ${DELETE_BATCH_SIZE})`,
      )
      .returning({ key: idempotencyKey.key });
    batchDeleted = deleted.length;
    totalDeleted += batchDeleted;
  } while (batchDeleted === DELETE_BATCH_SIZE);

  return totalDeleted;
}
