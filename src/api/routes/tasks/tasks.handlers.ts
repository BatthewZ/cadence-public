import { and, asc, count, desc, eq, exists, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../../db";
import { user as userTable } from "../../../db/schema/auth";
import { label, taskLabel } from "../../../db/schema/label";
import { comment, subtask, task, taskActivity, taskGroup } from "../../../db/schema/task";
import { taskAttachment } from "../../../db/schema/task-attachment";
import { generateKeyBetween } from "../../../shared/lib/fractional-index";
import type { CreateCommentInput, UpdateCommentInput } from "../../../shared/schemas/comment";
import type { TaskLabelInfo } from "../../../shared/schemas/label";
import type { CreateSubtaskInput, UpdateSubtaskInput } from "../../../shared/schemas/subtask";
import type { CreateTaskInput, MoveTaskInput, UpdateTaskInput } from "../../../shared/schemas/task";
import type { AppEnv } from "../../env";
import { resolveProjectAccess } from "../../lib/access";
import { handleDeleteCover, handleUploadCover } from "../../lib/cover-image";
import { deferWork } from "../../lib/defer";
import { parseMentions } from "../../lib/mentions";
import { createNotification, createNotifications } from "../../lib/notifications";
import { compoundCursorCondition, computeCompoundNextCursor, parseCompoundCursor, parseCursorParams } from "../../lib/pagination";
import {
  buildTaskEventData,
  computeChanges,
  detectAdditionalEvents,
  fireWebhookEvent,
} from "../../lib/webhook-payloads";
import { type ActivityEntry, logActivity, logActivityBatch } from "./log-activity";

// ---------------------------------------------------------------------------
// Task Handlers
// ---------------------------------------------------------------------------

export async function createTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { projectId } = c.req.param();
  const body = c.req.valid("json" as never) as CreateTaskInput;

  // Batch: taskGroup existence check + last position query (independent — both use upfront IDs)
  const [groupResult, lastTaskResult] = await db.batch([
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
  ] as const);

  const group = groupResult[0];
  if (!group) {
    return c.json({ error: "Task group not found in this project" }, 404);
  }

  const position = generateKeyBetween(lastTaskResult[0]?.position ?? null, null);

  const id = crypto.randomUUID();
  const now = new Date();

  const isCompleted = group.isCompletionGroup;

  const newTask = {
    id,
    projectId,
    taskGroupId: body.taskGroupId,
    title: body.title,
    description: body.description ?? null,
    assigneeId: body.assigneeId ?? null,
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
    if (body.assigneeId) {
      await createNotification(db, {
        userId: body.assigneeId,
        type: "task_assigned",
        title: `You were assigned to "${body.title}"`,
        actorId: user.id,
        projectId,
        taskId: id,
      });
    }
  });

  // Non-blocking webhook dispatch for task.created
  const createWorkspaceId = c.get("currentProject")?.workspaceId;
  if (createWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: createWorkspaceId, actorId: user.id, projectId }, [
      { event: "task.created", data: buildTaskEventData(newTask as Parameters<typeof buildTaskEventData>[0]) },
    ]);
  }

  return c.json({ task: newTask }, 201);
}

export async function listTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = c.req.param();

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
  const { taskId } = c.req.param();

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
    return c.json({ error: "Task not found" }, 404);
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
  const { taskId } = c.req.param();
  const body = c.req.valid("json" as never) as UpdateTaskInput;

  // Fetch current task for activity logging
  const [currentTask] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!currentTask) {
    return c.json({ error: "Task not found" }, 404);
  }

  const now = new Date();

  const updateData: Record<string, unknown> = { updatedAt: now };
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.assigneeId !== undefined) updateData.assigneeId = body.assigneeId;
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.dueDate !== undefined) {
    updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  }
  if (body.cost !== undefined) updateData.cost = body.cost;
  if (body.icon !== undefined) updateData.icon = body.icon;
  if (body.coverImageKey !== undefined) updateData.coverImageKey = body.coverImageKey;
  if (body.coverImagePosition !== undefined) updateData.coverImagePosition = body.coverImagePosition;

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
  const updateWorkspaceId = c.get("currentProject")?.workspaceId;
  if (updateWorkspaceId) {
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
    fireWebhookEvent(
      db, () => c.executionCtx,
      { workspaceId: updateWorkspaceId, actorId: user.id, projectId: currentTask.projectId },
      [
        { event: "task.updated", data, changes },
        ...additionalEvents.map((evt) => ({ event: evt, data, changes })),
      ],
    );
  }

  return c.json({ task: updated });
}

