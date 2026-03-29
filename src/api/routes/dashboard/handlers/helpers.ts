import { sql } from "drizzle-orm";

import { task } from "../../../../db/schema/task";

/** Sentinel Unix timestamp (seconds) to push tasks without a due date to the end of the list. */
export const DUE_DATE_SENTINEL = 253402300799; // 9999-12-31T23:59:59Z

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reusable Drizzle select columns for cost aggregation across tasks. */
export const costAggregationColumns = {
  totalCost: sql<number>`COALESCE(SUM(${task.cost}), 0)`,
  completedCost: sql<number>`COALESCE(SUM(CASE WHEN ${task.completed} = 1 THEN ${task.cost} ELSE 0 END), 0)`,
  activeCost: sql<number>`COALESCE(SUM(CASE WHEN ${task.completed} = 0 THEN ${task.cost} ELSE 0 END), 0)`,
  tasksWithCost: sql<number>`COUNT(CASE WHEN ${task.cost} IS NOT NULL THEN 1 END)`,
};

export const emptyCostAggregation = { totalCost: 0, completedCost: 0, activeCost: 0, tasksWithCost: 0 };

/** Reusable Drizzle select columns for task count aggregation by completion status. */
export const taskCountColumns = {
  activeCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 0 THEN 1 END)`,
  completedCount: sql<number>`COUNT(CASE WHEN ${task.completed} = 1 THEN 1 END)`,
  totalCount: sql<number>`COUNT(${task.id})`,
};

export const emptyTaskCounts = { activeCount: 0, completedCount: 0, totalCount: 0 };

/** Whether a workspace membership role grants elevated (owner/admin) access. */
export function isElevatedRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

export type TimeBucket = "overdue" | "today" | "this_week" | "next_week" | "this_month" | "later";

export function getTimeBucket(dueDate: Date): TimeBucket {
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

export type DashboardPeriod = "week" | "fortnight" | "month";

export function getPeriodCutoff(period: string): Date | null {
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
