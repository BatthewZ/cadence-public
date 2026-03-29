import { and, eq, isNotNull } from "drizzle-orm";
import type { Context } from "hono";

import { project, projectMember } from "../../../../db/schema/project";
import { task, taskGroup } from "../../../../db/schema/task";
import type { AppEnv } from "../../../env";
import { compoundCursorCondition, computeCompoundNextCursor, parseCompoundCursor, parseCursorParams } from "../../../lib/pagination";
import { requireParam } from "../../../lib/params";
import { getTimeBucket, isElevatedRole, type TimeBucket } from "./helpers";

/**
 * GET /workspaces/:workspaceId/dashboard/upcoming
 *
 * Returns all upcoming tasks across all projects in the workspace, grouped
 * into time buckets: overdue, today, this_week, next_week, this_month, later.
 */
export async function upcomingTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const isElevated = isElevatedRole(membership.role);

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 50, maxLimit: 200 });

  const baseConditions = [
    eq(project.workspaceId, workspaceId),
    eq(project.status, "active"),
    isNotNull(task.dueDate),
    eq(task.completed, false),
  ];

  const compound = parseCompoundCursor(cursor);
  if (compound) {
    baseConditions.push(compoundCursorCondition(compound, task.dueDate, task.id, "asc"));
  }

  const taskFields = {
    id: task.id,
    title: task.title,
    completed: task.completed,
    priority: task.priority,
    dueDate: task.dueDate,
    assigneeId: task.assigneeId,
    projectId: task.projectId,
    projectName: project.name,
    taskGroupId: task.taskGroupId,
    taskGroupName: taskGroup.name,
  };

  // For non-elevated members, restrict to projects they belong to
  const tasksQuery = isElevated
    ? db
        .select(taskFields)
        .from(task)
        .innerJoin(project, eq(task.projectId, project.id))
        .innerJoin(taskGroup, eq(task.taskGroupId, taskGroup.id))
        .where(and(...baseConditions))
        .orderBy(task.dueDate, task.id)
        .limit(limit)
    : db
        .select(taskFields)
        .from(task)
        .innerJoin(project, eq(task.projectId, project.id))
        .innerJoin(taskGroup, eq(task.taskGroupId, taskGroup.id))
        .innerJoin(
          projectMember,
          and(eq(projectMember.projectId, project.id), eq(projectMember.userId, user.id))
        )
        .where(and(...baseConditions))
        .orderBy(task.dueDate, task.id)
        .limit(limit);

  const tasks = await tasksQuery;

  const nextCursor = computeCompoundNextCursor(
    tasks,
    limit,
    (t) => t.dueDate!,
    (t) => t.id
  );

  const buckets: Record<TimeBucket, typeof tasks> = {
    overdue: [],
    today: [],
    this_week: [],
    next_week: [],
    this_month: [],
    later: [],
  };

  for (const t of tasks) {
    // dueDate is guaranteed non-null by the isNotNull filter
    const bucket = getTimeBucket(t.dueDate!);
    buckets[bucket].push(t);
  }

  return c.json({ buckets, nextCursor });
}
