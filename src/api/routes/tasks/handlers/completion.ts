import { and, asc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { task, taskGroup } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import type { AppEnv } from "../../../env";
import { deferWork } from "../../../lib/defer";
import { errorResponse } from "../../../lib/error-response";
import { createNotification } from "../../../lib/notifications";
import { requireParam } from "../../../lib/params";
import { retryOnPositionConflict } from "../../../lib/position-conflict";
import { buildTaskEventData, dispatchWebhook, resolveRecurringTaskEnrichment, resolveTaskEnrichment } from "../../../lib/webhook-payloads";
import { logRecurringInstanceCreated, spawnNextRecurringInstance } from "../helpers/spawn-recurring-instance";
import { type ActivityEntry, logActivityBatch } from "../log-activity";

// ---------------------------------------------------------------------------
// Complete / Uncomplete Handlers
// ---------------------------------------------------------------------------

export async function completeTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");

  const [foundTask] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!foundTask) {
    return errorResponse(c, "Task not found", 404);
  }

  if (foundTask.completed) {
    return c.json({ task: foundTask });
  }

  const now = new Date();

  // Find the first completion group in this project
  const [completionGroup] = await db
    .select()
    .from(taskGroup)
    .where(
      and(
        eq(taskGroup.projectId, foundTask.projectId),
        eq(taskGroup.isCompletionGroup, true),
      ),
    )
    .orderBy(asc(taskGroup.position), asc(taskGroup.id))
    .limit(1);

  const baseUpdateData: Record<string, unknown> = {
    completed: true,
    completedAt: now,
    completedBy: user.id,
    updatedAt: now,
  };

  // Move to completion group if one exists and task isn't already there
  const movingToCompletion = completionGroup && foundTask.taskGroupId !== completionGroup.id;

  // When moving to the completion group we assign a new position at the
  // top. Concurrent completions racing to the same completion group would
  // otherwise compute identical positions; wrap the UPDATE in a retry
  // loop so the UNIQUE index on (taskGroupId, position) is handled
  // gracefully.
  const [updated] = movingToCompletion
    ? await retryOnPositionConflict(async () => {
        const [firstTask] = await db
          .select({ position: task.position })
          .from(task)
          .where(eq(task.taskGroupId, completionGroup.id))
          .orderBy(asc(task.position), asc(task.id))
          .limit(1);

        const completionPosition = generateKeyBetween(null, firstTask?.position ?? null);

        return db
          .update(task)
          .set({
            ...baseUpdateData,
            taskGroupId: completionGroup.id,
            position: completionPosition,
          })
          .where(eq(task.id, taskId))
          .returning();
      })
    : await db
        .update(task)
        .set(baseUpdateData)
        .where(eq(task.id, taskId))
        .returning();

  // Spawn next recurring instance if applicable.
  // Uses pre-completion taskGroupId so the new instance goes to the original group.
  let nextRecurringTask: import("../helpers/spawn-recurring-instance").SpawnedTaskData | null = null;
  if (foundTask.recurrenceRule) {
    const result = await spawnNextRecurringInstance(db, foundTask, now, foundTask.taskGroupId);
    nextRecurringTask = result.nextRecurringTask;
  }

  // Defer activity logging + notifications — runs after response is sent
  {
    const oldTaskGroupId = foundTask.taskGroupId;
    const completionGroupName = completionGroup?.name;
    const assigneeId = foundTask.assigneeId;
    const taskTitle = foundTask.title;
    const projectId = foundTask.projectId;
    const capturedNextRecurringTask = nextRecurringTask;

    deferWork(c, async () => {
      const activities: ActivityEntry[] = [{ taskId, actorId: user.id, action: "completed" }];

      if (movingToCompletion) {
        const [oldGroup] = await db
          .select({ name: taskGroup.name })
          .from(taskGroup)
          .where(eq(taskGroup.id, oldTaskGroupId))
          .limit(1);

        activities.unshift({
          taskId,
          actorId: user.id,
          action: "moved",
          field: "taskGroupId",
          oldValue: oldGroup?.name ?? oldTaskGroupId,
          newValue: completionGroupName,
        });
      }

      await logActivityBatch(db, activities);

      if (assigneeId && assigneeId !== user.id) {
        await createNotification(db, {
          userId: assigneeId,
          type: "task_completed",
          title: `"${taskTitle}" was marked complete`,
          actorId: user.id,
          projectId,
          taskId,
        });
      }

      // Log activity and notify assignee for the spawned recurring instance
      if (capturedNextRecurringTask) {
        await logRecurringInstanceCreated(db, {
          nextTaskId: capturedNextRecurringTask.id,
          actorId: user.id,
          assigneeId,
          taskTitle,
          projectId,
        });
      }
    });
  }

  // Non-blocking webhook dispatch for task.completed
  const completedEnrichment = await resolveTaskEnrichment(db, updated);
  dispatchWebhook(c, foundTask.projectId, [
    { event: "task.completed", data: buildTaskEventData(updated, completedEnrichment) },
  ]);

  // Non-blocking webhook dispatch for spawned recurring instance
  if (nextRecurringTask) {
    const recurEnrichment = await resolveRecurringTaskEnrichment(db, nextRecurringTask);
    dispatchWebhook(c, foundTask.projectId, [
      { event: "task.created", data: buildTaskEventData(nextRecurringTask as Parameters<typeof buildTaskEventData>[0], recurEnrichment) },
    ]);
  }

  return c.json({ task: updated, nextRecurringTask });
}

