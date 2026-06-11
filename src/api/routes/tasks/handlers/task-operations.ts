import { desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { task, taskGroup } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import { moveTaskSchema } from "../../../../shared/schemas/task";
import type { AppEnv } from "../../../env";
import { deferWork } from "../../../lib/defer";
import { errorResponse } from "../../../lib/error-response";
import { createNotification } from "../../../lib/notifications";
import { requireParam } from "../../../lib/params";
import { retryOnPositionConflict } from "../../../lib/position-conflict";
import { validJson } from "../../../lib/validated";
import { buildTaskEventData, dispatchWebhook, resolveRecurringTaskEnrichment, resolveTaskEnrichment, resolveTaskGroup } from "../../../lib/webhook-payloads";
import { copyTaskRelations } from "../helpers/copy-task-relations";
import { logRecurringInstanceCreated, spawnNextRecurringInstance } from "../helpers/spawn-recurring-instance";
import { type ActivityEntry, logActivity, logActivityBatch } from "../log-activity";

export async function moveTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");
  const body = validJson(c, moveTaskSchema);

  // Batch task + target group lookup in a single round-trip
  const [taskResult, groupResult] = await db.batch([
    db.select().from(task).where(eq(task.id, taskId)).limit(1),
    db.select().from(taskGroup).where(eq(taskGroup.id, body.taskGroupId)).limit(1),
  ] as const);

  const foundTask = taskResult[0];
  if (!foundTask) {
    return errorResponse(c, "Task not found", 404);
  }

  const targetGroup = groupResult[0];
  if (!targetGroup || targetGroup.projectId !== foundTask.projectId) {
    return errorResponse(c, "Target task group not found in this project", 404);
  }

  const now = new Date();

  // Determine completion state based on target group
  const updateData: Record<string, unknown> = {
    taskGroupId: body.taskGroupId,
    position: body.position,
    updatedAt: now,
  };

  if (targetGroup.isCompletionGroup && !foundTask.completed) {
    updateData.completed = true;
    updateData.completedAt = now;
    updateData.completedBy = user.id;
  } else if (!targetGroup.isCompletionGroup && foundTask.completed) {
    updateData.completed = false;
    updateData.completedAt = null;
    updateData.completedBy = null;
  }

  const [updated] = await db
    .update(task)
    .set(updateData)
    .where(eq(task.id, taskId))
    .returning();

  // Spawn next recurring instance when auto-completing via move to done column.
  // Uses pre-completion taskGroupId so the new instance goes to the original group.
  let nextRecurringTask: import("../helpers/spawn-recurring-instance").SpawnedTaskData | null = null;
  if (targetGroup.isCompletionGroup && !foundTask.completed && foundTask.recurrenceRule) {
    const result = await spawnNextRecurringInstance(db, foundTask, now, foundTask.taskGroupId);
    nextRecurringTask = result.nextRecurringTask;
  }

  // Defer activity logging — runs after the response is sent
  const movedBetweenGroups = foundTask.taskGroupId !== body.taskGroupId;
  const moveApiTokenId = c.get("apiToken")?.id ?? null;
  if (movedBetweenGroups) {
    const targetGroupName = targetGroup.name;
    const oldTaskGroupId = foundTask.taskGroupId;
    const wasCompleted = foundTask.completed;
    const isCompletionTarget = targetGroup.isCompletionGroup;
    const capturedNextRecurringTask = nextRecurringTask;
    const assigneeId = foundTask.assigneeId;
    const taskTitle = foundTask.title;
    const projectId = foundTask.projectId;

    deferWork(c, async () => {
      const [oldGroup] = await db
        .select({ name: taskGroup.name })
        .from(taskGroup)
        .where(eq(taskGroup.id, oldTaskGroupId))
        .limit(1);

      const activities: ActivityEntry[] = [
        {
          taskId,
          actorId: user.id,
          action: "moved",
          field: "taskGroupId",
          oldValue: oldGroup?.name ?? oldTaskGroupId,
          newValue: targetGroupName,
          apiTokenId: moveApiTokenId,
        },
      ];

      if (isCompletionTarget && !wasCompleted) {
        activities.push({
          taskId,
          actorId: user.id,
          action: "completed",
          apiTokenId: moveApiTokenId,
        });
      } else if (!isCompletionTarget && wasCompleted) {
        activities.push({
          taskId,
          actorId: user.id,
          action: "reopened",
          apiTokenId: moveApiTokenId,
        });
      }

      await logActivityBatch(db, activities);

      // Log activity and notify assignee for the spawned recurring instance
      if (capturedNextRecurringTask) {
        await logRecurringInstanceCreated(db, {
          nextTaskId: capturedNextRecurringTask.id,
          actorId: user.id,
          assigneeId,
          taskTitle,
          projectId,
          apiTokenId: moveApiTokenId,
        });
      }
    });
  }

  // Log activity and notify assignee for spawned recurring instance when task didn't move between groups
  // (e.g. reordering within a completion group while uncompleted)
  if (nextRecurringTask && !movedBetweenGroups) {
    const capturedNextRecurringTask = nextRecurringTask;
    const assigneeId = foundTask.assigneeId;
    const taskTitle = foundTask.title;
    const projectId = foundTask.projectId;

    deferWork(c, async () => {
      await logRecurringInstanceCreated(db, {
        nextTaskId: capturedNextRecurringTask.id,
        actorId: user.id,
        assigneeId,
        taskTitle,
        projectId,
        apiTokenId: moveApiTokenId,
      });
    });
  }

  // Non-blocking webhook dispatch for task.moved (+ task.completed if moved to done column)
  {
    const movedEnrichment = await resolveTaskEnrichment(db, updated);
    const moveData = buildTaskEventData(updated, movedEnrichment);
    const fromGroup = await resolveTaskGroup(db, foundTask.taskGroupId);
    const moveChanges = {
      taskGroupId: { from: foundTask.taskGroupId, to: body.taskGroupId },
      taskGroup: { from: fromGroup, to: movedEnrichment.taskGroupInfo },
    };
    const moveEvents: Parameters<typeof dispatchWebhook>[2] = [
      { event: "task.moved", data: moveData, changes: moveChanges },
    ];
    if (targetGroup.isCompletionGroup && !foundTask.completed) {
      moveEvents.push({ event: "task.completed", data: moveData });
    }
    dispatchWebhook(c, foundTask.projectId, moveEvents);
  }

  // Non-blocking webhook dispatch for spawned recurring instance
  if (nextRecurringTask) {
    const recurEnrichment = await resolveRecurringTaskEnrichment(db, nextRecurringTask);
    dispatchWebhook(c, foundTask.projectId, [
      { event: "task.created", data: buildTaskEventData(nextRecurringTask as Parameters<typeof buildTaskEventData>[0], recurEnrichment) },
    ]);
  }

  return c.json({ task: updated, nextRecurringTask });
}

