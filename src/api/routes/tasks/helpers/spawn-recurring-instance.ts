import { desc, eq } from "drizzle-orm";

import type { Database } from "../../../../db";
import { task } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import {
  computeNextDueDate,
  computeNextStartDate,
  parseRecurrenceRule,
} from "../../../../shared/lib/recurrence";
import { retainAssignableAssignee } from "../../../lib/assignee-validation";
import { createNotification } from "../../../lib/notifications";
import {
  isUniqueConstraintViolation,
  retryOnPositionConflict,
} from "../../../lib/position-conflict";
import { logActivity } from "../log-activity";
import { copyTaskRelations } from "./copy-task-relations";

type TaskRow = typeof task.$inferSelect;

/**
 * Spawned recurring task data — carries explicit `id`, `projectId` and
 * `assigneeId` for downstream consumers.
 *
 * `assigneeId` is declared (rather than left to the index signature) because
 * callers must notify the *spawned* instance's assignee, not the completed
 * task's: the two differ whenever the original assignee has lost access to the
 * project, in which case the new instance is spawned unassigned.
 */
export interface SpawnedTaskData extends Record<string, unknown> {
  id: string;
  projectId: string;
  assigneeId: string | null;
}

interface SpawnResult {
  nextRecurringTask: SpawnedTaskData | null;
}

/**
 * Spawns the next instance of a recurring task after completion.
 *
 * When a recurring task is completed, this function advances the task's primary
 * date by the recurrence rule (see step 2 for which date is the anchor) and
 * creates a fresh task instance linked to the completed one via
 * `recurrenceParentId`. The unique partial index on that column prevents
 * duplicate spawns when concurrent requests race to complete the same task.
 *
 * Returns the new task if one was spawned, or null if:
 * - The task has no recurrence rule
 * - The next occurrence would exceed the rule's endDate
 * - A next instance already exists (race condition guard via unique index)
 */
