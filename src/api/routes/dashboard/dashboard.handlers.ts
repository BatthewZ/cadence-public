import { and, asc, count, desc, eq, gte, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { project, projectMember } from "../../../db/schema/project";
import { task, taskActivity, taskGroup } from "../../../db/schema/task";
import type { AppEnv } from "../../env";
import {
  compoundCursorCondition,
  computeCompoundNextCursor,
  parseCompoundCursor,
  parseCursorParams,
} from "../../lib/pagination";

/** Sentinel Unix timestamp (seconds) to push tasks without a due date to the end of the list. */
const DUE_DATE_SENTINEL = 253402300799; // 9999-12-31T23:59:59Z

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reusable Drizzle select columns for cost aggregation across tasks. */
const costAggregationColumns = {
  totalCost: sql<number>`COALESCE(SUM(${task.cost}), 0)`,
  completedCost: sql<number>`COALESCE(SUM(CASE WHEN ${task.completed} = 1 THEN ${task.cost} ELSE 0 END), 0)`,
  activeCost: sql<number>`COALESCE(SUM(CASE WHEN ${task.completed} = 0 THEN ${task.cost} ELSE 0 END), 0)`,
  tasksWithCost: sql<number>`COUNT(CASE WHEN ${task.cost} IS NOT NULL THEN 1 END)`,
};

const emptyCostAggregation = { totalCost: 0, completedCost: 0, activeCost: 0, tasksWithCost: 0 };

type TimeBucket = "overdue" | "today" | "this_week" | "next_week" | "this_month" | "later";

function getTimeBucket(dueDate: Date): TimeBucket {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  // Calculate start of the current week (Monday)
  const dayOfWeek = todayStart.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisWeekStart = new Date(todayStart.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
  const thisWeekEnd = new Date(thisWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextWeekEnd = new Date(thisWeekEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

  // End of current month
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  if (dueDate < todayStart) return "overdue";
  if (dueDate < todayEnd) return "today";
  if (dueDate < thisWeekEnd) return "this_week";
  if (dueDate < nextWeekEnd) return "next_week";
  if (dueDate < thisMonthEnd) return "this_month";
  return "later";
}

function getPeriodCutoff(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case "week":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "fortnight":
      return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /workspaces/:workspaceId/dashboard
 *
 * Returns an array of projects in the workspace with task count breakdowns
 * by status and total member count per project.
 */
export async function workspaceDashboard(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId } = c.req.param();
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const isElevated = membership.role === "owner" || membership.role === "admin";

  // Helper: builds the projectMember join condition for non-elevated users
  const memberScope = () =>
    and(eq(projectMember.projectId, project.id), eq(projectMember.userId, user.id));

  // Common filters reused across dashboard queries
  const inWorkspace = eq(project.workspaceId, workspaceId);
  const isActiveProject = eq(project.status, "active");

  const now = new Date();

  // --- Build all independent queries (deferred execution) ---

  // Projects with task counts
  const projectsQuery = isElevated
    ? db
        .select({
          id: project.id,
          name: project.name,
          status: project.status,
          activeCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 0 THEN 1 END)`,
          completedCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 1 THEN 1 END)`,
          totalCount: sql<number>`COUNT(${task.id})`,
        })
        .from(project)
        .leftJoin(task, eq(task.projectId, project.id))
        .where(eq(project.workspaceId, workspaceId))
        .groupBy(project.id, project.name, project.status)
    : db
        .select({
          id: project.id,
          name: project.name,
          status: project.status,
          activeCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 0 THEN 1 END)`,
          completedCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 1 THEN 1 END)`,
          totalCount: sql<number>`COUNT(${task.id})`,
        })
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
    .select({
      activeCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 0 THEN 1 END)`,
      completedCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 1 THEN 1 END)`,
      totalCount: sql<number>`COUNT(${task.id})`,
    })
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

  const taskCounts = taskCountsRows[0] ?? { activeCount: 0, completedCount: 0, totalCount: 0 };

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

/**
 * GET /workspaces/:workspaceId/dashboard/my-tasks
 *
 * Returns tasks assigned to the current user across all projects in the
 * workspace. Supports a `period` query param to filter by due date window.
 */
export async function myTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId } = c.req.param();
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

/**
 * GET /workspaces/:workspaceId/dashboard/upcoming
 *
 * Returns all upcoming tasks across all projects in the workspace, grouped
 * into time buckets: overdue, today, this_week, next_week, this_month, later.
 */
export async function upcomingTasks(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId } = c.req.param();
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const isElevated = membership.role === "owner" || membership.role === "admin";

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

/**
 * GET /projects/:projectId/dashboard
 *
 * Returns a project-level dashboard with task counts by status, task counts
 * by task group, tasks assigned per member, and upcoming tasks (next 30 days).
 */
export async function projectDashboard(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = c.req.param();

  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Batch all 6 independent read queries in a single D1 round-trip
  const [taskCountsRows, tasksByGroup, tasksPerMember, overdue, priorityBreakdown, upcoming] =
    await db.batch([
      // Task counts by completion
      db
        .select({
          activeCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 0 THEN 1 END)`,
          completedCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 1 THEN 1 END)`,
          totalCount: sql<number>`COUNT(${task.id})`,
        })
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

  const taskCounts = taskCountsRows[0] ?? { activeCount: 0, completedCount: 0, totalCount: 0 };

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

/**
 * GET /projects/:projectId/activity
 *
 * Returns a paginated activity feed across all tasks in the project,
 * including the task title for context in each activity item.
 */
export async function projectActivity(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = c.req.param();

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 15, maxLimit: 50 });

  const conditions = [eq(task.projectId, projectId)];

  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(
      compoundCursorCondition(compound, taskActivity.createdAt, taskActivity.id, "desc")
    );
  }

  const activities = await db
    .select({
      id: taskActivity.id,
      taskId: taskActivity.taskId,
      taskTitle: task.title,
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
    .innerJoin(task, eq(taskActivity.taskId, task.id))
    .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
    .where(and(...conditions))
    .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
    .limit(limit);

  const nextCursor = computeCompoundNextCursor(
    activities,
    limit,
    (a) => a.createdAt,
    (a) => a.id
  );

  return c.json({ activities, nextCursor });
}

/**
 * GET /workspaces/:workspaceId/activity
 *
 * Returns a paginated workspace-wide activity feed across all projects
 * the user can access, including project context for each activity item.
 */
export async function workspaceActivity(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId } = c.req.param();
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const isElevated = membership.role === "owner" || membership.role === "admin";

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 15, maxLimit: 50 });

  const conditions = [eq(project.workspaceId, workspaceId)];

  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(
      compoundCursorCondition(compound, taskActivity.createdAt, taskActivity.id, "desc")
    );
  }

  const activityFields = {
    id: taskActivity.id,
    taskId: taskActivity.taskId,
    taskTitle: task.title,
    projectId: project.id,
    projectName: project.name,
    actorId: taskActivity.actorId,
    actorName: userTable.name,
    actorImage: userTable.image,
    action: taskActivity.action,
    field: taskActivity.field,
    oldValue: taskActivity.oldValue,
    newValue: taskActivity.newValue,
    createdAt: taskActivity.createdAt,
  };

  const activitiesQuery = isElevated
    ? db
        .select(activityFields)
        .from(taskActivity)
        .innerJoin(task, eq(taskActivity.taskId, task.id))
        .innerJoin(project, eq(task.projectId, project.id))
        .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
        .where(and(...conditions))
        .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
        .limit(limit)
    : db
        .select(activityFields)
        .from(taskActivity)
        .innerJoin(task, eq(taskActivity.taskId, task.id))
        .innerJoin(project, eq(task.projectId, project.id))
        .innerJoin(
          projectMember,
          and(eq(projectMember.projectId, project.id), eq(projectMember.userId, user.id))
        )
        .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
        .where(and(...conditions))
        .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
        .limit(limit);

  const activities = await activitiesQuery;

  const wsNextCursor = computeCompoundNextCursor(
    activities,
    limit,
    (a) => a.createdAt,
    (a) => a.id
  );

  return c.json({ activities, nextCursor: wsNextCursor });
}
