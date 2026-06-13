import { and, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Context } from "hono";

import { task, taskGroup } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import { importTasksSchema } from "../../../../shared/schemas/task";
import type { AppEnv } from "../../../env";
import { deferWork } from "../../../lib/defer";
import { errorResponse } from "../../../lib/error-response";
import { requireParam } from "../../../lib/params";
import { retryOnPositionConflict } from "../../../lib/position-conflict";
import { validJson } from "../../../lib/validated";
import { type ActivityEntry, logActivityBatch } from "../log-activity";

// ---------------------------------------------------------------------------
// D1 statement sizing
// ---------------------------------------------------------------------------

/**
 * Cloudflare D1 rejects any single statement with more than 100 bound
 * parameters ("Maximum bound parameters per query: 100" in the D1 limits
 * doc; the underlying SQLite raises "too many SQL variables"). A 500-event
 * import would blow far past that as one multi-row INSERT, so every
 * statement below is sized against this ceiling. The Miniflare D1 used in
 * tests enforces the same limit, so the bulk-import test fails loudly if
 * any statement here outgrows it.
 */
const D1_MAX_BOUND_PARAMS = 100;

/** UIDs per dedupe SELECT: 99 IN-list params + 1 projectId param = 100. */
const UIDS_PER_SELECT = D1_MAX_BOUND_PARAMS - 1;

/**
 * `logActivityBatch` binds 9 params per entry (id, taskId, actorId, action,
 * field, oldValue, newValue, apiTokenId, createdAt) → 11 × 9 = 99 ≤ 100.
 */
const ACTIVITY_ROWS_PER_BATCH = Math.floor(D1_MAX_BOUND_PARAMS / 9);

/** Split `items` into consecutive chunks of at most `size` elements. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * POST /projects/:projectId/tasks/import — bulk-create tasks from a
 * client-parsed .ics calendar.
 *
 * Dedupe contract (the reason `task.sourceUid` exists): events that carry a
 * UID are imported at most once per project — the partial unique index on
 * (projectId, source_uid) is the ground truth, and this handler pre-reads
 * existing UIDs so a re-import of the same file reports them as `skipped`
 * instead of failing the whole batch. Events WITHOUT a UID can never be
 * recognised on re-import and are deliberately created again (documented
 * behavior, mirrored in the tests).
 *
 * Atomicity: all inserts go through one `db.batch()` — D1 runs a batch as a
 * single transaction, so a mid-batch failure (e.g. a position race) rolls
 * back every chunk and the retry loop re-reads both the existing-UID set
 * and the boundary position before trying again. There is never a partial
 * import.
 *
 * NO webhook fan-out — deliberate. A 500-event import would enqueue 500
 * `task.created` deliveries per subscribed webhook, hammering subscriber
 * endpoints and our own delivery/retry machinery for what is, to the user,
 * one action. Consumers who care about imported tasks still see them on the
 * next read (and `sourceUid` is in every task webhook payload thereafter
 * via `buildTaskEventData`).
 */
