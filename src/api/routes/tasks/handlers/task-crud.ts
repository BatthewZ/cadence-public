import { and, asc, count, desc, eq, exists, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../../db/schema/auth";
import { label, taskLabel } from "../../../../db/schema/label";
import { project } from "../../../../db/schema/project";
import { comment, subtask, task, taskGroup } from "../../../../db/schema/task";
import { taskAttachment } from "../../../../db/schema/task-attachment";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import { parseRecurrenceRule } from "../../../../shared/lib/recurrence";
import type { TaskLabelInfo } from "../../../../shared/schemas/label";
import { createTaskSchema, updateTaskSchema } from "../../../../shared/schemas/task";
import type { AppEnv } from "../../../env";
import { deferWork } from "../../../lib/defer";
import { errorResponse } from "../../../lib/error-response";
import { createNotification } from "../../../lib/notifications";
import { requireParam } from "../../../lib/params";
import { retryOnPositionConflict } from "../../../lib/position-conflict";
import { validJson } from "../../../lib/validated";
import {
  buildTaskEventData,
  computeChanges,
  detectAdditionalEvents,
  dispatchWebhook,
  resolveTaskEnrichment,
  resolveTaskGroup,
  resolveUser,
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

  // Batch the invariant reads (group existence + project settings). The
  // last-task-position read is intentionally kept out of the batch because
  // it must be re-read on every retry attempt inside the position-conflict
  // loop below.
  const [groupResult, projectResult] = await db.batch([
    db.select()
      .from(taskGroup)
      .where(
        and(
          eq(taskGroup.id, body.taskGroupId),
          eq(taskGroup.projectId, projectId),
        ),
      )
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

  const id = crypto.randomUUID();
  const now = new Date();

  const isCompleted = group.isCompletionGroup;

  const assigneeId = body.assigneeId !== undefined
    ? (body.assigneeId ?? null)
    : (projectResult[0]?.autoAssignCreator ? user.id : null);

  // If recurrence is set but no dueDate provided, default dueDate to today
  const dueDate = body.dueDate
    ? new Date(body.dueDate)
    : (body.recurrenceRule ? now : null);

  // Read last position + insert inside a retry loop — the UNIQUE index on
  // (taskGroupId, position) catches any race with concurrent creates in
  // the same group and we retry with a fresh position.
  const newTask = await retryOnPositionConflict(async () => {
    const [lastTaskRow] = await db
      .select({ position: task.position })
      .from(task)
      .where(eq(task.taskGroupId, body.taskGroupId))
      .orderBy(desc(task.position))
      .limit(1);

    const position = generateKeyBetween(lastTaskRow?.position ?? null, null);

    const row = {
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
      dueDate,
      cost: body.cost ?? null,
      icon: body.icon ?? null,
      recurrenceRule: body.recurrenceRule ? JSON.stringify(body.recurrenceRule) : null,
      recurrenceSeriesId: body.recurrenceRule ? crypto.randomUUID() : null,
      recurrenceParentId: null,
      position,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(task).values(row);
    return row;
  });

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
  const createdEnrichment = await resolveTaskEnrichment(db, newTask as Parameters<typeof resolveTaskEnrichment>[1]);
  dispatchWebhook(c, projectId, [
    { event: "task.created", data: buildTaskEventData(newTask as Parameters<typeof buildTaskEventData>[0], createdEnrichment) },
  ]);

  // Enrich response with assignee display fields so the frontend can render
  // the avatar immediately without waiting for a full task list refetch.
  let assigneeName: string | null = null;
  let assigneeAvatarUrl: string | null = null;
  if (newTask.assigneeId) {
    if (newTask.assigneeId === user.id) {
      assigneeName = user.name;
      assigneeAvatarUrl = user.image ?? null;
    } else {
      const [assignee] = await db
        .select({ name: userTable.name, image: userTable.image })
        .from(userTable)
        .where(eq(userTable.id, newTask.assigneeId))
        .limit(1);
      if (assignee) {
        assigneeName = assignee.name;
        assigneeAvatarUrl = assignee.image ?? null;
      }
    }
  }

  // Parse recurrenceRule back from JSON string for the response
  const { recurrenceRule: rawRecurrenceRule, ...newTaskFields } = newTask;

  return c.json({ task: { ...newTaskFields, recurrenceRule: parseRecurrenceRule(rawRecurrenceRule), assigneeName, assigneeAvatarUrl } }, 201);
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
    .orderBy(asc(task.position), asc(task.id));

  // Parse labels JSON and recurrenceRule JSON for each task
  const tasksWithLabels = tasks.map((t) => {
    const { labelsJson, recurrenceRule: recurrenceRuleJson, ...rest } = t;
    let labels: TaskLabelInfo[] = [];
    if (labelsJson) {
      try {
        labels = JSON.parse(labelsJson) as TaskLabelInfo[];
      } catch {
        labels = [];
      }
    }
    return { ...rest, recurrenceRule: parseRecurrenceRule(recurrenceRuleJson), labels };
  });

  return c.json({ tasks: tasksWithLabels });
}

export async function getTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const taskId = requireParam(c, "taskId");

  const [taskResult, subtasks, [{ value: commentCount }], taskLabels] = await db.batch([
    db.select().from(task).where(eq(task.id, taskId)).limit(1),
    db.select().from(subtask).where(eq(subtask.taskId, taskId)).orderBy(asc(subtask.position), asc(subtask.id)),
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

  const { recurrenceRule: recurrenceRuleJson, ...taskFields } = foundTask;

  return c.json({
    task: {
      ...taskFields,
      recurrenceRule: parseRecurrenceRule(recurrenceRuleJson),
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
    ...(body.recurrenceRule !== undefined && {
      recurrenceRule: body.recurrenceRule ? JSON.stringify(body.recurrenceRule) : null,
    }),
    ...(body.recurrenceRule !== undefined && body.recurrenceRule !== null && !currentTask.recurrenceSeriesId && {
      recurrenceSeriesId: crypto.randomUUID(),
    }),
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
    if (body.recurrenceRule !== undefined) {
      const oldRule = currentTask.recurrenceRule;
      const newRule = body.recurrenceRule ? JSON.stringify(body.recurrenceRule) : null;
      if (oldRule !== newRule) {
        activities.push({
          taskId,
          actorId: user.id,
          action: body.recurrenceRule ? "recurrence_changed" : "recurrence_removed",
          field: "recurrenceRule",
        });
      }
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
    const updatedEnrichment = await resolveTaskEnrichment(db, updated);
    const data = buildTaskEventData(updated, updatedEnrichment);
    const changes = computeChanges(
      currentTask as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["title", "description", "assigneeId", "priority", "dueDate", "cost", "icon", "taskGroupId", "coverImageKey", "coverImagePosition", "recurrenceRule"],
    );

    // Enrich ID-only changes with human-readable objects
    if (changes) {
      if (changes.assigneeId) {
        const [prevUser, nextUser] = await Promise.all([
          resolveUser(db, changes.assigneeId.from as string | null),
          resolveUser(db, changes.assigneeId.to as string | null),
        ]);
        changes.assignee = { from: prevUser, to: nextUser };
      }
      if (changes.taskGroupId) {
        const [prevGroup, nextGroup] = await Promise.all([
          resolveTaskGroup(db, changes.taskGroupId.from as string | null),
          resolveTaskGroup(db, changes.taskGroupId.to as string | null),
        ]);
        changes.taskGroup = { from: prevGroup, to: nextGroup };
      }
    }

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

  const { recurrenceRule: updatedRuleJson, ...updatedFields } = updated;

  return c.json({ task: { ...updatedFields, recurrenceRule: parseRecurrenceRule(updatedRuleJson) } });
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
  const deletedEnrichment = await resolveTaskEnrichment(db, found);
  dispatchWebhook(c, found.projectId, [
    { event: "task.deleted", data: buildTaskEventData(found, deletedEnrichment) },
  ]);

  return c.json({ ok: true });
}