export async function deleteTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { taskId } = c.req.param();

  // Fetch full task before deletion for webhook payload
  const [found] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!found) {
    return c.json({ error: "Task not found" }, 404);
  }

  await db.delete(task).where(eq(task.id, taskId));

  // Non-blocking webhook dispatch for task.deleted
  const deleteWorkspaceId = c.get("currentProject")?.workspaceId;
  if (deleteWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: deleteWorkspaceId, actorId: user.id, projectId: found.projectId }, [
      { event: "task.deleted", data: buildTaskEventData(found) },
    ]);
  }

  return c.json({ ok: true });
}

export async function moveTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { taskId } = c.req.param();
  const body = c.req.valid("json" as never) as MoveTaskInput;

  // Batch task + target group lookup in a single round-trip
  const [taskResult, groupResult] = await db.batch([
    db.select().from(task).where(eq(task.id, taskId)).limit(1),
    db.select().from(taskGroup).where(eq(taskGroup.id, body.taskGroupId)).limit(1),
  ] as const);

  const foundTask = taskResult[0];
  if (!foundTask) {
    return c.json({ error: "Task not found" }, 404);
  }

  const targetGroup = groupResult[0];
  if (!targetGroup || targetGroup.projectId !== foundTask.projectId) {
    return c.json({ error: "Target task group not found in this project" }, 404);
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
  const moveWorkspaceId = c.get("currentProject")?.workspaceId;
  if (moveWorkspaceId) {
    const moveData = buildTaskEventData(updated);
    const moveChanges = { taskGroupId: { from: foundTask.taskGroupId, to: body.taskGroupId } };
    const moveEvents: Parameters<typeof fireWebhookEvent>[3] = [
      { event: "task.moved", data: moveData, changes: moveChanges },
    ];
    if (targetGroup.isCompletionGroup && !foundTask.completed) {
      moveEvents.push({ event: "task.completed", data: moveData });
    }
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: moveWorkspaceId, actorId: user.id, projectId: foundTask.projectId }, moveEvents);
  }

  return c.json({ task: updated });
}

// ---------------------------------------------------------------------------
// Duplicate Task Handler
// ---------------------------------------------------------------------------

export async function duplicateTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { taskId } = c.req.param();

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
    return c.json({ error: "Task not found" }, 404);
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
      throw error;
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
      throw error;
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
  const dupWorkspaceId = c.get("currentProject")?.workspaceId;
  if (dupWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: dupWorkspaceId, actorId: user.id, projectId: sourceTask.projectId }, [
      { event: "task.created", data: buildTaskEventData(newTask as Parameters<typeof buildTaskEventData>[0]) },
    ]);
  }

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

// ---------------------------------------------------------------------------
// Subtask Handlers
// ---------------------------------------------------------------------------

export async function createSubtask(c: Context<AppEnv>) {
  const db = c.get("db");
  const { taskId } = c.req.param();
  const body = c.req.valid("json" as never) as CreateSubtaskInput;

  // Generate position: place at end
  const [lastSubtask] = await db
    .select({ position: subtask.position })
    .from(subtask)
    .where(eq(subtask.taskId, taskId))
    .orderBy(desc(subtask.position))
    .limit(1);

  const position = generateKeyBetween(lastSubtask?.position ?? null, null);

  const id = crypto.randomUUID();
  const now = new Date();

  const newSubtask = {
    id,
    taskId,
    title: body.title,
    completed: false,
    position,
    createdAt: now,
  };

  await db.insert(subtask).values(newSubtask);

  return c.json({ subtask: newSubtask }, 201);
}