export async function importTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, importTasksSchema);

  // Same invariant + wording as createTask: the target group must belong to
  // the project in the URL, otherwise a member of project A could inject
  // tasks into project B's group.
  const [group] = await db
    .select()
    .from(taskGroup)
    .where(
      and(
        eq(taskGroup.id, body.taskGroupId),
        eq(taskGroup.projectId, projectId),
      ),
    )
    .limit(1);

  if (!group) {
    return errorResponse(c, "Task group not found in this project", 404);
  }

  const apiTokenId = c.get("apiToken")?.id ?? null;
  const total = body.tasks.length;

  // Read-partition-insert runs inside the position-conflict retry loop: a
  // concurrent create in the same group (or a concurrent import of the same
  // file) surfaces as a UNIQUE violation, the batch rolls back, and the
  // retry re-reads BOTH the boundary position and the existing-UID set — so
  // the losing import of a same-file race converges to "all skipped" rather
  // than erroring.
  const { createdRows, skipped } = await retryOnPositionConflict(async () => {
    // 1. Which incoming UIDs already exist in this project? One indexed
    //    lookup per 99 UIDs (see UIDS_PER_SELECT). The Set also collapses
    //    duplicate UIDs within the payload itself.
    const incomingUids = [
      ...new Set(
        body.tasks
          .map((t) => t.sourceUid)
          .filter((uid): uid is string => typeof uid === "string"),
      ),
    ];

    const existingUids = new Set<string>();
    for (const uidChunk of chunk(incomingUids, UIDS_PER_SELECT)) {
      const rows = await db
        .select({ sourceUid: task.sourceUid })
        .from(task)
        .where(
          and(
            eq(task.projectId, projectId),
            inArray(task.sourceUid, uidChunk),
          ),
        );
      for (const row of rows) {
        if (row.sourceUid) existingUids.add(row.sourceUid);
      }
    }

    // 2. Partition create vs. skip. A UID repeated WITHIN the payload is
    //    also skipped after its first occurrence — inserting both would
    //    trip the unique index and roll back the entire batch.
    const seenInPayload = new Set<string>();
    const toCreate: typeof body.tasks = [];
    let skippedCount = 0;

    for (const item of body.tasks) {
      if (item.sourceUid) {
        if (existingUids.has(item.sourceUid) || seenInPayload.has(item.sourceUid)) {
          skippedCount++;
          continue;
        }
        seenInPayload.add(item.sourceUid);
      }
      toCreate.push(item);
    }

    if (toCreate.length === 0) {
      return { createdRows: [], skipped: skippedCount };
    }

    // 3. ONE boundary read, then a fractional-index chain appended after
    //    the group's current last task — each key is generated after the
    //    previous one so imported tasks keep the file's event order.
    const [lastTaskRow] = await db
      .select({ position: task.position })
      .from(task)
      .where(eq(task.taskGroupId, body.taskGroupId))
      .orderBy(desc(task.position))
      .limit(1);

    let prevPosition: string | null = lastTaskRow?.position ?? null;
    const now = new Date();
    // Same completion-group rule as createTask: importing into a completion
    // group marks the tasks completed, so a "Done" column never shows open
    // tasks just because they arrived via import.
    const isCompleted = group.isCompletionGroup;

    const rows = toCreate.map((item) => {
      const position: string = generateKeyBetween(prevPosition, null);
      prevPosition = position;
      return {
        id: crypto.randomUUID(),
        projectId,
        taskGroupId: body.taskGroupId,
        title: item.title,
        description: item.description ?? null,
        completed: isCompleted,
        completedAt: isCompleted ? now : null,
        completedBy: isCompleted ? user.id : null,
        // importTasksSchema reuses createTask's calendar-aware date rules +
        // the shared start≤due refinement, so these parse cleanly and the
        // range invariant already holds.
        startDate: item.startDate ? new Date(item.startDate) : null,
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        sourceUid: item.sourceUid ?? null,
        position,
        createdAt: now,
        updatedAt: now,
      };
    });

    // 4. Atomic chunked insert — one D1 batch (= one transaction), sized so
    //    no single statement exceeds the bound-parameter ceiling.
    //
    //    Rows-per-statement is derived from Drizzle's OWN generated SQL for
    //    one row rather than hand-counting columns: Drizzle binds params not
    //    only for the keys we provide but also for schema-level defaults it
    //    fills in (e.g. `priority`), so a hard-coded count silently breaks
    //    the moment the task table grows a defaulted column. All rows share
    //    one literal shape, so a single sample is representative and params
    //    scale linearly with row count.
    const paramsPerRow = db.insert(task).values([rows[0]]).toSQL().params.length;
    const rowsPerInsert = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / paramsPerRow));
    const statements = chunk(rows, rowsPerInsert).map((rowChunk) =>
      db.insert(task).values(rowChunk),
    );
    await db.batch(
      statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );

    return { createdRows: rows, skipped: skippedCount };
  });

  // Activity logging is deferred (runs after the response is sent) and
  // chunked for the same bound-parameter ceiling. `newValue: "Imported"`
  // distinguishes these entries from hand-created tasks in the feed.
  if (createdRows.length > 0) {
    const entries: ActivityEntry[] = createdRows.map((row) => ({
      taskId: row.id,
      actorId: user.id,
      action: "created",
      newValue: "Imported",
      apiTokenId,
    }));
    deferWork(c, async () => {
      for (const entryChunk of chunk(entries, ACTIVITY_ROWS_PER_BATCH)) {
        await logActivityBatch(db, entryChunk);
      }
    });
  }

  // (No dispatchWebhook call here — see the handler JSDoc for why bulk
  // import intentionally skips task.created fan-out.)

  return c.json(
    { created: createdRows.length, skipped, total },
    201,
  );
}
