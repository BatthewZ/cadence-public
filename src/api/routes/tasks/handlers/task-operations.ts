import { asc, desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { label, taskLabel } from "../../../../db/schema/label";
import { subtask, task, taskGroup } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import { moveTaskSchema } from "../../../../shared/schemas/task";
import type { AppEnv } from "../../../env";
import { deferWork } from "../../../lib/defer";
import { errorResponse, throwWithContext } from "../../../lib/error-response";
import { createNotification } from "../../../lib/notifications";
import { requireParam } from "../../../lib/params";
import { validJson } from "../../../lib/validated";
import { buildTaskEventData, dispatchWebhook } from "../../../lib/webhook-payloads";
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

  // Defer activity logging — runs after the response is sent
  const movedBetweenGroups = foundTask.taskGroupId !== body.taskGroupId;
  if (movedBetweenGroups) {
    const targetGroupName = targetGroup.name;
    const oldTaskGroupId = foundTask.taskGroupId;
    const wasCompleted = foundTask.completed;
    const isCompletionTarget = targetGroup.isCompletionGroup;

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
        },
      ];

      if (isCompletionTarget && !wasCompleted) {
        activities.push({ taskId, actorId: user.id, action: "completed" });
      } else if (!isCompletionTarget && wasCompleted) {
        activities.push({ taskId, actorId: user.id, action: "reopened" });
      }

      await logActivityBatch(db, activities);
    });
  }

  // Non-blocking webhook dispatch for task.moved (+ task.completed if moved to done column)
  {
    const moveData = buildTaskEventData(updated);
    const moveChanges = { taskGroupId: { from: foundTask.taskGroupId, to: body.taskGroupId } };
    const moveEvents: Parameters<typeof dispatchWebhook>[2] = [
      { event: "task.moved", data: moveData, changes: moveChanges },
    ];
    if (targetGroup.isCompletionGroup && !foundTask.completed) {
      moveEvents.push({ event: "task.completed", data: moveData });
    }
    dispatchWebhook(c, foundTask.projectId, moveEvents);
  }

  return c.json({ task: updated });
}

// ---------------------------------------------------------------------------
// Duplicate Task Handler
// ---------------------------------------------------------------------------

export async function duplicateTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");

  // Batch: source task + subtasks + source labels (all independent — only need taskId)
  const [sourceTaskResult, sourceSubtasks, sourceLabels] = await db.batch([
    db.select().from(task).where(eq(task.id, taskId)).limit(1),
    db.select().from(subtask).where(eq(subtask.taskId, taskId)).orderBy(asc(subtask.position)),
    db.select({
      labelId: taskLabel.labelId,
      labelName: label.name,
      labelColor: label.color,
    })
      .from(taskLabel)
      .innerJoin(label, eq(taskLabel.labelId, label.id))
      .where(eq(taskLabel.taskId, taskId)),
  ] as const);

  const sourceTask = sourceTaskResult[0];
  if (!sourceTask) {
    return errorResponse(c, "Task not found", 404);
  }

  // Determine new task position: place at end of the same task group (depends on sourceTask.taskGroupId)
  const [lastExistingTask] = await db
    .select({ position: task.position })
    .from(task)
    .where(eq(task.taskGroupId, sourceTask.taskGroupId))
    .orderBy(desc(task.position))
    .limit(1);

  const position = generateKeyBetween(lastExistingTask?.position ?? null, null);

  const newTaskId = crypto.randomUUID();
  const now = new Date();

  const newTask = {
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
    position,
    createdAt: now,
    updatedAt: now,
  };

  // Insert the new task
  await db.insert(task).values(newTask);

  // Duplicate subtasks with completion reset
  if (sourceSubtasks.length > 0) {
    const newSubtasks = sourceSubtasks.map((st) => ({
      id: crypto.randomUUID(),
      taskId: newTaskId,
      title: st.title,
      completed: false,
      position: st.position,
      createdAt: now,
    }));
    try {
      await db.insert(subtask).values(newSubtasks);
    } catch (error) {
      // Attempt cleanup of the already-inserted task
      await db.delete(task).where(eq(task.id, newTaskId)).catch((cleanupError) =>
        console.error("Failed to clean up duplicated task after subtask insert failure:", cleanupError),
      );
      throwWithContext(error, "duplicateTask.subtasks");
    }
  }

  if (sourceLabels.length > 0) {
    try {
      await db.insert(taskLabel).values(
        sourceLabels.map((sl) => ({
          id: crypto.randomUUID(),
          taskId: newTaskId,
          labelId: sl.labelId,
          createdAt: now,
        })),
      );
    } catch (error) {
      // Attempt cleanup
      await db.delete(task).where(eq(task.id, newTaskId)).catch((cleanupError) =>
        console.error("Failed to clean up duplicated task after label insert failure:", cleanupError),
      );
      throwWithContext(error, "duplicateTask.labels");
    }
  }

  // Log activity on the new task
  try {
    await logActivity(db, {
      taskId: newTaskId,
      actorId: user.id,
      action: "created",
      newValue: `Duplicated from: ${sourceTask.title}`,
    });
  } catch (error) {
    console.error("Failed to log activity for duplicateTask:", error);
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
      console.error("Failed to create assignment notification for duplicateTask:", error);
      // Non-fatal: task was already duplicated
    }
  }

  // Non-blocking webhook dispatch for task.created (duplicated task)
  dispatchWebhook(c, sourceTask.projectId, [
    { event: "task.created", data: buildTaskEventData(newTask as Parameters<typeof buildTaskEventData>[0]) },
  ]);

  return c.json(
    {
      task: {
        ...newTask,
        subtaskCount: sourceSubtasks.length,
        subtaskCompletedCount: 0,
        commentCount: 0,
        labels: sourceLabels.map((sl) => ({
          id: sl.labelId,
          name: sl.labelName,
          color: sl.labelColor,
        })),
      },
    },
    201,
  );
}
