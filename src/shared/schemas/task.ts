import { z } from "zod";

import { RECURRENCE_FREQUENCIES } from "../types/recurrence";
import { TASK_PRIORITIES } from "../types/roles";

/**
 * Calendar-validated task date (used for both `startDate` and `dueDate`):
 * a bare `YYYY-MM-DD` day (what the web client's `<input type="date">`
 * sends) or a full ISO 8601 datetime (what the public API docs promise PAT
 * clients).
 *
 * Both branches are calendar-aware, not shape-only regexes. The handlers
 * feed these values straight into `new Date(body.startDate)` /
 * `new Date(body.dueDate)` and insert the result into the corresponding
 * `task` timestamp column, so a shape-only check would let `2030-02-30`
 * silently roll forward to `2030-03-02` (plausible-but-wrong stored data)
 * and `2030-13-45` become `Invalid Date` → `NaN` bound into SQL. Rejecting
 * impossible dates at the boundary keeps the 400 honest and the stored
 * timestamp well-formed.
 *
 * The `field` label is interpolated into the error message so a 400 names
 * the offending field instead of a generic "date".
 */
const taskDateSchema = (field: "Start date" | "Due date") =>
  z.union(
    [z.iso.date(), z.iso.datetime({ offset: true, local: true })],
    `${field} must be a valid calendar date (YYYY-MM-DD) or ISO 8601 datetime`,
  );

/**
 * Canonical 400 message for the start/due ordering invariant. Exported so the
 * updateTask handler's merged-state backstop returns byte-identical text to
 * the schema refinements — the wording has a single source of truth and a
 * tweak in one place can't silently diverge from the other.
 */
export const DATE_RANGE_ERROR = {
  startAfterDue: "Start date must be on or before the due date",
} as const;

/**
 * Pure check for the cross-field ordering invariant. `startDate` and `dueDate`
 * are each INDEPENDENTLY optional — a task may carry a start date alone (work
 * that begins on a day with no hard deadline), a due date alone, both, or
 * neither. The ONLY constraint is ordering: when both are present the start
 * must not fall after the due date. Returns the offending message, or null
 * when the pair is valid (which now includes the start-only case — a startDate
 * no longer requires a dueDate).
 *
 * Comparison is on the `YYYY-MM-DD` prefix — lexicographic order is correct
 * for that fixed-width form, and slicing avoids local-time parsing (an
 * off-by-one hazard for users west of UTC). Shared by the Zod refinements
 * (create + update + import + export) and the updateTask merged-state backstop
 * so the rule lives in exactly one place.
 */
export function dateRangeError(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): string | null {
  if (startDate && dueDate && startDate.slice(0, 10) > dueDate.slice(0, 10)) {
    return DATE_RANGE_ERROR.startAfterDue;
  }
  return null;
}

/**
 * Zod adapter for {@link dateRangeError}: lifts a failing invariant into a
 * refinement issue on the `startDate` path.
 */
function validateDateRange(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
  ctx: z.RefinementCtx,
): void {
  const message = dateRangeError(startDate, dueDate);
  if (message) {
    ctx.addIssue({ code: "custom", path: ["startDate"], message });
  }
}

export const recurrenceRuleSchema = z.object({
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(365),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  nthWeekday: z.object({
    n: z.number().int().min(1).max(5),
    day: z.number().int().min(0).max(6),
  }).optional(),
  /**
   * Strict `YYYY-MM-DD` calendar date (calendar-aware, not a shape regex).
   * `computeNextDueDate` parses this with `Date.UTC(y, m - 1, d)`, which
   * silently rolls impossible dates forward (`2030-02-30` → Mar 2) and turns
   * any non-`YYYY-MM-DD` string (including ISO datetimes) into `NaN` — and a
   * `NaN` end bound makes every `result >= end` comparison false, so the
   * recurrence series would never terminate. Validating here is the only
   * guard on that path.
   */
  endDate: z.iso.date().optional(),
});

export const createTaskSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(5000).optional(),
    taskGroupId: z.uuid(),
    assigneeId: z.string().min(1).optional().nullable(),
    priority: z.enum(TASK_PRIORITIES).optional().default("none"),
    startDate: taskDateSchema("Start date").optional().nullable(),
    dueDate: taskDateSchema("Due date").optional().nullable(),
    cost: z.number().int().min(0).nullable().optional(),
    icon: z.string().max(50).optional().nullable(),
    recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  })
  // On create the full intended state is in the payload, so the range
  // invariant can always be checked here.
  .superRefine((data, ctx) => validateDateRange(data.startDate, data.dueDate, ctx));

