import { and, count, eq, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../../db/schema/auth";
import { project, projectMember } from "../../../../db/schema/project";
import { task } from "../../../../db/schema/task";
import type { AppEnv } from "../../../env";
import { requireParam } from "../../../lib/params";
import { costAggregationColumns, emptyCostAggregation, emptyTaskCounts, isElevatedRole, taskCountColumns } from "./helpers";

/**
 * GET /workspaces/:workspaceId/dashboard
 *
 * Returns an array of projects in the workspace with task count breakdowns
 * by status and total member count per project.
 */
export async function workspaceDashboard(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const isElevated = isElevatedRole(membership.role);

  // Helper: builds the projectMember join condition for non-elevated users
  const memberScope = () =>
    and(eq(projectMember.projectId, project.id), eq(projectMember.userId, user.id));

  // Common filters reused across dashboard queries
  const inWorkspace = eq(project.workspaceId, workspaceId);
  const isActiveProject = eq(project.status, "active");

  const now = new Date();

  // --- Build all independent queries (deferred execution) ---

  // Projects with task counts
  const projectColumns = {
    id: project.id,
    name: project.name,
    status: project.status,
    ...taskCountColumns,
  };

  const projectsQuery = isElevated
    ? db
        .select(projectColumns)
        .from(project)
        .leftJoin(task, eq(task.projectId, project.id))
        .where(eq(project.workspaceId, workspaceId))
        .groupBy(project.id, project.name, project.status)
    : db
        .select(projectColumns)
        .from(project)
        .innerJoin(projectMember, memberScope())
        .leftJoin(task, eq(task.projectId, project.id))
        .where(eq(project.workspaceId, workspaceId))
        .groupBy(project.id, project.name, project.status);

  // Member counts per project
  const memberCountsQuery = db
    .select({
      projectId: projectMember.projectId,
      memberCount: count(),
    })
    .from(projectMember)
    .innerJoin(project, eq(projectMember.projectId, project.id))
    .where(eq(project.workspaceId, workspaceId))
    .groupBy(projectMember.projectId);

  // Workspace-wide task counts
  const taskCountsBase = db
    .select(taskCountColumns)
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id));

  const taskCountsQuery = isElevated
    ? taskCountsBase.where(and(inWorkspace, isActiveProject))
    : taskCountsBase
        .innerJoin(projectMember, memberScope())
        .where(and(inWorkspace, isActiveProject));

  // Priority breakdown (active tasks only)
  const priorityBase = db
    .select({
      priority: task.priority,
      count: count(),
    })
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id));

  const priorityQuery = isElevated
    ? priorityBase
        .where(and(inWorkspace, isActiveProject, eq(task.completed, false)))
        .groupBy(task.priority)
    : priorityBase
        .innerJoin(projectMember, memberScope())
        .where(and(inWorkspace, isActiveProject, eq(task.completed, false)))
        .groupBy(task.priority);

  // Tasks per member (active tasks only)
  const workloadBase = db
    .select({
      id: userTable.id,
      name: userTable.name,
      image: userTable.image,
      count: count(),
    })
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id))
    .innerJoin(userTable, eq(task.assigneeId, userTable.id));

  const workloadQuery = isElevated
    ? workloadBase
        .where(and(inWorkspace, isActiveProject, eq(task.completed, false)))
        .groupBy(userTable.id, userTable.name, userTable.image)
    : workloadBase
        .innerJoin(projectMember, memberScope())
        .where(and(inWorkspace, isActiveProject, eq(task.completed, false)))
        .groupBy(userTable.id, userTable.name, userTable.image);

  // Overdue tasks (past due, incomplete, max 20)
  // Explicit SQL aliases avoid column-name collisions (task.id vs project.id,
  // project.name vs user.name) that break Drizzle's D1 batch result mapping.
  const overdueBase = db
    .select({
      id: sql<string>`${task.id}`.as("task_id"),
      title: task.title,
      priority: task.priority,
      dueDate: task.dueDate,
      projectId: sql<string>`${project.id}`.as("project_id"),
      projectName: sql<string>`${project.name}`.as("project_name"),
      assigneeName: sql<string | null>`${userTable.name}`.as("assignee_name"),
      assigneeImage: sql<string | null>`${userTable.image}`.as("assignee_image"),
    })
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id))
    .leftJoin(userTable, eq(task.assigneeId, userTable.id));

  const overdueConditions = and(
    inWorkspace,
    isActiveProject,
    isNotNull(task.dueDate),
    lt(task.dueDate, now),
    eq(task.completed, false)
  );

  const overdueQuery = isElevated
    ? overdueBase.where(overdueConditions).orderBy(task.dueDate).limit(20)
    : overdueBase
        .innerJoin(projectMember, memberScope())
        .where(overdueConditions)
        .orderBy(task.dueDate)
        .limit(20);

  // Archived / completed project summary
  const archivedSummaryBase = db
    .select({
      status: project.status,
      projectCount: sql<number>`COUNT(DISTINCT ${project.id})`,
      totalTasks: sql<number>`COUNT(${task.id})`,
      completedTasks: sql<number>`COUNT(CASE WHEN ${task.completed} = 1 THEN 1 END)`,
    })
    .from(project)
    .leftJoin(task, eq(task.projectId, project.id));

  const archivedSummaryQuery = isElevated
    ? archivedSummaryBase
        .where(and(inWorkspace, ne(project.status, "active")))
        .groupBy(project.status)
    : archivedSummaryBase
        .innerJoin(projectMember, memberScope())
        .where(and(inWorkspace, ne(project.status, "active")))
        .groupBy(project.status);

  // --- Execute all 7 independent queries in a single D1 round-trip ---
  const [
    projects,
    memberCounts,
    taskCountsRows,
    priorityBreakdown,
    tasksPerMember,
    overdueTasks,
    archivedSummary,
  ] = await db.batch([
    projectsQuery,
    memberCountsQuery,
    taskCountsQuery,
    priorityQuery,
    workloadQuery,
    overdueQuery,
    archivedSummaryQuery,
  ] as const);

  const taskCounts = taskCountsRows[0] ?? emptyTaskCounts;

  const memberCountMap = new Map(memberCounts.map((m) => [m.projectId, m.memberCount]));

  const projectsResult = projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    taskCounts: {
      active: p.activeCount,
      completed: p.completedCount,
      total: p.totalCount,
    },
    memberCount: memberCountMap.get(p.id) ?? 0,
  }));

  // --- Workspace-wide cost aggregation (supplementary — partial data acceptable) ---
  const costBase = db
    .select(costAggregationColumns)
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id));

  const costQuery = isElevated
    ? costBase.where(and(inWorkspace, isActiveProject))
    : costBase.innerJoin(projectMember, memberScope()).where(and(inWorkspace, isActiveProject));

  let costAggregation = emptyCostAggregation;
  try {
    const costRows = await costQuery;
    costAggregation = costRows[0] ?? emptyCostAggregation;
  } catch (error) {
    console.error("Failed to fetch cost aggregation for workspace dashboard:", error);
    // Non-fatal: return the rest of the dashboard with zeroed cost data
  }

  return c.json({
    projects: projectsResult,
    taskCounts,
    priorityBreakdown,
    tasksPerMember,
    overdueTasks,
    costAggregation,
    archivedSummary,
  });
}
