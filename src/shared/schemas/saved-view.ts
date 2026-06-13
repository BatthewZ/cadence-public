import { z } from "zod";

/**
 * Hard cap on saved views per user per project. Saved views are private
 * per-user-per-project bookmarks, so the cap bounds both the list UI and the
 * per-user storage footprint without ever being a realistic workflow limit.
 */
export const MAX_SAVED_VIEWS_PER_PROJECT_USER = 20;
/** Max number of entries allowed in a saved view's `params` record. */
export const SAVED_VIEW_MAX_PARAMS = 16;
/** Max length of a single `params` value (URL param values are short CSVs/dates). */
export const SAVED_VIEW_MAX_PARAM_LENGTH = 500;

/**
 * Canonical URL params owned by the task filter bar.
 *
 * This is THE single source of truth for the filter param names:
 * `use-task-filters` (the web hook that reads/writes these params) imports
 * this constant rather than declaring its own copy, so a new filter dimension
 * cannot be added to the filter bar but silently missed by saved-view
 * snapshots (or vice versa). The hook's own test suite exercises every member
 * through real URL round-trips, which is what keeps this list honest.
 *
 * `noLabel` is deliberately absent: it is a My Tasks (workspace-level) URL
 * param only. Saved views are per-project, and the project board encodes
 * label absence via the `label=none` sentinel inside the `label` param.
 */
export const TASK_FILTER_PARAM_KEYS = [
  "assignee",
  "priority",
  "completed",
  "dueDateFrom",
  "dueDateTo",
  "noDueDate",
  "label",
] as const;

/**
 * Everything a saved view snapshots from the URL: the filter params plus
 * `groupBy` (owned by the timeline view, not the filter bar — see
 * ProjectTimeline's `parseGroupingMode`).
 */
export const TASK_VIEW_PARAM_KEYS = [...TASK_FILTER_PARAM_KEYS, "groupBy"] as const;

/**
 * Comma-list params whose value order is not significant. Dirty-comparison
 * (is the current URL different from the applied saved view?) must compare
 * these as sets, not strings — `assignee=a,b` and `assignee=b,a` are the same
 * filter state.
 */
export const MULTI_VALUE_PARAM_KEYS = ["assignee", "priority", "label"] as const;

/**
 * The snapshot a saved view stores: the active tab plus a bounded
 * string-record of URL params.
 *
 * Why this is a loose record and not a closed shape: unknown param keys are
 * PRESERVED by design. A saved view created by a future client (which may
 * know params this deployment has never heard of) must round-trip through the
 * API verbatim — stripping unknown keys here would silently corrupt those
 * views the moment an older server touched them. The bounds (key length,
 * value length, entry count) are the only contract; key *names* are open.
 *
 * `tab` is a bounded string, NOT an enum, for the same forward-compatibility
 * reason: a future client may save `"calendar"`. The web client falls back to
 * `"board"` for tabs it does not recognize.
 */
export const savedViewStateSchema = z.object({
  tab: z.string().min(1).max(20),
  params: z
    .record(
      z.string().min(1).max(40),
      z.string().max(SAVED_VIEW_MAX_PARAM_LENGTH),
    )
    .refine(
      (p) => Object.keys(p).length <= SAVED_VIEW_MAX_PARAMS,
      "Too many view parameters",
    ),
});

/**
 * Saved-view name validation, shared by create and update so the rules cannot
 * drift between the two endpoints (the same single-source reasoning that lets
 * `state` reuse {@link savedViewStateSchema} via `.optional()`).
 *
 * Uses trim-then-validate (`.trim().min(1).max(50)`): the length bounds apply
 * to the TRIMMED value, so a whitespace-only name is rejected rather than
 * stored as an empty string (which would also collide on the per-user unique
 * name index). This deliberately differs from older schemas that
 * validate-then-trim; see saved-view.test.ts for the pinned semantics.
 */
const savedViewNameSchema = z.string().trim().min(1).max(50);

export const createSavedViewSchema = z.object({
  name: savedViewNameSchema,
  state: savedViewStateSchema,
});

export const updateSavedViewSchema = z.object({
  name: savedViewNameSchema.optional(),
  state: savedViewStateSchema.optional(),
});

export type SavedViewState = z.infer<typeof savedViewStateSchema>;
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;

/** API shape of a saved view (mirrors label.ts's TaskLabelInfo convention). */
export interface SavedView {
  id: string;
  projectId: string;
  creatorId: string;
  name: string;
  state: SavedViewState;
  position: string;
  createdAt: string;
  updatedAt: string;
}
