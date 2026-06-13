import type { SQL } from "drizzle-orm";
import { and, asc, eq, exists, gte, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import type { Context } from "hono";

import { label, taskLabel } from "../../../../db/schema/label";
import { project } from "../../../../db/schema/project";
import { task, taskGroup } from "../../../../db/schema/task";
import { myTasksQuerySchema } from "../../../../shared/schemas/dashboard";
import type { AppEnv } from "../../../env";
import { parseCursorParams } from "../../../lib/pagination";
import { requireParam } from "../../../lib/params";
import { validQuery } from "../../../lib/validated";
import { DUE_DATE_SENTINEL, getPeriodCutoff } from "./helpers";

/**
 * Builds the due-date filter dimension for My Tasks.
 *
 * The dimension composes with OR semantics over absence: a task passes when
 * it is (within the requested range) OR (`noDueDate` is set AND it has no due
 * date). The no-date branch only exists when `noDueDate` is set — a range
 * alone never matches NULL due dates, and `noDueDate` alone is `IS NULL`.
 *
 * Boundaries are UTC days: task creation stores `new Date("YYYY-MM-DD")`
 * (UTC midnight), so `from` maps to `T00:00:00.000Z` and `to` to
 * `T23:59:59.999Z`. This keeps the server's comparison in agreement with the
 * client's `toISOString().slice(0, 10)` day semantics regardless of the
 * viewer's local timezone.
 */
function buildDueDateCondition(
  dueDateFrom: string | undefined,
  dueDateTo: string | undefined,
  noDueDate: boolean,
): SQL | undefined {
  const range = and(
    dueDateFrom ? gte(task.dueDate, new Date(`${dueDateFrom}T00:00:00.000Z`)) : undefined,
    dueDateTo ? lte(task.dueDate, new Date(`${dueDateTo}T23:59:59.999Z`)) : undefined,
  );
  if (noDueDate) {
    return range ? or(isNull(task.dueDate), range) : isNull(task.dueDate);
  }
  return range;
}

/**
 * GET /workspaces/:workspaceId/dashboard/my-tasks
 *
 * Returns tasks assigned to the current user across all projects in the
 * workspace.
 *
 * All filters (`period`, `projectIds`, `taskGroupIds`, `priority`,
 * `dueDateFrom`/`dueDateTo`/`noDueDate`, `labelNames`/`noLabel`) are applied
 * server-side because the endpoint is cursor-paginated — filtering the
 * current page client-side would show 0 results for narrow filters until
 * repeated "Load more" and would make counts lie.
 *
 * Label filtering matches by case-insensitive *name* (labels are per-project
 * rows; the name is the cross-project identity, already unique
 * case-insensitively within a project) via `EXISTS` on task_label ⋈ label.
 * `noLabel` is `NOT EXISTS(task_label)`; when both are present they combine
 * with OR. The response shape is unchanged — no labels column is returned.
 *
 * Note: `period` uses `lte(dueDate, cutoff)`, which excludes NULL due dates,
 * so combining `period` with `noDueDate` intentionally yields no rows.
 */
export async function myTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const {
    period,
    projectIds,
    taskGroupIds,
    priority,
    dueDateFrom,
    dueDateTo,
    noDueDate,
    labelNames,
    noLabel,
  } = validQuery(c, myTasksQuerySchema);

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

  if (projectIds.length > 0) {
    conditions.push(inArray(task.projectId, projectIds));
  }

  if (taskGroupIds.length > 0) {
    conditions.push(inArray(task.taskGroupId, taskGroupIds));
  }

  if (priority.length > 0) {
    conditions.push(inArray(task.priority, priority));
  }

  const dueDateCondition = buildDueDateCondition(dueDateFrom, dueDateTo, noDueDate);
  if (dueDateCondition) {
    conditions.push(dueDateCondition);
  }

  // Label dimension. EXISTS (rather than a JOIN) guarantees a task with
  // several matching labels is returned exactly once and keeps the cursor
  // pagination math intact. The correlated subqueries are covered by the
  // task_label_task_label_idx / task_label_label_idx indexes.
  const labelConditions: SQL[] = [];
  if (labelNames.length > 0) {
    const lowered = labelNames.map((n) => n.toLowerCase());
    labelConditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(taskLabel)
          .innerJoin(label, eq(taskLabel.labelId, label.id))
          .where(
            and(
              eq(taskLabel.taskId, task.id),
              inArray(sql`lower(${label.name})`, lowered),
            ),
          ),
      ),
    );
  }
  if (noLabel) {
    labelConditions.push(
      notExists(
        db.select({ one: sql`1` }).from(taskLabel).where(eq(taskLabel.taskId, task.id)),
      ),
    );
  }
  if (labelConditions.length > 0) {
    const combined =
      labelConditions.length === 1 ? labelConditions[0] : or(...labelConditions);
    if (combined) {
      conditions.push(combined);
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
