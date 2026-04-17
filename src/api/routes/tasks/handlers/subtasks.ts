import { desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { subtask, task } from "../../../../db/schema/task";
import { generateKeyBetween } from "../../../../shared/lib/fractional-index";
import { createSubtaskSchema, updateSubtaskSchema } from "../../../../shared/schemas/subtask";
import type { AppEnv } from "../../../env";
import { resolveProjectAccess } from "../../../lib/access";
import { errorResponse } from "../../../lib/error-response";
import { requireParam } from "../../../lib/params";
import { retryOnPositionConflict } from "../../../lib/position-conflict";
import { validJson } from "../../../lib/validated";

// ---------------------------------------------------------------------------
// Subtask Handlers
// ---------------------------------------------------------------------------

export async function createSubtask(c: Context<AppEnv>) {
  const db = c.get("db");
  const taskId = requireParam(c, "taskId");
  const body = validJson(c, createSubtaskSchema);

  const id = crypto.randomUUID();
  const now = new Date();

  // Read last position + insert inside a retry loop — concurrent subtask
  // creates on the same task can race and produce identical positions.
  // The UNIQUE index on (taskId, position) catches the race; we retry
  // with a fresh read. The parent task's updatedAt bump is batched with
  // the insert so both succeed atomically per attempt.
  const newSubtask = await retryOnPositionConflict(async () => {
    const [lastSubtask] = await db
      .select({ position: subtask.position })
      .from(subtask)
      .where(eq(subtask.taskId, taskId))
      .orderBy(desc(subtask.position))
      .limit(1);

    const position = generateKeyBetween(lastSubtask?.position ?? null, null);

    const row = {
      id,
      taskId,
      title: body.title,
      completed: false,
      position,
      createdAt: now,
    };

    await db.batch([
      db.insert(subtask).values(row),
      db.update(task).set({ updatedAt: now }).where(eq(task.id, taskId)),
    ] as const);

    return row;
  });

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

  const now = new Date();
  const [[updated]] = await db.batch([
    db.update(subtask).set(updateData).where(eq(subtask.id, subtaskId)).returning(),
    db.update(task).set({ updatedAt: now }).where(eq(task.id, found.taskId)),
  ] as const);

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

  const now = new Date();
  await db.batch([
    db.delete(subtask).where(eq(subtask.id, subtaskId)),
    db.update(task).set({ updatedAt: now }).where(eq(task.id, found.taskId)),
  ] as const);

  return c.json({ ok: true });
}
