import { and, count, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../../db/schema/auth";
import { project } from "../../../../db/schema/project";
import { task, taskGroup } from "../../../../db/schema/task";
import type { AppEnv } from "../../../env";
import { requireParam } from "../../../lib/params";
import { costAggregationColumns, emptyCostAggregation, emptyTaskCounts, taskCountColumns } from "./helpers";

/**
 * GET /projects/:projectId/dashboard
 *
 * Returns a project-level dashboard with task counts by status, task counts
 * by task group, tasks assigned per member, and upcoming tasks (next 30 days).
 */
export async function projectDashboard(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");

  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Batch all 6 independent read queries in a single D1 round-trip
  const [taskCountsRows, tasksByGroup, tasksPerMember, overdue, priorityBreakdown, upcoming] =
    await db.batch([
      // Task counts by completion
      db
        .select(taskCountColumns)
        .from(task)
        .where(eq(task.projectId, projectId)),
      // Task counts by task group
      db
        .select({
          taskGroupId: taskGroup.id,
          taskGroupName: taskGroup.name,
          count: count(),
        })
        .from(task)
        .innerJoin(taskGroup, eq(task.taskGroupId, taskGroup.id))
        .where(eq(task.projectId, projectId))
        .groupBy(taskGroup.id, taskGroup.name),
      // Tasks assigned per member
      db
        .select({
          id: userTable.id,
          name: userTable.name,
          count: count(),
        })
        .from(task)
        .innerJoin(userTable, eq(task.assigneeId, userTable.id))
        .where(eq(task.projectId, projectId))
        .groupBy(userTable.id, userTable.name),
      // Overdue tasks — explicit SQL aliases avoid user.name vs task_group.name collision in batch
      db
        .select({
          id: task.id,
          title: task.title,
          priority: task.priority,
          dueDate: task.dueDate,
          assigneeId: task.assigneeId,
          assigneeName: sql<string | null>`${userTable.name}`.as("assignee_name"),
          assigneeImage: sql<string | null>`${userTable.image}`.as("assignee_image"),
          taskGroupName: sql<string>`${taskGroup.name}`.as("tg_name"),
        })
        .from(task)
        .leftJoin(userTable, eq(task.assigneeId, userTable.id))
        .innerJoin(taskGroup, eq(task.taskGroupId, taskGroup.id))
        .where(
          and(
            eq(task.projectId, projectId),
            isNotNull(task.dueDate),
            lt(task.dueDate, now),
            eq(task.completed, false)
          )
        )
        .orderBy(task.dueDate)
        .limit(20),
      // Priority breakdown — count of active tasks by priority level
      db
        .select({
          priority: task.priority,
          count: count(),
        })
        .from(task)
        .where(and(eq(task.projectId, projectId), eq(task.completed, false)))
        .groupBy(task.priority),
      // Upcoming tasks (next 30 days)
      db
        .select({
          id: task.id,
          title: task.title,
          completed: task.completed,
          priority: task.priority,
          dueDate: task.dueDate,
          assigneeId: task.assigneeId,
          taskGroupId: task.taskGroupId,
          taskGroupName: taskGroup.name,
        })
        .from(task)
        .innerJoin(taskGroup, eq(task.taskGroupId, taskGroup.id))
        .where(
          and(
            eq(task.projectId, projectId),
            isNotNull(task.dueDate),
            gte(task.dueDate, now),
            lte(task.dueDate, thirtyDaysLater),
            eq(task.completed, false)
          )
        )
        .orderBy(task.dueDate),
    ] as const);

  const taskCounts = taskCountsRows[0] ?? emptyTaskCounts;

  // --- Cost aggregation (supplementary — partial data acceptable) ---
  let costAggregation = emptyCostAggregation;
  try {
    const costResult = await db
      .select(costAggregationColumns)
      .from(task)
      .where(eq(task.projectId, projectId));
    costAggregation = costResult[0] ?? emptyCostAggregation;
  } catch (error) {
    console.error("Failed to fetch cost aggregation for project dashboard:", error);
    // Non-fatal: return the rest of the dashboard with zeroed cost data
  }

  // --- Project budget (supplementary — partial data acceptable) ---
  let budget: number | null = null;
  try {
    const [proj] = await db
      .select({ budget: project.budget })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    budget = proj?.budget ?? null;
  } catch (error) {
    console.error("Failed to fetch project budget for project dashboard:", error);
    // Non-fatal: return the rest of the dashboard without budget info
  }

  // --- Cost per member (supplementary — partial data acceptable) ---
  let costPerMember: { id: string; name: string; totalCost: number }[] = [];
  try {
    costPerMember = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        totalCost: sql<number>`COALESCE(SUM(${task.cost}), 0)`,
      })
      .from(task)
      .innerJoin(userTable, eq(task.assigneeId, userTable.id))
      .where(and(eq(task.projectId, projectId), isNotNull(task.cost)))
      .groupBy(userTable.id, userTable.name);
  } catch (error) {
    console.error("Failed to fetch cost per member for project dashboard:", error);
    // Non-fatal: return the rest of the dashboard without per-member cost breakdown
  }

  return c.json({
    taskCounts,
    tasksByGroup,
    tasksPerMember,
    upcomingTasks: upcoming,
    overdueTasks: overdue,
    priorityBreakdown,
    costAggregation,
    budget,
    costPerMember,
  });
}
