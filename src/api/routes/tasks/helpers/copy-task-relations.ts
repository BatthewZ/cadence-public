import { asc, eq } from "drizzle-orm";

import type { Database } from "../../../../db";
import { label, taskLabel } from "../../../../db/schema/label";
import { subtask, task } from "../../../../db/schema/task";
import { throwWithContext } from "../../../lib/error-response";

interface CopyTaskRelationsOptions {
  /** Reset subtask completion to false (used for recurring task spawn) */
  resetSubtaskCompletion?: boolean;
}

/**
 * Copies subtasks and labels from a source task to a target task.
 *
 * Extracted from duplicateTask so both task duplication and recurring task
 * spawn can share the same relation-copying logic. Both operations create
 * a new task instance from an existing one and need identical subtask and
 * label propagation, including cleanup on failure.
 */
export async function copyTaskRelations(
  db: Database,
  sourceTaskId: string,
  targetTaskId: string,
  options?: CopyTaskRelationsOptions,
): Promise<{ subtaskCount: number; labels: { id: string; name: string; color: string }[] }> {
  const resetSubtaskCompletion = options?.resetSubtaskCompletion ?? false;

  // Batch-fetch subtasks and labels for the source task in a single round-trip
  const [sourceSubtasks, sourceLabels] = await db.batch([
    db.select().from(subtask).where(eq(subtask.taskId, sourceTaskId)).orderBy(asc(subtask.position)),
    db
      .select({
        labelId: taskLabel.labelId,
        labelName: label.name,
        labelColor: label.color,
      })
      .from(taskLabel)
      .innerJoin(label, eq(taskLabel.labelId, label.id))
      .where(eq(taskLabel.taskId, sourceTaskId)),
  ] as const);

  const now = new Date();

  // Copy subtasks
  if (sourceSubtasks.length > 0) {
    const newSubtasks = sourceSubtasks.map((st) => ({
      id: crypto.randomUUID(),
      taskId: targetTaskId,
      title: st.title,
      completed: resetSubtaskCompletion ? false : st.completed,
      position: st.position,
      createdAt: now,
    }));
    try {
      await db.insert(subtask).values(newSubtasks);
    } catch (error) {
      // Attempt cleanup of the already-inserted target task
      await db
        .delete(task)
        .where(eq(task.id, targetTaskId))
        .catch((cleanupError) =>
          console.error("Failed to clean up task after subtask insert failure:", { sourceTaskId, targetTaskId }, cleanupError),
        );
      throwWithContext(error, "copyTaskRelations.subtasks");
    }
  }

  // Copy labels
  if (sourceLabels.length > 0) {
    try {
      await db.insert(taskLabel).values(
        sourceLabels.map((sl) => ({
          id: crypto.randomUUID(),
          taskId: targetTaskId,
          labelId: sl.labelId,
          createdAt: now,
        })),
      );
    } catch (error) {
      // Attempt cleanup of the already-inserted target task (cascades subtasks)
      await db
        .delete(task)
        .where(eq(task.id, targetTaskId))
        .catch((cleanupError) =>
          console.error("Failed to clean up task after label insert failure:", { sourceTaskId, targetTaskId }, cleanupError),
        );
      throwWithContext(error, "copyTaskRelations.labels");
    }
  }

  return {
    subtaskCount: sourceSubtasks.length,
    labels: sourceLabels.map((sl) => ({
      id: sl.labelId,
      name: sl.labelName,
      color: sl.labelColor,
    })),
  };
}
