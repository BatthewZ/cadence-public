import { and, asc, count, desc, eq, exists, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../../db/schema/auth";
import { label, taskLabel } from "../../../../db/schema/label";
import { project } from "../../../../db/schema/project";
import { comment, subtask, task, taskGroup } from "../../../../db/schema/task";
import { taskAttachment } from "../../../../db/schema/task-attachment";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import type { TaskLabelInfo } from "../../../../shared/schemas/label";
import { createTaskSchema, updateTaskSchema } from "../../../../shared/schemas/task";
import type { AppEnv } from "../../../env";
import { deferWork } from "../../../lib/defer";
import { errorResponse } from "../../../lib/error-response";
import { createNotification } from "../../../lib/notifications";
import { requireParam } from "../../../lib/params";
import { validJson } from "../../../lib/validated";
import {
  buildTaskEventData,
  computeChanges,
  detectAdditionalEvents,
  dispatchWebhook,
} from "../../../lib/webhook-payloads";
import { type ActivityEntry, logActivity, logActivityBatch } from "../log-activity";

// ---------------------------------------------------------------------------
// Task Handlers
// ---------------------------------------------------------------------------

export async function createTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, createTaskSchema);

  // Batch: taskGroup existence + last position + project settings (independent — all use upfront IDs)
  const [groupResult, lastTaskResult, projectResult] = await db.batch([
    db.select()
      .from(taskGroup)
      .where(
        and(
          eq(taskGroup.id, body.taskGroupId),
          eq(taskGroup.projectId, projectId),
        ),
      )
      .limit(1),
    db.select({ position: task.position })
      .from(task)
      .where(eq(task.taskGroupId, body.taskGroupId))
      .orderBy(desc(task.position))
      .limit(1),
    db.select({ autoAssignCreator: project.autoAssignCreator })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1),
  ] as const);

  const group = groupResult[0];
  if (!group) {
    return errorResponse(c, "Task group not found in this project", 404);
  }

  const position = generateKeyBetween(lastTaskResult[0]?.position ?? null, null);

  const id = crypto.randomUUID();
  const now = new Date();

  const isCompleted = group.isCompletionGroup;

  const assigneeId = body.assigneeId !== undefined
    ? (body.assigneeId ?? null)
    : (projectResult[0]?.autoAssignCreator ? user.id : null);

  const newTask = {
    id,
    projectId,
    taskGroupId: body.taskGroupId,
    title: body.title,
    description: body.description ?? null,
    assigneeId,
    priority: body.priority ?? "none",
    completed: isCompleted,
    completedAt: isCompleted ? now : null,
    completedBy: isCompleted ? user.id : null,
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    cost: body.cost ?? null,
    icon: body.icon ?? null,
    position,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(task).values(newTask);

  // Defer activity logging + notifications — runs after response is sent
  deferWork(c, async () => {
    await logActivity(db, {
      taskId: id,
      actorId: user.id,
      action: "created",
    });
    if (newTask.assigneeId && newTask.assigneeId !== user.id) {
      await createNotification(db, {
        userId: newTask.assigneeId,
        type: "task_assigned",
        title: `You were assigned to "${body.title}"`,
        actorId: user.id,
        projectId,
        taskId: id,
      });
    }
  });

  // Non-blocking webhook dispatch for task.created
  dispatchWebhook(c, projectId, [
    { event: "task.created", data: buildTaskEventData(newTask as Parameters<typeof buildTaskEventData>[0]) },
  ]);

  return c.json({ task: newTask }, 201);
}