// ---------------------------------------------------------------------------
// Duplicate Task Handler
// ---------------------------------------------------------------------------

export async function duplicateTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");

  const [sourceTask] = await db.select().from(task).where(eq(task.id, taskId)).limit(1);
  if (!sourceTask) {
    return errorResponse(c, "Task not found", 404);
  }

  const newTaskId = crypto.randomUUID();
  const now = new Date();

  // Read last position + insert inside a retry loop — concurrent
  // duplicate/create requests in the same task group can race and both
  // compute the same `generateKeyBetween(last, null)` result. The UNIQUE
  // index on (taskGroupId, position) catches this; we retry with a fresh
  // read on conflict.
  const newTask = await retryOnPositionConflict(async () => {
    const [lastExistingTask] = await db
      .select({ position: task.position })
      .from(task)
      .where(eq(task.taskGroupId, sourceTask.taskGroupId))
      .orderBy(desc(task.position))
      .limit(1);

    const position = generateKeyBetween(lastExistingTask?.position ?? null, null);

    const row = {
      id: newTaskId,
      projectId: sourceTask.projectId,
      taskGroupId: sourceTask.taskGroupId,
      title: `${sourceTask.title} (copy)`,
      description: sourceTask.description,
      assigneeId: sourceTask.assigneeId,
      priority: sourceTask.priority,
      completed: false,
      completedAt: null,
      completedBy: null,
      dueDate: sourceTask.dueDate,
      cost: sourceTask.cost,
      icon: sourceTask.icon,
      coverImageKey: null,
      coverImagePosition: null,
      coverUnsplash: null,
      recurrenceRule: sourceTask.recurrenceRule,
      recurrenceParentId: null,
      recurrenceSeriesId: sourceTask.recurrenceRule ? crypto.randomUUID() : null,
      position,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(task).values(row);
    return row;
  });

  // Copy subtasks (with completion reset) and labels from the source task
  const { subtaskCount, labels: copiedLabels } = await copyTaskRelations(
    db, taskId, newTaskId, { resetSubtaskCompletion: true },
  );

  // Log activity on the new task
  try {
    await logActivity(db, {
      taskId: newTaskId,
      actorId: user.id,
      action: "created",
      newValue: `Duplicated from: ${sourceTask.title}`,
      apiTokenId: c.get("apiToken")?.id ?? null,
    });
  } catch (error) {
    console.error("Failed to log activity for duplicateTask:", { sourceTaskId: taskId, newTaskId, userId: user.id }, error);
    // Non-fatal: task was already duplicated
  }

  // Create notification if assignee is set
  if (sourceTask.assigneeId) {
    try {
      await createNotification(db, {
        userId: sourceTask.assigneeId,
        type: "task_assigned",
        title: `You were assigned to "${newTask.title}"`,
        actorId: user.id,
        projectId: sourceTask.projectId,
        taskId: newTaskId,
      });
    } catch (error) {
      console.error("Failed to create assignment notification for duplicateTask:", { newTaskId, assigneeId: sourceTask.assigneeId, projectId: sourceTask.projectId, userId: user.id }, error);
      // Non-fatal: task was already duplicated
    }
  }

  // Non-blocking webhook dispatch for task.created (duplicated task)
  const dupEnrichment = await resolveTaskEnrichment(db, newTask as Parameters<typeof resolveTaskEnrichment>[1]);
  dispatchWebhook(c, sourceTask.projectId, [
    { event: "task.created", data: buildTaskEventData(newTask as Parameters<typeof buildTaskEventData>[0], dupEnrichment) },
  ]);

  return c.json(
    {
      task: {
        ...newTask,
        subtaskCount,
        subtaskCompletedCount: 0,
        commentCount: 0,
        labels: copiedLabels,
      },
    },
    201,
  );
}