export async function updateSubtask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { subtaskId } = c.req.param();
  const body = c.req.valid("json" as never) as UpdateSubtaskInput;

  // Look up the subtask and verify project access
  const [found] = await db
    .select()
    .from(subtask)
    .where(eq(subtask.id, subtaskId))
    .limit(1);

  if (!found) {
    return c.json({ error: "Subtask not found" }, 404);
  }

  // Look up the parent task to get projectId
  const [parentTask] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, found.taskId))
    .limit(1);

  if (!parentTask) {
    return c.json({ error: "Parent task not found" }, 404);
  }

  // Verify project access
  const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

  if (!accessResult) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Viewers cannot modify subtasks
  if (accessResult.role === "viewer") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.completed !== undefined) updateData.completed = body.completed;
  if (body.position !== undefined) updateData.position = body.position;

  const [updated] = await db
    .update(subtask)
    .set(updateData)
    .where(eq(subtask.id, subtaskId))
    .returning();

  return c.json({ subtask: updated });
}

export async function deleteSubtask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { subtaskId } = c.req.param();

  // Look up the subtask
  const [found] = await db
    .select()
    .from(subtask)
    .where(eq(subtask.id, subtaskId))
    .limit(1);

  if (!found) {
    return c.json({ error: "Subtask not found" }, 404);
  }

  // Look up the parent task to get projectId
  const [parentTask] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, found.taskId))
    .limit(1);

  if (!parentTask) {
    return c.json({ error: "Parent task not found" }, 404);
  }

  // Verify project access
  const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

  if (!accessResult) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Viewers cannot delete subtasks
  if (accessResult.role === "viewer") {
    return c.json({ error: "Forbidden" }, 403);
  }

  await db.delete(subtask).where(eq(subtask.id, subtaskId));

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Comment Handlers
// ---------------------------------------------------------------------------

export async function createComment(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { taskId } = c.req.param();
  const body = c.req.valid("json" as never) as CreateCommentInput;

  const id = crypto.randomUUID();
  const now = new Date();

  const newComment = {
    id,
    taskId,
    authorId: user.id,
    body: body.body,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(comment).values(newComment);

  try {
    const [parentTask] = await db
      .select({ title: task.title, projectId: task.projectId })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);

    if (parentTask) {
      const mentionedUserIds = await parseMentions(db, body.body, parentTask.projectId);
      if (mentionedUserIds.length > 0) {
        await createNotifications(db, mentionedUserIds, {
          type: "task_comment_mention",
          title: `${user.name} mentioned you in a comment on "${parentTask.title}"`,
          body: body.body.substring(0, 200),
          actorId: user.id,
          projectId: parentTask.projectId,
          taskId,
          commentId: id,
        });
      }
    }
  } catch (error) {
    console.error("Failed to process mentions or notifications for createComment:", error);
    // Non-fatal: comment was already created
  }

  try {
    await logActivity(db, {
      taskId,
      actorId: user.id,
      action: "comment_added",
      newValue: body.body.substring(0, 100),
    });
  } catch (error) {
    console.error("Failed to log activity for createComment:", error);
    // Non-fatal: comment was already created
  }

  // Non-blocking webhook dispatch for task.comment_created
  const commentWorkspaceId = c.get("currentProject")?.workspaceId;
  if (commentWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: commentWorkspaceId, actorId: user.id, projectId: c.get("currentProject")!.id }, [
      {
        event: "task.comment_created",
        data: {
          id: newComment.id,
          taskId: newComment.taskId,
          authorId: newComment.authorId,
          body: newComment.body,
          createdAt: newComment.createdAt.toISOString(),
          updatedAt: newComment.updatedAt.toISOString(),
        },
      },
    ]);
  }

  return c.json({ comment: { ...newComment, authorName: user.name } }, 201);
}

export async function updateComment(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { commentId } = c.req.param();
  const body = c.req.valid("json" as never) as UpdateCommentInput;

  // Look up the comment
  const [found] = await db
    .select()
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);

  if (!found) {
    return c.json({ error: "Comment not found" }, 404);
  }

  // Only the author can edit their own comment
  if (found.authorId !== user.id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Verify the user still has access to the project
  const [parentTask] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, found.taskId))
    .limit(1);

  if (!parentTask) {
    return c.json({ error: "Parent task not found" }, 404);
  }

  const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

  if (!accessResult) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const now = new Date();

  const [updated] = await db
    .update(comment)
    .set({ body: body.body, updatedAt: now })
    .where(eq(comment.id, commentId))
    .returning();

  try {
    await logActivity(db, {
      taskId: found.taskId,
      actorId: user.id,
      action: "comment_updated",
    });
  } catch (error) {
    console.error("Failed to log activity for updateComment:", error);
    // Non-fatal: comment was already updated
  }

  return c.json({ comment: updated });
}

