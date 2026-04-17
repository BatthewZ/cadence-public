/**
 * Helpers for fractional-index position writes that race against concurrent
 * writers.
 *
 * The pattern "read last position -> generateKeyBetween -> insert" is not
 * atomic: two concurrent requests can read the same last position, compute
 * the same new position string, and both try to insert it. Paired with a
 * UNIQUE(parentId, position) index on the target table, the loser of the
 * race surfaces a SQLITE_CONSTRAINT_UNIQUE error. Wrapping the attempt in
 * `retryOnPositionConflict` re-runs the read+compute+write until either an
 * attempt succeeds or `maxAttempts` is exhausted.
 *
 * Why the unique index matters: without it, the race silently produces
 * duplicate position strings, which breaks drag-reorder (tied rows appear
 * to swap together on refetch because `ORDER BY position` is unstable).
 */

/**
 * True if `err` looks like a D1 / libsql UNIQUE constraint violation.
 *
 * Drizzle wraps raw D1 errors as `DrizzleQueryError` whose own `.message`
 * is `"Failed query: ..."` (the prepared statement SQL) — the SQLite
 * text `"UNIQUE constraint failed: <table.column>"` only appears on
 * `.cause`. We walk the cause chain so the helper works for both the raw
 * error shape (direct D1 call sites) and the wrapped shape (Drizzle
 * `db.insert().values()` etc.).
 */
export function isUniquePositionConflict(err: unknown): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Run `fn` and retry up to `maxAttempts` times if it fails with a UNIQUE
 * constraint violation. Non-UNIQUE errors propagate immediately.
 *
 * Callers structure `fn` as a read-compute-write block so every retry
 * re-reads the current boundary position from the DB — retrying with a
 * stale value would just collide again.
 *
 * Default `maxAttempts` is sized for the worst-case thundering-herd
 * scenario where N concurrent creators all read the same MAX(position)
 * and race to insert. Each retry lets exactly one more writer win, so N
 * simultaneous requests need up to N attempts. Realistic concurrency per
 * project/task-group is well under 10, so 10 gives comfortable headroom.
 */
export async function retryOnPositionConflict<T>(
  fn: () => Promise<T>,
  maxAttempts = 10,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isUniquePositionConflict(err)) throw err;
      lastError = err;
    }
  }
  throw new Error(
    `Position conflict persisted after ${maxAttempts} attempts`,
    { cause: lastError },
  );
}