export async function listTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");

  // Query filters from query params
  const taskGroupIdFilter = c.req.query("taskGroupId");
  const assigneeIdFilter = c.req.query("assigneeId");
  const completedFilter = c.req.query("completed");
  const priorityFilter = c.req.query("priority");
  const labelIdFilter = c.req.query("labelId");

  const conditions = [eq(task.projectId, projectId)];

  if (taskGroupIdFilter) {
    conditions.push(eq(task.taskGroupId, taskGroupIdFilter));
  }
  if (assigneeIdFilter) {
    conditions.push(eq(task.assigneeId, assigneeIdFilter));
  }
  if (completedFilter !== undefined) {
    conditions.push(eq(task.completed, completedFilter === "true"));
  }
  if (priorityFilter) {
    conditions.push(eq(task.priority, priorityFilter));
  }
  if (labelIdFilter) {
    const labelIds = labelIdFilter.split(",").filter(Boolean);
    if (labelIds.length > 0) {
      conditions.push(
        exists(
          db.select({ x: sql`1` })
            .from(taskLabel)
            .where(and(
              eq(taskLabel.taskId, task.id),
              inArray(taskLabel.labelId, labelIds),
            )),
        ),
      );
    }
  }

  // Pre-aggregate subtask and comment counts to avoid N+1 correlated subqueries
  const subtaskCounts = db
    .select({
      taskId: subtask.taskId,
      cnt: sql<number>`COUNT(*)`.as("subtask_cnt"),
      completed: sql<number>`SUM(CASE WHEN ${subtask.completed} = 1 THEN 1 ELSE 0 END)`.as("subtask_completed"),
    })
    .from(subtask)
    .groupBy(subtask.taskId)
    .as("sc");

  const commentCounts = db
    .select({
      taskId: comment.taskId,
      cnt: sql<number>`COUNT(*)`.as("comment_cnt"),
    })
    .from(comment)
    .groupBy(comment.taskId)
    .as("cc");

  const attachmentCounts = db
    .select({
      taskId: taskAttachment.taskId,
      cnt: sql<number>`COUNT(*)`.as("attachment_cnt"),
    })
    .from(taskAttachment)
    .groupBy(taskAttachment.taskId)
    .as("ac");

  // Pre-aggregate labels per task as JSON
  const taskLabelsSubquery = db
    .select({
      taskId: taskLabel.taskId,
      labelsJson: sql<string>`JSON_GROUP_ARRAY(JSON_OBJECT('id', ${label.id}, 'name', ${label.name}, 'color', ${label.color}))`.as("labels_json"),
    })
    .from(taskLabel)
    .innerJoin(label, eq(taskLabel.labelId, label.id))
    .groupBy(taskLabel.taskId)
    .as("tl");

  const tasks = await db
    .select({
      ...getTableColumns(task),
      assigneeName: userTable.name,
      assigneeAvatarUrl: userTable.image,
      subtaskCount: sql<number>`COALESCE(${subtaskCounts.cnt}, 0)`.as("subtaskCount"),
      subtaskCompletedCount: sql<number>`COALESCE(${subtaskCounts.completed}, 0)`.as("subtaskCompletedCount"),
      commentCount: sql<number>`COALESCE(${commentCounts.cnt}, 0)`.as("commentCount"),
      attachmentCount: sql<number>`COALESCE(${attachmentCounts.cnt}, 0)`.as("attachmentCount"),
      labelsJson: taskLabelsSubquery.labelsJson,
    })
    .from(task)
    .leftJoin(userTable, eq(task.assigneeId, userTable.id))
    .leftJoin(subtaskCounts, eq(task.id, subtaskCounts.taskId))
    .leftJoin(commentCounts, eq(task.id, commentCounts.taskId))
    .leftJoin(attachmentCounts, eq(task.id, attachmentCounts.taskId))
    .leftJoin(taskLabelsSubquery, eq(task.id, taskLabelsSubquery.taskId))
    .where(and(...conditions))
    .orderBy(asc(task.position));

  // Parse labels JSON for each task
  const tasksWithLabels = tasks.map((t) => {
    const { labelsJson, ...rest } = t;
    let labels: TaskLabelInfo[] = [];
    if (labelsJson) {
      try {
        labels = JSON.parse(labelsJson) as TaskLabelInfo[];
      } catch {
        labels = [];
      }
    }
    return { ...rest, labels };
  });

  return c.json({ tasks: tasksWithLabels });
}

export async function getTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const taskId = requireParam(c, "taskId");

  const [taskResult, subtasks, [{ value: commentCount }], taskLabels] = await db.batch([
    db.select().from(task).where(eq(task.id, taskId)).limit(1),
    db.select().from(subtask).where(eq(subtask.taskId, taskId)).orderBy(asc(subtask.position)),
    db.select({ value: count() }).from(comment).where(eq(comment.taskId, taskId)),
    db.select({
      id: label.id,
      name: label.name,
      color: label.color,
    })
      .from(taskLabel)
      .innerJoin(label, eq(taskLabel.labelId, label.id))
      .where(eq(taskLabel.taskId, taskId)),
  ] as const);

  const foundTask = taskResult[0];
  if (!foundTask) {
    return errorResponse(c, "Task not found", 404);
  }

  return c.json({
    task: {
      ...foundTask,
      subtasks,
      commentCount,
      labels: taskLabels,
    },
  });
}