export async function deleteComment(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { commentId } = c.req.param();

  // Look up the comment
  const [found] = await db
    .select()
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);

  if (!found) {
    return c.json({ error: "Comment not found" }, 404);
  }

  // Non-authors must be a project admin to delete
  if (found.authorId !== user.id) {
    const [parentTask] = await db
      .select({ projectId: task.projectId })
      .from(task)
      .where(eq(task.id, found.taskId))
      .limit(1);

    if (!parentTask) {
      return c.json({ error: "Parent task not found" }, 404);
    }

    const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

    if (!accessResult || accessResult.role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  await db.delete(comment).where(eq(comment.id, commentId));

  try {
    await logActivity(db, {
      taskId: found.taskId,
      actorId: user.id,
      action: "comment_deleted",
    });
  } catch (error) {
    console.error("Failed to log activity for deleteComment:", error);
    // Non-fatal: comment was already deleted
  }

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// List Comments (Paginated)
// ---------------------------------------------------------------------------

export async function listComments(c: Context<AppEnv>) {
  const db = c.get("db");
  const { taskId } = c.req.param();

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 20, maxLimit: 100 });

  const conditions = [eq(comment.taskId, taskId)];
  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(compoundCursorCondition(compound, comment.createdAt, comment.id, "asc"));
  }

  const comments = await db
    .select({
      id: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      authorName: userTable.name,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    })
    .from(comment)
    .leftJoin(userTable, eq(comment.authorId, userTable.id))
    .where(and(...conditions))
    .orderBy(asc(comment.createdAt), asc(comment.id))
    .limit(limit);

  const nextCursor = computeCompoundNextCursor(comments, limit, (r) => r.createdAt, (r) => r.id);

  return c.json({
    comments: comments.map((r) => ({
      ...r,
      authorName: r.authorName ?? "Unknown",
    })),
    nextCursor,
  });
}

// ---------------------------------------------------------------------------
// Complete / Uncomplete Handlers
// ---------------------------------------------------------------------------

export async function completeTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { taskId } = c.req.param();

  const [foundTask] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!foundTask) {
    return c.json({ error: "Task not found" }, 404);
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
    .orderBy(asc(taskGroup.position))
    .limit(1);

  const updateData: Record<string, unknown> = {
    completed: true,
    completedAt: now,
    completedBy: user.id,
    updatedAt: now,
  };

  // Move to completion group if one exists and task isn't already there
  const movingToCompletion = completionGroup && foundTask.taskGroupId !== completionGroup.id;
  if (movingToCompletion) {
    // Position at the top of the completion group
    const [firstTask] = await db
      .select({ position: task.position })
      .from(task)
      .where(eq(task.taskGroupId, completionGroup.id))
      .orderBy(asc(task.position))
      .limit(1);

    const completionPosition = generateKeyBetween(null, firstTask?.position ?? null);
    updateData.taskGroupId = completionGroup.id;
    updateData.position = completionPosition;
  }

  const [updated] = await db
    .update(task)
    .set(updateData)
    .where(eq(task.id, taskId))
    .returning();

  // Defer activity logging + notifications — runs after response is sent
  {
    const oldTaskGroupId = foundTask.taskGroupId;
    const completionGroupName = completionGroup?.name;
    const assigneeId = foundTask.assigneeId;
    const taskTitle = foundTask.title;
    const projectId = foundTask.projectId;

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
    });
  }

  // Non-blocking webhook dispatch for task.completed
  const completeWorkspaceId = c.get("currentProject")?.workspaceId;
  if (completeWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: completeWorkspaceId, actorId: user.id, projectId: foundTask.projectId }, [
      { event: "task.completed", data: buildTaskEventData(updated) },
    ]);
  }

  return c.json({ task: updated });
}