/**
 * Fields a client may change through `PATCH /api/tasks/:taskId`.
 *
 * `coverImageKey` and `coverUnsplash` are deliberately ABSENT and must stay
 * absent. `serveUpload` authorizes a `task-cover` download by finding the task
 * whose `cover_image_key` equals the requested key, so a client that could
 * write that column could point its own task at another workspace's R2 object
 * and read it back through its own legitimate access. Nothing outside
 * `api/lib/cover-image.ts` ever writes a non-null `coverImageKey`, and the key
 * it writes is one the server just minted for the caller's own upload — that is
 * what makes the download check an authorization check rather than a lookup.
 *
 * (`coverUnsplash` carries no such authority — it holds absolute Unsplash URLs,
 * not a key into our own storage — so the workspace importer is allowed to
 * restore one from an uploaded export. It nulls `coverImageKey` on the same row,
 * preserving the XOR invariant that `api/lib/cover-image.ts` otherwise owns.)
 *
 * `coverImagePosition` stays: it is a 0–100 framing offset with no
 * authorization meaning and no bearing on the XOR invariant. The web client
 * PATCHes it directly (`use-task-cover.ts`).
 */
export const updateTaskSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200).optional(),
    description: z.string().max(5000).optional().nullable(),
    assigneeId: z.string().min(1).optional().nullable(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    startDate: taskDateSchema("Start date").optional().nullable(),
    dueDate: taskDateSchema("Due date").optional().nullable(),
    cost: z.number().int().min(0).nullable().optional(),
    icon: z.string().max(50).optional().nullable(),
    coverImagePosition: z.number().int().min(0).max(100).optional().nullable(),
    recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  })
  // A partial PATCH can't see stored values, so the schema can only enforce
  // the range invariant when BOTH fields appear in the payload. Patches that
  // touch one field are validated against stored state by the merged-state
  // backstop in the updateTask handler — that backstop is mandatory, not
  // belt-and-braces: without it `PATCH {startDate}` against a stored earlier
  // dueDate would persist an inverted range.
  .superRefine((data, ctx) => {
    if (data.startDate === undefined || data.dueDate === undefined) return;
    validateDateRange(data.startDate, data.dueDate, ctx);
  });

/**
 * One event from a client-parsed .ics file, ready to become a task.
 *
 * Field rules deliberately mirror `createTaskSchema` (title 1–200,
 * description ≤5000, dates via `taskDateSchema`) so an imported task can
 * never carry values a hand-created task couldn't — the import endpoint is
 * not a back door around the task validation contract. The shared
 * `validateDateRange` refinement is reused too, so an imported event can
 * never carry an inverted range (DTSTART after DTEND) — exactly like a create
 * payload. An event with a start but no resolvable end (DTSTART without DTEND)
 * imports as a start-only task, which is now valid (a startDate no longer
 * requires a dueDate).
 *
 * `sourceUid` is the ICS `UID` property and powers re-import dedupe via the
 * partial unique index on (projectId, source_uid). Optional: events without
 * a UID are imported blind and will duplicate on re-import (documented
 * behavior). Capped at 512 chars — RFC 5545 UIDs are unbounded in theory,
 * but anything longer is hostile input, not a calendar.
 */
const importTaskItemSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(5000).optional(),
    startDate: taskDateSchema("Start date").optional().nullable(),
    dueDate: taskDateSchema("Due date").optional().nullable(),
    sourceUid: z.string().min(1).max(512).optional(),
  })
  .superRefine((data, ctx) => validateDateRange(data.startDate, data.dueDate, ctx));

/**
 * Body of `POST /projects/:projectId/tasks/import`.
 *
 * The 500-item ceiling bounds a single request's D1 work (statement count,
 * activity rows, position chain) and matches the documented import limit;
 * larger calendars must be split client-side. The server never sees the raw
 * .ics — parsing happens in the browser and only validated JSON crosses the
 * wire.
 */
export const importTasksSchema = z.object({
  taskGroupId: z.uuid(),
  tasks: z
    .array(importTaskItemSchema)
    .min(1, "At least one task is required")
    .max(500, "Cannot import more than 500 tasks per request"),
});

export const moveTaskSchema = z.object({
  taskGroupId: z.uuid(),
  position: z.string().min(1, "Position is required"),
});

export const listActivityQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 5))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ImportTasksInput = z.infer<typeof importTasksSchema>;
export type ImportTaskItem = z.infer<typeof importTaskItemSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;