export async function updateTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");
  const body = validJson(c, updateTaskSchema);

  // Fetch current task for activity logging
  const [currentTask] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!currentTask) {
    return errorResponse(c, "Task not found", 404);
  }

  const now = new Date();

  const updateData = {
    updatedAt: now,
    ...(body.title !== undefined && { title: body.title }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
    ...(body.priority !== undefined && { priority: body.priority }),
    ...(body.dueDate !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
    ...(body.cost !== undefined && { cost: body.cost }),
    ...(body.icon !== undefined && { icon: body.icon }),
    ...(body.coverImageKey !== undefined && { coverImageKey: body.coverImageKey }),
    ...(body.coverImagePosition !== undefined && { coverImagePosition: body.coverImagePosition }),
  };

  const [updated] = await db
    .update(task)
    .set(updateData)
    .where(eq(task.id, taskId))
    .returning();

  // Defer activity logging + notifications — runs after response is sent
  {
    const activities: ActivityEntry[] = [];

    if (body.assigneeId !== undefined && body.assigneeId !== currentTask.assigneeId) {
      activities.push({
        taskId,
        actorId: user.id,
        action: body.assigneeId ? "assigned" : "unassigned",
        field: "assigneeId",
        oldValue: currentTask.assigneeId,
        newValue: body.assigneeId,
      });
    }
    if (body.priority !== undefined && body.priority !== currentTask.priority) {
      activities.push({
        taskId,
        actorId: user.id,
        action: "priority_changed",
        field: "priority",
        oldValue: currentTask.priority,
        newValue: body.priority,
      });
    }
    if (body.title !== undefined && body.title !== currentTask.title) {
      activities.push({
        taskId,
        actorId: user.id,
        action: "title_changed",
        field: "title",
        oldValue: currentTask.title,
        newValue: body.title,
      });
    }
    if (body.dueDate !== undefined) {
      const oldDue = currentTask.dueDate ? currentTask.dueDate.toISOString() : null;
      const newDue = body.dueDate ?? null;
      if (oldDue !== newDue) {
        activities.push({
          taskId,
          actorId: user.id,
          action: newDue ? "due_date_changed" : "due_date_removed",
          field: "dueDate",
          oldValue: oldDue,
          newValue: newDue,
        });
      }
    }
    if (body.description !== undefined && body.description !== currentTask.description) {
      activities.push({
        taskId,
        actorId: user.id,
        action: "description_updated",
        field: "description",
      });
    }

    const assigneeForNotification = body.assigneeId !== undefined && body.assigneeId !== currentTask.assigneeId ? body.assigneeId : null;
    const taskTitle = currentTask.title;
    const projectId = currentTask.projectId;

    if (activities.length > 0 || assigneeForNotification) {
      deferWork(c, async () => {
        if (activities.length > 0) {
          await logActivityBatch(db, activities);
        }
        if (assigneeForNotification) {
          await createNotification(db, {
            userId: assigneeForNotification,
            type: "task_assigned",
            title: `You were assigned to "${taskTitle}"`,
            actorId: user.id,
            projectId,
            taskId,
          });
        }
      });
    }
  }

  // Non-blocking webhook dispatch for task.updated + additional events
  {
    const data = buildTaskEventData(updated);
    const changes = computeChanges(
      currentTask as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["title", "description", "assigneeId", "priority", "dueDate", "cost", "icon", "taskGroupId", "coverImageKey", "coverImagePosition"],
    );
    const additionalEvents = detectAdditionalEvents(
      "task.updated",
      currentTask as Record<string, unknown>,
      updated as Record<string, unknown>,
    );
    dispatchWebhook(c, currentTask.projectId, [
      { event: "task.updated", data, changes },
      ...additionalEvents.map((evt) => ({ event: evt, data, changes })),
    ]);
  }

  return c.json({ task: updated });
}

export async function deleteTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const taskId = requireParam(c, "taskId");

  // Fetch full task before deletion for webhook payload
  const [found] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!found) {
    return errorResponse(c, "Task not found", 404);
  }

  await db.delete(task).where(eq(task.id, taskId));

  // Non-blocking webhook dispatch for task.deleted
  dispatchWebhook(c, found.projectId, [
    { event: "task.deleted", data: buildTaskEventData(found) },
  ]);

  return c.json({ ok: true });
}
