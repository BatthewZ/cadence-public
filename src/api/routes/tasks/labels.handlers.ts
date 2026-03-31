import { and, count, eq } from "drizzle-orm";
import type { Context } from "hono";

import { label, taskLabel } from "../../../db/schema/label";
import { task } from "../../../db/schema/task";
import { assignLabelSchema } from "../../../shared/schemas/label";
import { MAX_LABELS_PER_TASK } from "../../../shared/schemas/label";
import type { AppEnv } from "../../env";
import { deferWork } from "../../lib/defer";
import { errorResponse } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import { fireWebhookEvent } from "../../lib/webhook-payloads";
import { logActivity } from "./log-activity";

export async function assignLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");
  const body = validJson(c, assignLabelSchema);

  // Batch all 4 lookups: task, label, existing assignment, label count
  const [taskResult, labelResult, assignmentResult, [{ value: labelCount }]] = await db.batch([
    db.select({ id: task.id, projectId: task.projectId })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1),
    db.select({ id: label.id, name: label.name, projectId: label.projectId })
      .from(label)
      .where(eq(label.id, body.labelId))
      .limit(1),
    db.select({ id: taskLabel.id })
      .from(taskLabel)
      .where(and(eq(taskLabel.taskId, taskId), eq(taskLabel.labelId, body.labelId)))
      .limit(1),
    db.select({ value: count() })
      .from(taskLabel)
      .where(eq(taskLabel.taskId, taskId)),
  ] as const);

  const foundTask = taskResult[0];
  if (!foundTask) {
    return errorResponse(c, "Task not found", 404);
  }

  const foundLabel = labelResult[0];
  if (!foundLabel) {
    return errorResponse(c, "Label not found", 404);
  }

  if (foundLabel.projectId !== foundTask.projectId) {
    return errorResponse(c, "Label does not belong to the same project as the task", 400);
  }

  // Check if already assigned (idempotent)
  if (assignmentResult[0]) {
    return c.json({ ok: true });
  }

  // Check task label count
  if (labelCount >= MAX_LABELS_PER_TASK) {
    return errorResponse(c, `Maximum of ${MAX_LABELS_PER_TASK} labels per task reached`, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.batch([
    db.insert(taskLabel).values({
      id,
      taskId,
      labelId: body.labelId,
      createdAt: now,
    }),
    db.update(task).set({ updatedAt: now }).where(eq(task.id, taskId)),
  ] as const);

  deferWork(c, () => logActivity(db, {
    taskId,
    actorId: user.id,
    action: "label_added",
    newValue: foundLabel.name,
  }));

  // Non-blocking webhook dispatch for task.label_added
  const assignWorkspaceId = c.get("currentProject")?.workspaceId;
  if (assignWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: assignWorkspaceId, actorId: user.id, projectId: foundTask.projectId }, [
      { event: "task.label_added", data: { task: { id: foundTask.id, projectId: foundTask.projectId }, label: { id: foundLabel.id, name: foundLabel.name } } },
    ]);
  }

  return c.json({ ok: true }, 201);
}

export async function unassignLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { taskId, labelId: labelIdParam } = requireParams(c, "taskId", "labelId");

  // Batch assignment check and label name lookup
  const [assignmentResult, labelResult] = await db.batch([
    db.select({ id: taskLabel.id, labelId: taskLabel.labelId })
      .from(taskLabel)
      .where(and(eq(taskLabel.taskId, taskId), eq(taskLabel.labelId, labelIdParam)))
      .limit(1),
    db.select({ name: label.name })
      .from(label)
      .where(eq(label.id, labelIdParam))
      .limit(1),
  ] as const);

  const assignment = assignmentResult[0];
  if (!assignment) {
    return errorResponse(c, "Label assignment not found", 404);
  }

  const foundLabel = labelResult[0];

  const now = new Date();
  await db.batch([
    db.delete(taskLabel).where(and(eq(taskLabel.taskId, taskId), eq(taskLabel.labelId, labelIdParam))),
    db.update(task).set({ updatedAt: now }).where(eq(task.id, taskId)),
  ] as const);

  deferWork(c, () => logActivity(db, {
    taskId,
    actorId: user.id,
    action: "label_removed",
    newValue: foundLabel?.name ?? "unknown",
  }));

  // Non-blocking webhook dispatch for task.label_removed
  const unassignWorkspaceId = c.get("currentProject")?.workspaceId;
  if (unassignWorkspaceId) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: unassignWorkspaceId, actorId: user.id, projectId: c.get("currentProject")!.id }, [
      { event: "task.label_removed", data: { task: { id: taskId, projectId: c.get("currentProject")!.id }, label: { id: labelIdParam, name: foundLabel?.name ?? "unknown" } } },
    ]);
  }

  return c.json({ ok: true });
}
