import { asc, count, desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../../db";
import { task, taskGroup } from "../../../db/schema/task";
import { generateKeyBetween } from "../../../shared/lib/fractional-index";
import { createTaskGroupSchema, reorderTaskGroupSchema, updateTaskGroupSchema } from "../../../shared/schemas/task-group";
import type { AppEnv } from "../../env";
import { resolveProjectAccess } from "../../lib/access";
import { errorResponse } from "../../lib/error-response";
import { requireParam } from "../../lib/params";
import { validJson } from "../../lib/validated";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a taskGroup by id, then verify the current user has project access.
 * Returns the taskGroup and effective role, or null if not found / no access.
 *
 * Delegates the project access check to the shared resolveProjectAccess
 * function, keeping the task-group lookup as the only concern here.
 */
async function resolveTaskGroupWithAccess(
  db: Database,
  taskGroupId: string,
  userId: string,
) {
  const [group] = await db
    .select()
    .from(taskGroup)
    .where(eq(taskGroup.id, taskGroupId))
    .limit(1);

  if (!group) return null;

  const accessResult = await resolveProjectAccess(db, group.projectId, userId);

  if (!accessResult) return null;

  return { group, role: accessResult.role };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function createTaskGroup(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, createTaskGroupSchema);

  // Find the last task group by position to generate the next position
  const [lastGroup] = await db
    .select({ position: taskGroup.position })
    .from(taskGroup)
    .where(eq(taskGroup.projectId, projectId))
    .orderBy(desc(taskGroup.position))
    .limit(1);

  const position = generateKeyBetween(lastGroup?.position ?? null, null);

  const id = crypto.randomUUID();
  const now = new Date();

  const newGroup = {
    id,
    projectId,
    name: body.name,
    color: body.color ?? null,
    position,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(taskGroup).values(newGroup);

  return c.json({ taskGroup: newGroup }, 201);
}

export async function listTaskGroups(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");

  // Batch groups + task counts in a single round-trip
  const [groups, taskCounts] = await db.batch([
    db.select().from(taskGroup)
      .where(eq(taskGroup.projectId, projectId))
      .orderBy(asc(taskGroup.position)),
    db.select({ taskGroupId: task.taskGroupId, count: count() })
      .from(task)
      .where(eq(task.projectId, projectId))
      .groupBy(task.taskGroupId),
  ] as const);

  const taskCountMap = new Map(
    taskCounts.map((tc) => [tc.taskGroupId, tc.count]),
  );

  const enrichedGroups = groups.map((g) => ({
    ...g,
    taskCount: taskCountMap.get(g.id) ?? 0,
  }));

  return c.json({ taskGroups: enrichedGroups });
}

export async function updateTaskGroup(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskGroupId = requireParam(c, "taskGroupId");
  const body = validJson(c, updateTaskGroupSchema);

  const result = await resolveTaskGroupWithAccess(db, taskGroupId, user.id);

  if (!result) {
    return errorResponse(c, "Not found", 404);
  }

  if (result.role !== "admin" && result.role !== "member") {
    return errorResponse(c, "Forbidden", 403);
  }

  const now = new Date();

  const updateData: Record<string, unknown> = { updatedAt: now };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.isCompletionGroup !== undefined) updateData.isCompletionGroup = body.isCompletionGroup;

  const [updated] = await db
    .update(taskGroup)
    .set(updateData)
    .where(eq(taskGroup.id, taskGroupId))
    .returning();

  return c.json({ taskGroup: updated });
}

export async function deleteTaskGroup(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskGroupId = requireParam(c, "taskGroupId");

  const result = await resolveTaskGroupWithAccess(db, taskGroupId, user.id);

  if (!result) {
    return errorResponse(c, "Not found", 404);
  }

  if (result.role !== "admin") {
    return errorResponse(c, "Forbidden", 403);
  }

  // targetGroupId is required in query params to reassign tasks
  const targetGroupId = c.req.query("targetGroupId");

  if (!targetGroupId) {
    return errorResponse(c, "targetGroupId query parameter is required to reassign tasks", 400);
  }

  if (targetGroupId === taskGroupId) {
    return errorResponse(c, "targetGroupId must be different from the group being deleted", 400);
  }

  // Verify target group exists and belongs to the same project
  const [targetGroup] = await db
    .select()
    .from(taskGroup)
    .where(eq(taskGroup.id, targetGroupId))
    .limit(1);

  if (!targetGroup || targetGroup.projectId !== result.group.projectId) {
    return errorResponse(c, "Target group not found in this project", 404);
  }

  // Batch: move tasks to target group, then delete the group (order preserved)
  await db.batch([
    db.update(task)
      .set({ taskGroupId: targetGroupId, updatedAt: new Date() })
      .where(eq(task.taskGroupId, taskGroupId)),
    db.delete(taskGroup).where(eq(taskGroup.id, taskGroupId)),
  ] as const);

  return c.json({ ok: true });
}

export async function reorderTaskGroup(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskGroupId = requireParam(c, "taskGroupId");
  const body = validJson(c, reorderTaskGroupSchema);

  const result = await resolveTaskGroupWithAccess(db, taskGroupId, user.id);

  if (!result) {
    return errorResponse(c, "Not found", 404);
  }

  if (result.role !== "admin" && result.role !== "member") {
    return errorResponse(c, "Forbidden", 403);
  }

  const now = new Date();

  const [updated] = await db
    .update(taskGroup)
    .set({ position: body.position, updatedAt: now })
    .where(eq(taskGroup.id, taskGroupId))
    .returning();

  return c.json({ taskGroup: updated });
}