export async function uncompleteTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");

  const [foundTask] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!foundTask) {
    return errorResponse(c, "Task not found", 404);
  }

  if (!foundTask.completed) {
    return c.json({ task: foundTask });
  }

  const now = new Date();

  const baseUpdateData: Record<string, unknown> = {
    completed: false,
    completedAt: null,
    completedBy: null,
    updatedAt: now,
  };

  // Check if current group is a completion group — if so, move to first non-completion group
  const [currentGroup] = await db
    .select()
    .from(taskGroup)
    .where(eq(taskGroup.id, foundTask.taskGroupId))
    .limit(1);

  // Capture move info for deferred activity logging
  let moveFromName: string | undefined;
  let moveToName: string | undefined;

  let firstNonCompletionGroupId: string | null = null;
  if (currentGroup?.isCompletionGroup) {
    const [firstNonCompletionGroup] = await db
      .select()
      .from(taskGroup)
      .where(
        and(
          eq(taskGroup.projectId, foundTask.projectId),
          eq(taskGroup.isCompletionGroup, false),
        ),
      )
      .orderBy(asc(taskGroup.position), asc(taskGroup.id))
      .limit(1);

    if (firstNonCompletionGroup) {
      firstNonCompletionGroupId = firstNonCompletionGroup.id;
      moveFromName = currentGroup.name;
      moveToName = firstNonCompletionGroup.name;
    }
  }

  // When moving the task into a different group we recompute "top of
  // target group" inside a retry loop so concurrent uncomplete operations
  // on the same target group don't collide on position. Without a move,
  // position is untouched and the UPDATE can run once.
  const [updated] = firstNonCompletionGroupId
    ? await retryOnPositionConflict(async () => {
        const [firstTask] = await db
          .select({ position: task.position })
          .from(task)
          .where(eq(task.taskGroupId, firstNonCompletionGroupId))
          .orderBy(asc(task.position), asc(task.id))
          .limit(1);

        const uncompletePosition = generateKeyBetween(null, firstTask?.position ?? null);

        return db
          .update(task)
          .set({
            ...baseUpdateData,
            taskGroupId: firstNonCompletionGroupId,
            position: uncompletePosition,
          })
          .where(eq(task.id, taskId))
          .returning();
      })
    : await db
        .update(task)
        .set(baseUpdateData)
        .where(eq(task.id, taskId))
        .returning();

  // Defer activity logging — runs after response is sent
  {
    const capturedMoveFrom = moveFromName;
    const capturedMoveTo = moveToName;

    deferWork(c, async () => {
      const activities: ActivityEntry[] = [];
      if (capturedMoveFrom && capturedMoveTo) {
        activities.push({
          taskId,
          actorId: user.id,
          action: "moved",
          field: "taskGroupId",
          oldValue: capturedMoveFrom,
          newValue: capturedMoveTo,
        });
      }
      activities.push({ taskId, actorId: user.id, action: "reopened" });
      await logActivityBatch(db, activities);
    });
  }

  // Non-blocking webhook dispatch for task.uncompleted
  const uncompletedEnrichment = await resolveTaskEnrichment(db, updated);
  dispatchWebhook(c, foundTask.projectId, [
    { event: "task.uncompleted", data: buildTaskEventData(updated, uncompletedEnrichment) },
  ]);

  return c.json({ task: updated });
}
