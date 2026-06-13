import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { TASK_FILTER_PARAM_KEYS } from "@/shared/schemas/saved-view";
import { TASK_PRIORITIES, type TaskPriority } from "@/shared/types/roles";
import type { Task } from "@/web/contexts/ProjectContext";

/**
 * Sentinel value meaning "absence of a value" inside ID-list filter params
 * (`assignee=u1,none`, `label=none`).
 *
 * Why a sentinel is safe here: it is ONLY ever mixed into ID lists whose real
 * members are nanoid-style IDs, so a collision with a genuine ID is
 * practically impossible. It must never be reused for name-based params
 * (e.g. a label *name* could legitimately be "none").
 *
 * Due-date absence cannot be encoded this way because `dueDateFrom`/`dueDateTo`
 * are date strings, not ID lists — that dimension uses the dedicated
 * `noDueDate=true` boolean param instead (see {@link TaskFilters.noDueDate}).
 */
export const FILTER_NONE = "none";

export interface TaskFilters {
  assigneeIds: string[];
  priorities: TaskPriority[];
  completed: boolean | null;
  dueDateFrom: string | null;
  dueDateTo: string | null;
  /**
   * When true, tasks WITHOUT a due date pass the due-date dimension.
   * Composes with `dueDateFrom`/`dueDateTo` as an OR: a task passes the
   * dimension if it is in range OR (`noDueDate` and it has no due date).
   */
  noDueDate: boolean;
  labelIds: string[];
}

/**
 * URL read/write surface of the task filters — everything except the
 * task-list-dependent derivations. See {@link useTaskFilterControls} for why
 * this exists as a separate, lighter hook.
 */
export interface UseTaskFilterControlsReturn {
  filters: TaskFilters;
  setFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
  /**
   * Applies several filter keys in ONE URL update. Necessary because
   * react-router's functional `setSearchParams` updater closes over the
   * render-time params, so two back-to-back single-key `setFilter` calls in
   * the same event handler both start from the *same* stale params and the
   * last one wins (the earlier key is silently lost). The due-date dimension
   * is the only multi-key writer, with three call sites that must all batch
   * here: quick-picks set `from`+`to` together, "Clear dates" resets
   * `from`+`to`+`noDueDate` (both via TaskFilterBar's `handleDueDateChange`),
   * and FilterChips' date-range chip remover clears `from`+`to`.
   */
  setFilters: (patch: Partial<TaskFilters>) => void;
  clearFilter: (key: keyof TaskFilters) => void;
  clearFilters: () => void;
}

export interface UseTaskFiltersReturn extends UseTaskFilterControlsReturn {
  filteredTasks: Task[];
  activeFilterCount: number;
  hasActiveFilters: boolean;
}

type FilterParam = (typeof TASK_FILTER_PARAM_KEYS)[number];

/**
 * Single source of truth mapping `TaskFilters` keys to their URL search
 * params. `setFilter`, `clearFilter`, and `clearFilters` all derive from this
 * (and from the shared `TASK_FILTER_PARAM_KEYS` — also consumed by saved
 * views, so snapshots and the filter bar cannot drift) so a new filter
 * dimension cannot be added to one code path but forgotten in another —
 * exactly the bug class `clearFilters` tests guard against (e.g. `noDueDate`
 * lingering in the URL after "clear all").
 */
