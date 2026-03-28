import { and, lt, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { taskActivity } from "../../db/schema/task";

/** Maximum age for task activity records (90 days). */
const RETENTION_DAYS = 90;

/**
 * Maximum number of activity records to keep per task.
 *
 * Tasks with more activity records than this will have the oldest records
 * pruned even if they are within the 90-day retention window. This prevents a
 * single heavily-edited task from accumulating unbounded history.
 */
const MAX_ACTIVITIES_PER_TASK = 500;

/**
 * Batch size for delete operations to keep CPU usage within Cloudflare Workers
 * free-tier limits. Each batch deletes up to this many rows.
 */
const DELETE_BATCH_SIZE = 100;

/**
 * Clean up old task activity records.
 *
 * Every task field change (title, description, assignee, status, labels, etc.)
 * creates a row in the `task_activity` table. In active projects this is the
 * fastest-growing table and will cause unbounded D1 storage growth without
 * periodic pruning.
 *
 * Applies two retention policies:
 * 1. **Time-based retention** -- Delete all activity records older than 90
 *    days.
 * 2. **Per-task cap** -- For tasks with more than 500 activity records, delete
 *    the oldest records beyond the cap.
 *
 * Each policy is independent — a failure in one does not prevent the other
 * from running. Deletes are batched at {@link DELETE_BATCH_SIZE} rows to stay
 * within Cloudflare Workers free-tier CPU limits.
 *
 * @returns Total number of activity records deleted.
 */
export async function cleanupTaskActivity(db: Database): Promise<number> {
  let totalDeleted = 0;

  // ---------------------------------------------------------------------------
  // Policy 1: Delete activity records older than 90 days
  // ---------------------------------------------------------------------------
  try {
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    let batchDeleted: number;
    do {
      const oldRows = await db
        .select({ id: taskActivity.id })
        .from(taskActivity)
        .where(lt(taskActivity.createdAt, cutoff))
        .limit(DELETE_BATCH_SIZE);

      if (oldRows.length === 0) break;

      const idsToDelete = oldRows.map((r) => r.id);
      await db
        .delete(taskActivity)
        .where(
          sql`${taskActivity.id} IN (${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      batchDeleted = oldRows.length;
      totalDeleted += batchDeleted;
    } while (batchDeleted === DELETE_BATCH_SIZE);
  } catch (error) {
    console.error(
      "[task-activity-cleanup] Failed to delete old activity records",
      error,
    );
  }

  // ---------------------------------------------------------------------------
  // Policy 2: Per-task cap — keep only the most recent 500 per task
  // ---------------------------------------------------------------------------
  try {
    const overflowTasks = await db
      .select({
        taskId: taskActivity.taskId,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(taskActivity)
      .groupBy(taskActivity.taskId)
      .having(sql`count(*) > ${MAX_ACTIVITIES_PER_TASK}`);

    for (const { taskId, count } of overflowTasks) {
      const excess = count - MAX_ACTIVITIES_PER_TASK;
      if (excess <= 0) continue;

      // Find the createdAt boundary: the oldest record in the "keep" set.
      // Everything older than this for the same task is excess.
      const boundary = await db
        .select({ createdAt: taskActivity.createdAt })
        .from(taskActivity)
        .where(sql`${taskActivity.taskId} = ${taskId}`)
        .orderBy(sql`${taskActivity.createdAt} DESC`)
        .limit(1)
        .offset(MAX_ACTIVITIES_PER_TASK - 1);

      if (boundary.length === 0) continue;

      const cutoff = boundary[0].createdAt;

      // Delete records older than the boundary in batches
      let batchDeleted: number;
      do {
        const excessRows = await db
          .select({ id: taskActivity.id })
          .from(taskActivity)
          .where(
            and(
              sql`${taskActivity.taskId} = ${taskId}`,
              lt(taskActivity.createdAt, cutoff),
            ),
          )
          .limit(DELETE_BATCH_SIZE);

        if (excessRows.length === 0) break;

        const idsToDelete = excessRows.map((r) => r.id);
        await db
          .delete(taskActivity)
          .where(
            sql`${taskActivity.id} IN (${sql.join(
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
      "[task-activity-cleanup] Failed to enforce per-task activity cap",
      error,
    );
  }

  return totalDeleted;
}
