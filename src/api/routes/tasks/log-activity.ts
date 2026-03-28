import type { Database } from "../../../db";
import { taskActivity } from "../../../db/schema/task";

export interface ActivityEntry {
  taskId: string;
  actorId: string;
  action: string;
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
}

/** Insert a task activity record */
export async function logActivity(
  db: Database,
  opts: ActivityEntry,
) {
  await db.insert(taskActivity).values({
    id: crypto.randomUUID(),
    taskId: opts.taskId,
    actorId: opts.actorId,
    action: opts.action,
    field: opts.field ?? null,
    oldValue: opts.oldValue ?? null,
    newValue: opts.newValue ?? null,
    createdAt: new Date(),
  });
}

/**
 * Insert multiple task activity records in a single query.
 *
 * Reduces D1 round-trips when a handler needs to log several activities
 * (e.g. moved + completed).  Silently no-ops when the list is empty.
 */
export async function logActivityBatch(
  db: Database,
  entries: ActivityEntry[],
) {
  if (entries.length === 0) return;
  const now = new Date();
  await db.insert(taskActivity).values(
    entries.map((opts) => ({
      id: crypto.randomUUID(),
      taskId: opts.taskId,
      actorId: opts.actorId,
      action: opts.action,
      field: opts.field ?? null,
      oldValue: opts.oldValue ?? null,
      newValue: opts.newValue ?? null,
      createdAt: now,
    })),
  );
}
