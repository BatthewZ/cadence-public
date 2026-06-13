import { z } from "zod";

import { TASK_PRIORITIES } from "../types/roles";

/**
 * Splits a CSV query param into trimmed, non-empty segments, or `[]` when the
 * param is absent. Element-level validation (id vs enum vs length-bounded
 * name) is layered on per use via `.pipe(...)`, so this base owns the parsing
 * rule in exactly one place — every CSV list param trims and drops empties
 * identically.
 */
const csvSegments = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []));

const csvIdList = csvSegments.pipe(z.array(z.string().min(1)).max(100));

/**
 * CSV of task priorities, e.g. `priority=urgent,high`. Each entry must be a
 * valid TaskPriority — the enum pipe rejects typos at the boundary so the
 * handler never builds an `IN (...)` clause from unvalidated input.
 */
const csvPriorityList = csvSegments.pipe(z.array(z.enum(TASK_PRIORITIES)));

/**
 * CSV of label *names* (not ids), e.g. `labelNames=Bug,Frontend`. Labels are
 * per-project rows, so the cross-project identity for workspace-level
 * filtering is the case-insensitively-unique name. Per-name length is capped
 * at 30 (matching label creation rules) and the list at 50 entries to bound
 * the SQL `IN (...)` clause the handler builds from this input.
 */
const csvLabelNameList = csvSegments.pipe(z.array(z.string().min(1).max(30)).max(50));

/**
 * Strict `YYYY-MM-DD` calendar date. The handler converts these to UTC day
 * boundaries (`T00:00:00.000Z` / `T23:59:59.999Z`), matching how task
 * creation stores due dates (`new Date("YYYY-MM-DD")` === UTC midnight), so
 * server-side filtering agrees with the client's `toISOString().slice(0, 10)`
 * day comparison.
 *
 * Uses `.date()` (calendar-aware), not a bare `\d{4}-\d{2}-\d{2}` regex: a
 * regex would accept impossible dates that `new Date()` then either silently
 * rolls forward (`2030-02-30` → `2030-03-02`, returning wrong rows) or turns
 * into `Invalid Date` → `NaN` when bound to the timestamp column. Rejecting
 * them at the boundary keeps the 400 honest and the SQL well-formed.
 */
const isoDate = z.iso.date().optional();

/**
 * Presence-only boolean flag: only the literal string "true" is accepted.
 * Absence means false. Note: absence-of-label is intentionally a dedicated
 * flag (`noLabel`) rather than a `"none"` sentinel inside `labelNames`,
 * because label names are user-entered and "none" is a legal label name.
 */
const trueFlag = z
  .enum(["true"])
  .optional()
  .transform((v) => v === "true");

/**
 * Query params for GET /workspaces/:workspaceId/dashboard/my-tasks.
 *
 * All filter params are applied server-side because the endpoint is
 * cursor-paginated: filtering client-side over one page would show 0 results
 * for narrow filters until repeated "Load more" and would make counts lie.
 */
export const myTasksQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(200)),
  cursor: z.string().optional(),
  period: z.enum(["week", "fortnight", "month"]).optional(),
  projectIds: csvIdList,
  taskGroupIds: csvIdList,
  priority: csvPriorityList,
  dueDateFrom: isoDate,
  dueDateTo: isoDate,
  noDueDate: trueFlag,
  labelNames: csvLabelNameList,
  noLabel: trueFlag,
});

export const upcomingTasksQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(200)),
  cursor: z.string().optional(),
});

export const workspaceActivityQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 15))
    .pipe(z.number().int().min(1).max(50)),
  cursor: z.string().optional(),
});

export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>;
export type UpcomingTasksQuery = z.infer<typeof upcomingTasksQuerySchema>;
export type WorkspaceActivityQuery = z.infer<typeof workspaceActivityQuerySchema>;