export async function uncompleteTask(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { taskId } = c.req.param();

  const [foundTask] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!foundTask) {
    return c.json({ error: "Task not found" }, 404);
  }

  if (!foundTask.completed) {
    return c.json({ task: foundTask });
  }

  const now = new Date();

  const updateData: Record<string, unknown> = {
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
      .orderBy(asc(taskGroup.position))
      .limit(1);

    if (firstNonCompletionGroup) {
      // Position at the top of the target group
      const [firstTask] = await db
        .select({ position: task.position })
        .from(task)
        .where(eq(task.taskGroupId, firstNonCompletionGroup.id))
        .orderBy(asc(task.position))
        .limit(1);

      const uncompletePosition = generateKeyBetween(null, firstTask?.position ?? null);
      updateData.taskGroupId = firstNonCompletionGroup.id;
      updateData.position = uncompletePosition;

      moveFromName = currentGroup.name;
      moveToName = firstNonCompletionGroup.name;
    }
  }

  const [updated] = await db
    .update(task)
    .set(updateData)
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
  const uncompleteWorkspaceId = c.get("currentProject")?.workspaceId;
  if (uncompleteWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: uncompleteWorkspaceId, actorId: user.id, projectId: foundTask.projectId }, [
      { event: "task.uncompleted", data: buildTaskEventData(updated) },
    ]);
  }

  return c.json({ task: updated });
}

// ---------------------------------------------------------------------------
// Activity Handlers
// ---------------------------------------------------------------------------

export async function getTaskActivity(c: Context<AppEnv>) {
  const db = c.get("db");
  const { taskId } = c.req.param();

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 5, maxLimit: 100 });

  const conditions = [eq(taskActivity.taskId, taskId)];
  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(compoundCursorCondition(compound, taskActivity.createdAt, taskActivity.id, "desc"));
  }

  const activities = await db
    .select({
      id: taskActivity.id,
      taskId: taskActivity.taskId,
      actorId: taskActivity.actorId,
      actorName: userTable.name,
      actorImage: userTable.image,
      action: taskActivity.action,
      field: taskActivity.field,
      oldValue: taskActivity.oldValue,
      newValue: taskActivity.newValue,
      createdAt: taskActivity.createdAt,
    })
    .from(taskActivity)
    .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
    .where(and(...conditions))
    .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
    .limit(limit);

  const nextCursor = computeCompoundNextCursor(activities, limit, (a) => a.createdAt, (a) => a.id);

  return c.json({ activities, nextCursor });
}

// ---------------------------------------------------------------------------
// Cover Image Handlers
// ---------------------------------------------------------------------------

/**
 * Looks up a task by ID and verifies the caller has project access.
 * Uses cached project access from middleware when available to avoid a
 * redundant DB round-trip.
 */
function taskCoverEntity(c: Context<AppEnv>, taskId: string) {
  const cachedAccess = c.get("projectAccess");
  return async (db: Database) => {
    const [foundTask] = await db
      .select({ id: task.id, coverImageKey: task.coverImageKey, projectId: task.projectId })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);
    if (!foundTask) return null;
    // Use cached project access from middleware when available, otherwise re-query
    if (cachedAccess) return foundTask;
    const user = c.get("user")!;
    const accessResult = await resolveProjectAccess(db, foundTask.projectId, user.id);
    if (!accessResult) return null;
    return foundTask;
  };
}

export async function uploadTaskCover(c: Context<AppEnv>) {
  const { taskId } = c.req.param();
  return handleUploadCover(c, {
    purpose: "task-cover",
    getEntity: taskCoverEntity(c, taskId),
    setEntityCover: async (db, key, updatedAt) => {
      await db
        .update(task)
        .set({ coverImageKey: key, updatedAt })
        .where(eq(task.id, taskId));
    },
  });
}

export async function deleteTaskCover(c: Context<AppEnv>) {
  const { taskId } = c.req.param();
  return handleDeleteCover(c, {
    purpose: "task-cover",
    entityLabel: "task",
    getEntity: taskCoverEntity(c, taskId),
    setEntityCover: async (db, _key, updatedAt) => {
      await db
        .update(task)
        .set({ coverImageKey: null, updatedAt })
        .where(eq(task.id, taskId));
    },
  });
}
