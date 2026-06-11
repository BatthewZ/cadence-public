import { desc, eq } from "drizzle-orm";

import type { Database } from "../../../../db";
import { task } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import {
  computeNextDueDate,
  parseRecurrenceRule,
} from "../../../../shared/lib/recurrence";
import { createNotification } from "../../../lib/notifications";
import { logActivity } from "../log-activity";
import { copyTaskRelations } from "./copy-task-relations";

type TaskRow = typeof task.$inferSelect;

/** Spawned recurring task data — carries explicit `id` and `projectId` for downstream consumers. */
export interface SpawnedTaskData extends Record<string, unknown> {
  id: string;
  projectId: string;
}

interface SpawnResult {
  nextRecurringTask: SpawnedTaskData | null;
}

/**
 * Spawns the next instance of a recurring task after completion.
 *
 * When a recurring task is completed, this function computes the next due date
 * from the recurrence rule and creates a fresh task instance linked to the
 * completed one via `recurrenceParentId`. The unique partial index on that
 * column prevents duplicate spawns when concurrent requests race to complete
 * the same task.
 *
 * Returns the new task if one was spawned, or null if:
 * - The task has no recurrence rule
 * - The next due date would exceed the rule's endDate
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

  // 2. Compute next due date using max(dueDate, completionDate) as anchor
  const currentDueDate = completedTask.dueDate ?? completionDate;
  const nextDueDate = computeNextDueDate(currentDueDate, completionDate, rule);
  if (!nextDueDate) return { nextRecurringTask: null }; // Past endDate

  // 3. Get position at end of target group
  const [lastTask] = await db
    .select({ position: task.position })
    .from(task)
    .where(eq(task.taskGroupId, targetGroupId))
    .orderBy(desc(task.position))
    .limit(1);
  const position = generateKeyBetween(lastTask?.position ?? null, null);

  // 4. Create the new task
  const newTaskId = crypto.randomUUID();
  const now = new Date();
  const newTask = {
    id: newTaskId,
    projectId: completedTask.projectId,
    taskGroupId: targetGroupId,
    title: completedTask.title,
    description: completedTask.description,
    assigneeId: completedTask.assigneeId,
    priority: completedTask.priority,
    completed: false,
    completedAt: null,
    completedBy: null,
    dueDate: nextDueDate,
    cost: completedTask.cost,
    icon: completedTask.icon,
    coverImageKey: null,
    coverImagePosition: null,
    coverUnsplash: null,
    recurrenceRule: completedTask.recurrenceRule, // Keep the same JSON string
    recurrenceSeriesId: completedTask.recurrenceSeriesId,
    recurrenceParentId: completedTask.id, // Link to previous instance
    position,
    createdAt: now,
    updatedAt: now,
  };

  // 5. Insert with race condition guard.
  // The unique partial index on recurrenceParentId prevents duplicates.
  // If two concurrent completions race, the second insert fails.
  try {
    await db.insert(task).values(newTask);
  } catch (error: unknown) {
    // Check if this is a unique constraint violation (duplicate spawn)
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("UNIQUE constraint failed") ||
      message.includes("unique")
    ) {
      // Another request already spawned the next instance — query it
      const [existing] = await db
        .select()
        .from(task)
        .where(eq(task.recurrenceParentId, completedTask.id))
        .limit(1);
      return {
        nextRecurringTask: existing
          ? {
              ...existing,
              recurrenceRule: parseRecurrenceRule(existing.recurrenceRule),
            }
          : null,
      };
    }
    throw error; // Re-throw non-duplicate errors
  }

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
