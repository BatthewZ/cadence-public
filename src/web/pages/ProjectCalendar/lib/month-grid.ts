import type { TaskPriority } from "@/shared/types/roles";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Minimal task shape the calendar placement engine needs. The page adapts
 * its richer `Task` to this (structural typing means extra fields simply
 * pass through by reference — segments/chips return the same object the
 * caller passed in, so the page can recover its full task via the `id`).
 *
 * Date strings are date-only `YYYY-MM-DD`, or full ISO timestamps which
 * are normalized with `.slice(0, 10)` — never parsed with `new Date(str)`
 * (UTC-parse pitfall, the repo's top date-bug class).
 */
export interface CalendarTask {
  id: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  /** Date-only `YYYY-MM-DD` or ISO timestamp; only the first 10 chars are used. */
  startDate?: string | null;
  /** Date-only `YYYY-MM-DD` or ISO timestamp; only the first 10 chars are used. */
  dueDate?: string | null;
}

/** One cell of the month grid. */
export interface GridDay {
  /**
   * Local-calendar date as `YYYY-MM-DD`, built from local y/m/d parts with
   * zero-padding — never via `toISOString()`, which renders the UTC date and
   * is off by one day for users east of UTC (and flags the wrong "today"
   * west of UTC).
   */
  iso: string;
  /** False for the leading/trailing days that pad the grid to full weeks. */
  inMonth: boolean;
  /** True when this cell is the user's local calendar date right now. */
  isToday: boolean;
}

/**
 * A Monday → Sunday row of seven days. Monday-start matches the rest of the
 * app's week math (`endOfWeek` in `src/web/util/date.ts` treats Sunday as
 * the week END), so the calendar's rows agree with the timeline's
 * "This Week" bucketing.
 */
export type Week = GridDay[];

/**
 * Maximum number of horizontal span lanes rendered per week row. Spans that
 * cannot fit demote to per-day chips (see `placeTasks`) so a busy week
 * degrades gracefully instead of growing unbounded row heights.
 */
export const MAX_LANES = 3;

/**
 * A multi-day task bar clipped to a single week row.
 *
 * `colStart`/`colEnd` are inclusive 1-based grid columns (1 = Monday,
 * 7 = Sunday) so the page can map them straight onto CSS
 * `grid-column: colStart / colEnd + 1`.
 *
 * `clippedLeft`/`clippedRight` are true when the task's real range continues
 * before/after this week row — the page uses them to square off the bar's
 * edge (continuation affordance) instead of rounding it.
 */
export interface SpanSegment {
  task: CalendarTask;
  colStart: number;
  colEnd: number;
  /** 0-based lane within the week row, always `< MAX_LANES`. */
  lane: number;
  clippedLeft: boolean;
  clippedRight: boolean;
}

/**
 * Layout for one week row, parallel to the `Week[]` passed to `placeTasks`.
 *
 * - `segments` — lane-assigned multi-day bars for this week, ready to render.
 * - `chipsByIso` — per-day chip lists keyed by the cell's `iso`. Contains
 *   due-only (and start-only) tasks plus any spans demoted for lack of a
 *   lane. Each list is sorted by priority (urgent first), then title, then
 *   id, so the page can truncate to its per-cell chip budget and show
 *   "+N more" from `chipsByIso[iso].length` knowing the most important
 *   chips survive the cut. Days without chips have no key.
 */
export interface WeekLayout {
  segments: SpanSegment[];
  chipsByIso: Record<string, CalendarTask[]>;
}

/* ------------------------------------------------------------------ */
/*  Grid construction                                                  */
/* ------------------------------------------------------------------ */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format a Date as a local-calendar `YYYY-MM-DD` string.
 *
 * Deliberately built from local getters rather than
 * `toISOString().slice(0, 10)`: toISOString renders the UTC date, which is
 * the previous/next calendar day for users away from UTC near midnight —
 * the exact bug class the repo's date policy exists to prevent.
 */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Build a Monday-start month grid for `monthIndex` (0-based, January = 0)
 * of `year`: 4–6 rows of seven `GridDay`s covering every day of the month
 * plus the leading/trailing out-of-month days needed to fill complete weeks.
 *
 * Monday-start is load-bearing: `endOfWeek` in `src/web/util/date.ts`
 * defines Sunday as the week END, and the grid must agree with that
 * convention or "this week" highlights and span clipping would disagree
 * with the rest of the app.
 *
 * All cells are constructed with the local `new Date(y, m, d)` constructor
 * (day numbers may be ≤ 0 or > month length; the constructor rolls them
 * over correctly), so `iso` and `isToday` always reflect the user's local
 * calendar regardless of UTC offset.
 */
export function buildMonthGrid(year: number, monthIndex: number): Week[] {
  const firstOfMonth = new Date(year, monthIndex, 1);
  // getDay(): Sunday = 0 … Saturday = 6. Rotate so Monday = 0 … Sunday = 6,
  // giving the number of out-of-month cells before the 1st.
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weekCount = Math.ceil((mondayOffset + daysInMonth) / 7);

  const todayIso = toIsoDate(new Date());

  const weeks: Week[] = [];
  for (let w = 0; w < weekCount; w++) {
    const week: GridDay[] = [];
    for (let col = 0; col < 7; col++) {
      // 1-based day-of-month; ≤ 0 and > daysInMonth roll into the
      // neighboring months via the local Date constructor.
      const dayNum = w * 7 + col - mondayOffset + 1;
      const date = new Date(year, monthIndex, dayNum);
      const iso = toIsoDate(date);
      week.push({
        iso,
        inMonth: dayNum >= 1 && dayNum <= daysInMonth,
        isToday: iso === todayIso,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

/* ------------------------------------------------------------------ */
/*  Task placement                                                     */
/* ------------------------------------------------------------------ */

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/**
 * Chip ordering: priority first so per-cell truncation keeps the most
 * important work visible, then title/id for a stable, deterministic order
 * (placement runs on every render — unstable order would make chips jump).
 */
function compareChips(a: CalendarTask, b: CalendarTask): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

interface SpanInput {
  task: CalendarTask;
  startIso: string;
  endIso: string;
}

interface ChipInput {
  task: CalendarTask;
  iso: string;
}

/**
 * Place tasks onto a month grid produced by `buildMonthGrid`, returning one
 * `WeekLayout` per week (parallel array).
 *
 * Placement rules:
 * - Tasks with BOTH `startDate` and `dueDate` become span bars. The
 *   inclusive range `[startDate.slice(0,10), dueDate.slice(0,10)]` is
 *   clipped to each week row it intersects, producing a `SpanSegment` with
 *   `clippedLeft`/`clippedRight` marking continuation beyond the row.
 * - Lanes are assigned greedily per week: segments sorted by `colStart`
 *   (longer first on ties, then id for determinism) take the lowest free
 *   lane. At most `MAX_LANES` (3) lanes exist; a segment that can't get a
 *   lane DEMOTES to per-day chips on every day it covers in that week, so
 *   no task silently disappears — busy weeks trade bars for chips rather
 *   than clipping content. Demotion is per-week: the same task can be a bar
 *   in a quiet week and chips in a crowded one.
 * - Due-only tasks become a chip on the due day; start-only tasks become a
 *   chip on the start day (the calendar shows all dated work).
 * - An inverted range (start after due — defensive, shouldn't persist past
 *   validation) falls back to a chip on the due day rather than rendering
 *   a nonsensical bar.
 * - Tasks with neither date are ignored: the calendar shows dated work only.
 *
 * Date comparisons and clipping are pure `YYYY-MM-DD` string comparisons —
 * lexicographic order equals chronological order for this format, so no
 * Date parsing (and no UTC-parse risk) is involved.
 */
export function placeTasks(
  weeks: Week[],
  tasks: CalendarTask[],
): WeekLayout[] {
  const spans: SpanInput[] = [];
  const chips: ChipInput[] = [];

  for (const task of tasks) {
    const start = task.startDate ? task.startDate.slice(0, 10) : null;
    const due = task.dueDate ? task.dueDate.slice(0, 10) : null;

    if (start && due) {
      if (start > due) {
        // Inverted range: degrade to a due-day chip instead of an empty bar.
        chips.push({ task, iso: due });
      } else {
        spans.push({ task, startIso: start, endIso: due });
      }
    } else if (due) {
      chips.push({ task, iso: due });
    } else if (start) {
      chips.push({ task, iso: start });
    }
    // Neither date: ignored — the calendar shows dated work only.
  }

  return weeks.map((week) => {
    const weekStartIso = week[0].iso;
    const weekEndIso = week[6].iso;
    const colByIso = new Map<string, number>(
      week.map((day, i) => [day.iso, i + 1]),
    );

    const chipsByIso: Record<string, CalendarTask[]> = {};
    const addChip = (iso: string, task: CalendarTask): void => {
      (chipsByIso[iso] ??= []).push(task);
    };

    // Clip spans to this week. YYYY-MM-DD compares lexicographically ===
    // chronologically, so clipping is pure string max/min.
    const candidates = spans
      .filter((s) => s.startIso <= weekEndIso && s.endIso >= weekStartIso)
      .map((s) => {
        const segStart = s.startIso > weekStartIso ? s.startIso : weekStartIso;
        const segEnd = s.endIso < weekEndIso ? s.endIso : weekEndIso;
        return {
          task: s.task,
          colStart: colByIso.get(segStart) as number,
          colEnd: colByIso.get(segEnd) as number,
          clippedLeft: s.startIso < weekStartIso,
          clippedRight: s.endIso > weekEndIso,
        };
      })
      .sort(
        (a, b) =>
          a.colStart - b.colStart ||
          b.colEnd - a.colEnd ||
          a.task.id.localeCompare(b.task.id),
      );

    // Greedy lane assignment: lowest free lane wins; laneEnds[i] holds the
    // last occupied column of lane i.
    const laneEnds: number[] = [];
    const segments: SpanSegment[] = [];
    for (const candidate of candidates) {
      let lane = -1;
      for (let i = 0; i < MAX_LANES; i++) {
        if ((laneEnds[i] ?? 0) < candidate.colStart) {
          lane = i;
          break;
        }
      }
      if (lane === -1) {
        // No lane free: demote to chips on every covered day of this week.
        for (let col = candidate.colStart; col <= candidate.colEnd; col++) {
          addChip(week[col - 1].iso, candidate.task);
        }
      } else {
        laneEnds[lane] = candidate.colEnd;
        segments.push({ ...candidate, lane });
      }
    }

    for (const chip of chips) {
      if (colByIso.has(chip.iso)) addChip(chip.iso, chip.task);
    }

    for (const iso of Object.keys(chipsByIso)) {
      chipsByIso[iso].sort(compareChips);
    }

    return { segments, chipsByIso };
  });
}
