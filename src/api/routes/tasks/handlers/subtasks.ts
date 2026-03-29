import { desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { subtask, task } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import { createSubtaskSchema, updateSubtaskSchema } from "../../../../shared/schemas/subtask";
import type { AppEnv } from "../../../env";
import { resolveProjectAccess } from "../../../lib/access";
import { errorResponse } from "../../../lib/error-response";
import { requireParam } from "../../../lib/params";
import { validJson } from "../../../lib/validated";

// ---------------------------------------------------------------------------
// Subtask Handlers
// ---------------------------------------------------------------------------

export async function createSubtask(c: Context<AppEnv>) {
  const db = c.get("db");
  const taskId = requireParam(c, "taskId");
  const body = validJson(c, createSubtaskSchema);

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
  const subtaskId = requireParam(c, "subtaskId");
  const body = validJson(c, updateSubtaskSchema);

  // Look up the subtask and verify project access
  const [found] = await db
    .select()
    .from(subtask)
    .where(eq(subtask.id, subtaskId))
    .limit(1);

  if (!found) {
    return errorResponse(c, "Subtask not found", 404);
  }

  // Look up the parent task to get projectId
  const [parentTask] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, found.taskId))
    .limit(1);

  if (!parentTask) {
    return errorResponse(c, "Parent task not found", 404);
  }

  // Verify project access
  const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

  if (!accessResult) {
    return errorResponse(c, "Forbidden", 403);
  }

  // Viewers cannot modify subtasks
  if (accessResult.role === "viewer") {
    return errorResponse(c, "Forbidden", 403);
  }

  const updateData = {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.completed !== undefined && { completed: body.completed }),
    ...(body.position !== undefined && { position: body.position }),
  };

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
  const subtaskId = requireParam(c, "subtaskId");

  // Look up the subtask
  const [found] = await db
    .select()
    .from(subtask)
    .where(eq(subtask.id, subtaskId))
    .limit(1);

  if (!found) {
    return errorResponse(c, "Subtask not found", 404);
  }

  // Look up the parent task to get projectId
  const [parentTask] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, found.taskId))
    .limit(1);

  if (!parentTask) {
    return errorResponse(c, "Parent task not found", 404);
  }

  // Verify project access
  const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

  if (!accessResult) {
    return errorResponse(c, "Forbidden", 403);
  }

  // Viewers cannot delete subtasks
  if (accessResult.role === "viewer") {
    return errorResponse(c, "Forbidden", 403);
  }

  await db.delete(subtask).where(eq(subtask.id, subtaskId));

  return c.json({ ok: true });
}