const PARAM_BY_KEY: Record<keyof TaskFilters, FilterParam> = {
  assigneeIds: "assignee",
  priorities: "priority",
  completed: "completed",
  dueDateFrom: "dueDateFrom",
  dueDateTo: "dueDateTo",
  noDueDate: "noDueDate",
  labelIds: "label",
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a URL-supplied `YYYY-MM-DD` date param down to a real calendar
 * date. The URL is user-editable (hand-typed, shared, bookmarked), so shape
 * alone is not enough: `applyFilters` compares these values *lexically*
 * against `task.dueDate.slice(0, 10)`, so a date-shaped-but-impossible value
 * (`2030-02-30`) or arbitrary text (`banana`) would silently mis-filter the
 * task list with no error surfaced anywhere. Invalid values degrade to "no
 * date filter" (`null`) rather than throwing — a bad shared link should not
 * break the page. The round-trip through `Date` mirrors the server-side
 * `z.iso.date()` validation on the My Tasks API, keeping one definition of
 * "valid date" across both filter surfaces.
 *
 * Exported so the workspace-level My Tasks page (which owns its own URL
 * params rather than using this hook) validates `dueDateFrom`/`dueDateTo`
 * with the exact same rule — duplicating it would let the two surfaces drift
 * on what counts as a valid date.
 */
export function parseDateParam(raw: string | null): string | null {
  if (!raw || !ISO_DATE_RE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/**
 * Keeps only genuine {@link TaskPriority} values from a URL-supplied CSV.
 * Same trust boundary as {@link parseDateParam}: an unchecked cast would let
 * `priority=banana` into the filter state, where the OR-within-dimension
 * membership check matches no task and silently empties the board.
 *
 * Exported for the same reason as {@link parseDateParam}: the My Tasks page
 * parses the same `priority` URL param outside this hook and must accept
 * exactly the same value set.
 */
export function parsePriorities(raw: string | null): TaskPriority[] {
  if (!raw) return [];
  return raw
    .split(",")
    .filter((value): value is TaskPriority =>
      (TASK_PRIORITIES as readonly string[]).includes(value),
    );
}

function parseFilters(searchParams: URLSearchParams): TaskFilters {
  const assigneeRaw = searchParams.get("assignee");
  const completedRaw = searchParams.get("completed");

  const labelRaw = searchParams.get("label");

  return {
    assigneeIds: assigneeRaw ? assigneeRaw.split(",").filter(Boolean) : [],
    priorities: parsePriorities(searchParams.get("priority")),
    completed:
      completedRaw === "true" ? true : completedRaw === "false" ? false : null,
    dueDateFrom: parseDateParam(searchParams.get("dueDateFrom")),
    dueDateTo: parseDateParam(searchParams.get("dueDateTo")),
    noDueDate: searchParams.get("noDueDate") === "true",
    labelIds: labelRaw ? labelRaw.split(",").filter(Boolean) : [],
  };
}

/**
 * Serializes one filter value to its URL representation, or `null` when the
 * value is "empty" and the param should be removed from the URL. Keeping
 * empty values out of the URL is what makes filter state shareable/bookmarkable
 * without noise, and is what `hasActiveFilters` implicitly relies on.
 */
function serializeFilterValue<K extends keyof TaskFilters>(
  key: K,
  value: TaskFilters[K],
): string | null {
  switch (key) {
    case "assigneeIds":
    case "labelIds": {
      const ids = value as string[];
      return ids.length > 0 ? ids.join(",") : null;
    }
    case "priorities": {
      const priorities = value as TaskPriority[];
      return priorities.length > 0 ? priorities.join(",") : null;
    }
    case "completed": {
      const v = value as boolean | null;
      return v !== null ? String(v) : null;
    }
    case "noDueDate": {
      return (value as boolean) ? "true" : null;
    }
    case "dueDateFrom":
    case "dueDateTo": {
      return (value as string | null) || null;
    }
    default:
      return null;
  }
}

/**
 * Filtering is AND across dimensions, OR within a dimension. The "absence"
 * cases (unassigned / no labels / no due date) compose into their dimension
 * with OR, so e.g. `assignee=u1,none` means "assigned to u1 OR unassigned" —
 * users can see a teammate's work alongside unclaimed work in one view.
 */
function applyFilters(tasks: Task[], filters: TaskFilters): Task[] {
  return tasks.filter((task) => {
    if (filters.assigneeIds.length > 0) {
      const matchesAssignee =
        Boolean(task.assigneeId) &&
        filters.assigneeIds.includes(task.assigneeId as string);
      const matchesUnassigned =
        filters.assigneeIds.includes(FILTER_NONE) && !task.assigneeId;
      if (!matchesAssignee && !matchesUnassigned) return false;
    }

    if (
      filters.priorities.length > 0 &&
      !filters.priorities.includes(task.priority)
    ) {
      return false;
    }

    if (filters.completed !== null && task.completed !== filters.completed) {
      return false;
    }

    // Due-date dimension: range and absence are sub-filters joined with OR.
    // A bare `noDueDate` (no range set) must NOT pass tasks that have a due
    // date, hence `hasRange` gating the in-range check.
    const hasRange = Boolean(filters.dueDateFrom || filters.dueDateTo);
    if (hasRange || filters.noDueDate) {
      const taskDate = task.dueDate ? task.dueDate.slice(0, 10) : null;
      const inRange =
        hasRange &&
        taskDate !== null &&
        (!filters.dueDateFrom || taskDate >= filters.dueDateFrom) &&
        (!filters.dueDateTo || taskDate <= filters.dueDateTo);
      const matchesNoDueDate = filters.noDueDate && !task.dueDate;
      if (!inRange && !matchesNoDueDate) return false;
    }

    if (filters.labelIds.length > 0) {
      const taskLabelIds = (task.labels ?? []).map((l) => l.id);
      // Real label IDs are nanoids, so FILTER_NONE can never appear in
      // taskLabelIds — `some(includes)` cannot false-positive on the sentinel.
      const matchesLabel = filters.labelIds.some((id) =>
        taskLabelIds.includes(id),
      );
      const matchesUnlabeled =
        filters.labelIds.includes(FILTER_NONE) && taskLabelIds.length === 0;
      if (!matchesLabel && !matchesUnlabeled) return false;
    }

    return true;
  });
}

/**
 * Counts active filter *dimensions* (not individual values) for the filter
 * badge. The due-date trio (`dueDateFrom`/`dueDateTo`/`noDueDate`) is one
 * dimension, so range + "no due date" together still count as 1 — otherwise
 * the badge would over-report relative to the single due-date filter control.
 */
function countActiveFilters(filters: TaskFilters): number {
  let count = 0;
  if (filters.assigneeIds.length > 0) count++;
  if (filters.priorities.length > 0) count++;
  if (filters.completed !== null) count++;
  if (filters.dueDateFrom || filters.dueDateTo || filters.noDueDate) count++;
  if (filters.labelIds.length > 0) count++;
  return count;
}

/**
 * Lightweight URL read/write hook for task filter state — `filters` plus the
 * mutators, with NO task-list filtering.
 *
 * Why it exists: per-card UI (e.g. click-an-avatar-to-filter on TaskCard)
 * needs to read/toggle filters, and calling `useTaskFilters(tasks)` there
 * would re-filter the entire task list once per card. This hook is safe to
 * call from many components at once; they all share the URL as the single
 * source of truth. Toggle semantics (XOR a value into an ID array) are the
 * consumer's job — this hook only exposes read/write.
 *
 * `useTaskFilters` composes this hook, so the parse/serialize behavior is
 * defined exactly once.
 */
export function useTaskFilterControls(): UseTaskFilterControlsReturn {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const setFilter = useCallback(
    <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const serialized = serializeFilterValue(key, value);
          if (serialized !== null) next.set(PARAM_BY_KEY[key], serialized);
          else next.delete(PARAM_BY_KEY[key]);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setFilters = useCallback(
    (patch: Partial<TaskFilters>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch) as [
            keyof TaskFilters,
            TaskFilters[keyof TaskFilters],
          ][]) {
            const serialized = serializeFilterValue(key, value);
            if (serialized !== null) next.set(PARAM_BY_KEY[key], serialized);
            else next.delete(PARAM_BY_KEY[key]);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilter = useCallback(
    (key: keyof TaskFilters) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(PARAM_BY_KEY[key]);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const param of TASK_FILTER_PARAM_KEYS) next.delete(param);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return useMemo(
    () => ({ filters, setFilter, setFilters, clearFilter, clearFilters }),
    [filters, setFilter, setFilters, clearFilter, clearFilters],
  );
}

/**
 * Full task-filtering hook: URL-backed filter state plus the filtered task
 * list and active-dimension count. Composes {@link useTaskFilterControls} so
 * there is a single source of truth for parsing/serializing filter params —
 * any component using the lightweight controls hook stays perfectly in sync
 * with views using this one.
 */
export function useTaskFilters(tasks: Task[]): UseTaskFiltersReturn {
  const controls = useTaskFilterControls();
  const { filters } = controls;

  const filteredTasks = useMemo(
    () => applyFilters(tasks, filters),
    [tasks, filters],
  );

  const activeFilterCount = useMemo(
    () => countActiveFilters(filters),
    [filters],
  );

  return {
    ...controls,
    filteredTasks,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
  };
}