export async function spawnNextRecurringInstance(
  db: Database,
  completedTask: TaskRow,
  completionDate: Date,
  targetGroupId: string,
): Promise<SpawnResult> {
  // 1. Parse the recurrence rule
  const rule = parseRecurrenceRule(completedTask.recurrenceRule);
  if (!rule) return { nextRecurringTask: null };

  // 2. Compute the next occurrence date.
  //
  // A recurring task advances its PRIMARY date. The anchor is the due date when
  // present; a start-only task (now allowed — a startDate no longer requires a
  // dueDate) advances its START date instead and stays due-less; a fully
  // date-less recurring task anchors on the completion date (the "N days after
  // I finish" pattern) and materialises a due date. The recurrence math is
  // pure date arithmetic and doesn't care which field the anchor came from.
  const recurOnStartOnly =
    completedTask.dueDate === null && completedTask.startDate !== null;
  const anchor =
    completedTask.dueDate ?? completedTask.startDate ?? completionDate;
  const nextAnchor = computeNextDueDate(anchor, completionDate, rule);
  if (!nextAnchor) return { nextRecurringTask: null }; // Past endDate

  // Map the advanced anchor back onto start/due. For a start-only series the
  // anchor IS the start date; otherwise it is the due date, and any stored
  // start→due span is carried forward by shifting the new start date back from
  // the new due date by the same whole-day offset.
  const nextStartDate = recurOnStartOnly
    ? nextAnchor
    : completedTask.startDate && completedTask.dueDate
      ? computeNextStartDate(nextAnchor, completedTask.startDate, completedTask.dueDate)
      : null;
  const nextDueDate = recurOnStartOnly ? null : nextAnchor;

  // 3. Resolve the assignee for the new instance.
  //
  // The assignee carries forward only while that person can still reach the
  // project. A recurring series outlives membership changes, so an assignee
  // who was removed months ago would otherwise keep receiving a fresh task —
  // and a "new instance" notification carrying its title — every cycle,
  // forever. Dropping to null (rather than failing the completion that
  // triggered the spawn) keeps the series alive for the team while cutting off
  // the leak; the next person to open the task can reassign it.
  const nextAssigneeId = await retainAssignableAssignee(
    db, completedTask.projectId, completedTask.assigneeId,
  );

  const newTaskId = crypto.randomUUID();
  const now = new Date();
  const newTaskBase = {
    id: newTaskId,
    projectId: completedTask.projectId,
    taskGroupId: targetGroupId,
    title: completedTask.title,
    description: completedTask.description,
    assigneeId: nextAssigneeId,
    priority: completedTask.priority,
    completed: false,
    completedAt: null,
    completedBy: null,
    // Computed in step 2: carries forward the start→due offset for a ranged
    // task, advances the start date for a start-only series, or stays null.
    startDate: nextStartDate,
    dueDate: nextDueDate,
    cost: completedTask.cost,
    icon: completedTask.icon,
    coverImageKey: null,
    coverImagePosition: null,
    coverUnsplash: null,
    recurrenceRule: completedTask.recurrenceRule, // Keep the same JSON string
    recurrenceSeriesId: completedTask.recurrenceSeriesId,
    recurrenceParentId: completedTask.id, // Link to previous instance
    // Not inherited: import provenance belongs to the originally imported
    // task only. Inheriting would also collide with the partial unique
    // index on (projectId, source_uid) the first time a series respawned.
    sourceUid: null,
    createdAt: now,
    updatedAt: now,
  };

  // 4. Read the end-of-group position and insert, honouring BOTH race guards.
  //
  // Two different unique indexes can reject this insert, and they mean opposite
  // things:
  //
  //  * `task_recurrence_parent_unique_idx` — a concurrent completion of the
  //    SAME task already spawned the next instance. There is nothing left to
  //    do but adopt the winner's row.
  //  * `task_group_position_unique_idx` on `(taskGroupId, position)` — reading
  //    the group's last position and inserting after it is not atomic, so any
  //    other writer into the same group (a second recurring completion, a
  //    create, a duplicate, a move, an import) can take the computed key in
  //    between. Nothing is wrong with this spawn; it needs a fresh position,
  //    which is exactly what every other insert-at-end site in the API gets
  //    from `retryOnPositionConflict`. This was the only one that did not.
  //
  // Telling the two apart is load-bearing, because getting it wrong fails
  // SILENTLY rather than loudly. `isUniqueConstraintViolation` matches both —
  // it is named for the constraint, not for positions — so treating every
  // match as a duplicate spawn would end the series: the parent-id re-query
  // finds nothing, the caller receives `nextRecurringTask: null`, the
  // completion still answers 200 (the task row was updated before this
  // function was called), and the recurrence stops forever with no error and
  // no log line. The re-query is therefore POSITIVE evidence for the
  // duplicate-spawn branch and never its default; anything else is rethrown so
  // the retry loop re-reads the position and tries again, and exhausting the
  // attempts throws — a spawn that cannot be placed must fail loudly.
  //
  // The position read lives INSIDE the retried block on purpose: retrying with
  // the stale boundary value would recompute the identical key and collide
  // again.
  //
  // `isUniqueConstraintViolation` must also be used rather than a local
  // `error.message.includes(...)`: Drizzle wraps the D1 error, so the SQLite
  // text lives on `.cause`, never on the outer `.message`. The hand-rolled
  // check that used to be here never matched, which turned the loser of a
  // concurrent double-completion into a 500 on a completion that had in fact
  // succeeded.
  const attempt = await retryOnPositionConflict(async () => {
    const [lastTask] = await db
      .select({ position: task.position })
      .from(task)
      .where(eq(task.taskGroupId, targetGroupId))
      .orderBy(desc(task.position))
      .limit(1);

    const candidate = {
      ...newTaskBase,
      position: generateKeyBetween(lastTask?.position ?? null, null),
    };

    try {
      await db.insert(task).values(candidate);
      return { kind: "inserted" as const, row: candidate };
    } catch (error: unknown) {
      if (!isUniqueConstraintViolation(error)) throw error;

      const [existing] = await db
        .select()
        .from(task)
        .where(eq(task.recurrenceParentId, completedTask.id))
        .limit(1);
      if (!existing) throw error; // Position collision — retry with a fresh key.

      return { kind: "adopted" as const, row: existing };
    }
  });

  if (attempt.kind === "adopted") {
    return {
      nextRecurringTask: {
        ...attempt.row,
        recurrenceRule: parseRecurrenceRule(attempt.row.recurrenceRule),
      },
    };
  }

  const newTask = attempt.row;

  // 6. Copy subtasks and labels with completion reset
  const { subtaskCount, labels } = await copyTaskRelations(db, completedTask.id, newTaskId, {
    resetSubtaskCompletion: true,
  });

  return {
    nextRecurringTask: {
      ...newTask,
      recurrenceRule: rule, // Return parsed object, not JSON string
      subtaskCount,
      subtaskCompletedCount: 0,
      commentCount: 0,
      labels,
    },
  };
}

/**
 * Logs a "created (Recurring)" activity entry and notifies the assignee
 * for a newly-spawned recurring task instance. Called from deferred work
 * after completing a recurring task.
 */
export async function logRecurringInstanceCreated(
  db: Database,
  opts: {
    nextTaskId: string;
    actorId: string;
    /**
     * The **spawned instance's** assignee, i.e. `SpawnedTaskData.assigneeId` —
     * never the completed task's. The two diverge when the original assignee
     * has lost access to the project: the new instance is spawned unassigned,
     * and notifying the old assignee would leak the task title to someone who
     * can no longer open it.
     */
    assigneeId: string | null;
    taskTitle: string;
    projectId: string;
    /**
     * When the human triggering the completion that spawned this instance
     * was authenticated via a Personal Access Token, the id is propagated
     * here so the spawned task's "created" activity is attributed to the
     * same token. Pass null for scheduled jobs / system-triggered spawns.
     */
    apiTokenId?: string | null;
  },
): Promise<void> {
  await logActivity(db, {
    taskId: opts.nextTaskId,
    actorId: opts.actorId,
    action: "created",
    newValue: "Recurring",
    apiTokenId: opts.apiTokenId ?? null,
  });
  if (opts.assigneeId && opts.assigneeId !== opts.actorId) {
    await createNotification(db, {
      userId: opts.assigneeId,
      type: "task_assigned",
      title: `Recurring task "${opts.taskTitle}" has a new instance`,
      actorId: opts.actorId,
      projectId: opts.projectId,
      taskId: opts.nextTaskId,
    });
  }
}
