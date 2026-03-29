import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Context } from "hono";

import { project } from "../../../../db/schema/project";
import { task, taskGroup } from "../../../../db/schema/task";
import type { AppEnv } from "../../../env";
import { parseCursorParams } from "../../../lib/pagination";
import { requireParam } from "../../../lib/params";
import { DUE_DATE_SENTINEL, getPeriodCutoff } from "./helpers";

/**
 * GET /workspaces/:workspaceId/dashboard/my-tasks
 *
 * Returns tasks assigned to the current user across all projects in the
 * workspace. Supports a `period` query param to filter by due date window.
 */
export async function myTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const period = c.req.query("period");

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 50, maxLimit: 200 });

  const conditions = [
    eq(project.workspaceId, workspaceId),
    eq(project.status, "active"),
    eq(task.assigneeId, user.id),
    eq(task.completed, false),
  ];

  if (period) {
    const cutoff = getPeriodCutoff(period);
    if (cutoff) {
      conditions.push(lte(task.dueDate, cutoff));
    }
  }

  if (cursor) {
    const sep = cursor.indexOf("|");
    if (sep !== -1) {
      const ts = parseInt(cursor.slice(0, sep), 10);
      const id = cursor.slice(sep + 1);
      if (!isNaN(ts) && id) {
        conditions.push(
          sql`(COALESCE(${task.dueDate}, ${DUE_DATE_SENTINEL}) > ${ts} OR (COALESCE(${task.dueDate}, ${DUE_DATE_SENTINEL}) = ${ts} AND ${task.id} > ${id}))`
        );
      }
    }
  }

  const tasks = await db
    .select({
      id: task.id,
      title: task.title,
      completed: task.completed,
      priority: task.priority,
      dueDate: task.dueDate,
      projectId: task.projectId,
      projectName: project.name,
      taskGroupId: task.taskGroupId,
      taskGroupName: taskGroup.name,
      createdAt: task.createdAt,
    })
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id))
    .innerJoin(taskGroup, eq(task.taskGroupId, taskGroup.id))
    .where(and(...conditions))
    .orderBy(asc(sql`COALESCE(${task.dueDate}, ${DUE_DATE_SENTINEL})`), asc(task.id))
    .limit(limit);

  let nextCursor: string | null = null;
  if (tasks.length >= limit) {
    const last = tasks[tasks.length - 1];
    const effectiveTs = last.dueDate
      ? Math.floor(last.dueDate.getTime() / 1000)
      : DUE_DATE_SENTINEL;
    nextCursor = `${effectiveTs}|${last.id}`;
  }

  return c.json({ tasks, nextCursor });
}
