import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskPriority } from "@/shared/types/roles";
import { addMonths, startOfMonth } from "@/web/util/date";

import type { CalendarTask, Week } from "./month-grid";
import { buildMonthGrid, MAX_LANES, placeTasks, toIsoDate } from "./month-grid";

/**
 * These tests pin the calendar's two load-bearing invariants:
 *
 * 1. Monday-start weeks — `endOfWeek` in `src/web/util/date.ts` treats
 *    Sunday as the week END, so the grid must start rows on Monday or the
 *    calendar would disagree with the timeline's week bucketing.
 * 2. Local-time date math — every `iso` and the `isToday` flag must reflect
 *    the user's LOCAL calendar. The repo's top date-bug class is UTC drift
 *    from `new Date("YYYY-MM-DD")` parsing or `toISOString()` formatting;
 *    the timezone suites below run the same scenarios under TZs east and
 *    west of UTC to catch either direction of that bug.
 *
 * The placement tests pin the layout contract the page component (next
 * wave) builds on: 1-based Mon–Sun columns, clip flags at week edges,
 * greedy ≤3-lane packing with per-week chip demotion, and per-day chip
 * lists pre-sorted for truncation.
 */

/** Parse a YYYY-MM-DD iso as a LOCAL date (split-construct, never new Date(str)). */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weekdayOf(iso: string): number {
  return localDate(iso).getDay();
}

function makeTask(overrides: Partial<CalendarTask> & { id: string }): CalendarTask {
  return {
    title: `Task ${overrides.id}`,
    completed: false,
    priority: "none",
    ...overrides,
  };
}

/** Collect every iso a task appears on as a chip, across all week layouts. */
function chipIsosFor(layouts: ReturnType<typeof placeTasks>, taskId: string): string[] {
  const isos: string[] = [];
  for (const layout of layouts) {
    for (const [iso, list] of Object.entries(layout.chipsByIso)) {
      if (list.some((t) => t.id === taskId)) isos.push(iso);
    }
  }
  return isos.sort();
}

function allSegmentsFor(layouts: ReturnType<typeof placeTasks>, taskId: string) {
  return layouts.flatMap((layout) =>
    layout.segments.filter((s) => s.task.id === taskId),
  );
}

beforeEach(() => {
  // Pin "today" via a LOCAL constructor so isToday is deterministic in any
  // runner timezone: local 2026-06-11 noon.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 11, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  buildMonthGrid — structure                                         */
/* ------------------------------------------------------------------ */

describe("buildMonthGrid", () => {
  it("aligns every month of 2026 to Monday-start weeks (months starting on all 7 weekdays)", () => {
    // 2026's months collectively start on every weekday, so this loop covers
    // Monday-alignment for first-days Mon through Sun.
    const firstDayWeekdays = new Set<number>();
    for (let month = 0; month < 12; month++) {
      firstDayWeekdays.add(new Date(2026, month, 1).getDay());

      const weeks = buildMonthGrid(2026, month);
      expect(weeks.length).toBeGreaterThanOrEqual(4);
      expect(weeks.length).toBeLessThanOrEqual(6);

      for (const week of weeks) {
        expect(week).toHaveLength(7);
        expect(weekdayOf(week[0].iso)).toBe(1); // Monday
        expect(weekdayOf(week[6].iso)).toBe(0); // Sunday (week END, matches endOfWeek)
      }

      // Cells are consecutive local days with no gaps or repeats.
      const days = weeks.flat();
      for (let i = 1; i < days.length; i++) {
        const prev = localDate(days[i - 1].iso);
        const next = localDate(days[i].iso);
        expect(next.getTime() - prev.getTime()).toBeGreaterThanOrEqual(
          23 * 60 * 60 * 1000, // ≥23h handles DST-shortened days
        );
        expect(next.getTime() - prev.getTime()).toBeLessThanOrEqual(
          25 * 60 * 60 * 1000,
        );
      }

      // Exactly the month's days are inMonth, starting at the 1st.
      const inMonth = days.filter((d) => d.inMonth);
      const daysInMonth = new Date(2026, month + 1, 0).getDate();
      expect(inMonth).toHaveLength(daysInMonth);
      expect(inMonth[0].iso).toBe(
        `2026-${String(month + 1).padStart(2, "0")}-01`,
      );
      // The 1st sits at the column matching its weekday (Monday-start rotation).
      const firstIdx = days.findIndex((d) => d.inMonth);
      expect(firstIdx).toBe((new Date(2026, month, 1).getDay() + 6) % 7);
    }
    expect(firstDayWeekdays.size).toBe(7);
  });

  it("renders February 2027 (starts Monday, 28 days) as exactly 4 fully in-month weeks", () => {
    const weeks = buildMonthGrid(2027, 1);
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0].iso).toBe("2027-02-01");
    expect(weeks[3][6].iso).toBe("2027-02-28");
    expect(weeks.flat().every((d) => d.inMonth)).toBe(true);
  });

  it("includes Feb 29 in leap-year February 2028", () => {
    const weeks = buildMonthGrid(2028, 1);
    const days = weeks.flat();
    const leapDay = days.find((d) => d.iso === "2028-02-29");
    expect(leapDay).toBeDefined();
    expect(leapDay?.inMonth).toBe(true);
    const inMonth = days.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[inMonth.length - 1].iso).toBe("2028-02-29");
  });

  it("ends non-leap February 2026 on Feb 28 with no Feb 29 cell", () => {
    const weeks = buildMonthGrid(2026, 1);
    const days = weeks.flat();
    expect(days.some((d) => d.iso === "2026-02-29")).toBe(false);
    const inMonth = days.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[inMonth.length - 1].iso).toBe("2026-02-28");
  });

  it("renders May 2027 (starts Saturday, 31 days) as a 6-week grid", () => {
    const weeks = buildMonthGrid(2027, 4);
    expect(weeks).toHaveLength(6);
    // Grid backfills to the Monday before May 1 (Saturday)…
    expect(weeks[0][0].iso).toBe("2027-04-26");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][5].iso).toBe("2027-05-01");
    expect(weeks[0][5].inMonth).toBe(true);
    // …and fills forward past May 31 (Monday) to the following Sunday.
    expect(weeks[5][0].iso).toBe("2027-05-31");
    expect(weeks[5][0].inMonth).toBe(true);
    expect(weeks[5][6].iso).toBe("2027-06-06");
    expect(weeks[5][6].inMonth).toBe(false);
  });

  it("flags exactly one cell as today, matching the local calendar date", () => {
    const now = new Date();
    const weeks = buildMonthGrid(now.getFullYear(), now.getMonth());
    const todayCells = weeks.flat().filter((d) => d.isToday);
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].iso).toBe(toIsoDate(now));
    expect(todayCells[0].iso).toBe("2026-06-11");
  });

  it("flags no cell as today in a month that does not contain today", () => {
    const weeks = buildMonthGrid(2026, 8); // September 2026
    expect(weeks.flat().some((d) => d.isToday)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  buildMonthGrid — timezone safety                                   */
/* ------------------------------------------------------------------ */

/**
 * These suites flip the process timezone (works on Linux/modern Node: env
 * TZ reassignment invalidates the date cache) and pin the system clock to
 * instants where the LOCAL calendar date differs from the UTC date. If the
 * implementation ever leaked toISOString()/UTC parsing, the cell isos or
 * the isToday flag would land on the wrong day and these fail.
 */
describe("buildMonthGrid timezone safety", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("marks the local date as today for users WEST of UTC (late evening, UTC already tomorrow)", () => {
    process.env.TZ = "America/New_York"; // UTC-4 in June (EDT)
    // Verify the TZ switch actually took effect before asserting on it.
    expect(new Date("2026-06-12T03:00:00Z").getTimezoneOffset()).toBe(240);

    // 03:00 UTC on Jun 12 === 23:00 Jun 11 in New York.
    vi.setSystemTime(new Date("2026-06-12T03:00:00Z"));

    const weeks = buildMonthGrid(2026, 5);
    const todayCells = weeks.flat().filter((d) => d.isToday);
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].iso).toBe("2026-06-11"); // local date, NOT the UTC date
    // Cell isos are local-constructed: the June grid starts exactly Jun 1
    // (a Monday) even though local-midnight Jun 1 is May 31 in UTC terms.
    expect(weeks[0][0].iso).toBe("2026-06-01");
  });

  it("marks the local date as today for users EAST of UTC (early morning, UTC still yesterday)", () => {
    process.env.TZ = "Pacific/Auckland"; // UTC+12 in June (NZST)
    expect(new Date("2026-06-11T13:00:00Z").getTimezoneOffset()).toBe(-720);

    // 13:00 UTC Jun 11 === 01:00 Jun 12 in Auckland — the +11/+12 "straddling
    // UTC midnight" scenario from the spec.
    vi.setSystemTime(new Date("2026-06-11T13:00:00Z"));

    const weeks = buildMonthGrid(2026, 5);
    const todayCells = weeks.flat().filter((d) => d.isToday);
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].iso).toBe("2026-06-12"); // local date, NOT the UTC date
    // toIsoDate(new Date(2026, 5, 1)) via toISOString would yield "2026-05-31"
    // in UTC+12 — the local-getter construction keeps it correct.
    expect(weeks[0][0].iso).toBe("2026-06-01");
  });
});

/* ------------------------------------------------------------------ */
/*  placeTasks                                                         */
/* ------------------------------------------------------------------ */

describe("placeTasks", () => {
  // June 2026 starts on a Monday: a clean fixture where week rows are
  // W0: Jun 1–7, W1: Jun 8–14, W2: Jun 15–21, W3: Jun 22–28, W4: Jun 29–Jul 5.
  let weeks: Week[];

  beforeEach(() => {
    weeks = buildMonthGrid(2026, 5);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0].iso).toBe("2026-06-01");
  });

  it("returns one WeekLayout per week, parallel to the input", () => {
    const layouts = placeTasks(weeks, []);
    expect(layouts).toHaveLength(weeks.length);
    for (const layout of layouts) {
      expect(layout.segments).toEqual([]);
      expect(layout.chipsByIso).toEqual({});
    }
  });

  it("places a span contained in one week with exact columns and no clip flags", () => {
    const task = makeTask({
      id: "a",
      startDate: "2026-06-02",
      dueDate: "2026-06-05",
    });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts[0].segments).toEqual([
      {
        task,
        colStart: 2, // Tuesday
        colEnd: 5, // Friday
        lane: 0,
        clippedLeft: false,
        clippedRight: false,
      },
    ]);
    for (let w = 1; w < layouts.length; w++) {
      expect(layouts[w].segments).toEqual([]);
    }
    expect(chipIsosFor(layouts, "a")).toEqual([]);
  });

  it("clips a span crossing a week boundary, setting clippedRight then clippedLeft", () => {
    const task = makeTask({
      id: "a",
      startDate: "2026-06-04", // Thursday of W0
      dueDate: "2026-06-10", // Wednesday of W1
    });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts[0].segments).toEqual([
      { task, colStart: 4, colEnd: 7, lane: 0, clippedLeft: false, clippedRight: true },
    ]);
    expect(layouts[1].segments).toEqual([
      { task, colStart: 1, colEnd: 3, lane: 0, clippedLeft: true, clippedRight: false },
    ]);
    expect(layouts[2].segments).toEqual([]);
  });

  it("clips spans at the month/grid edges and flags the off-grid continuation", () => {
    const fromMay = makeTask({
      id: "from-may",
      startDate: "2026-05-28", // before the grid starts
      dueDate: "2026-06-02",
    });
    const intoJuly = makeTask({
      id: "into-july",
      startDate: "2026-06-29", // Monday of the last week
      dueDate: "2026-07-08", // beyond the grid's last cell (Jul 5)
    });
    const layouts = placeTasks(weeks, [fromMay, intoJuly]);

    expect(layouts[0].segments).toEqual([
      {
        task: fromMay,
        colStart: 1,
        colEnd: 2,
        lane: 0,
        clippedLeft: true,
        clippedRight: false,
      },
    ]);
    expect(layouts[4].segments).toEqual([
      {
        task: intoJuly,
        colStart: 1,
        colEnd: 7,
        lane: 0,
        clippedLeft: false,
        clippedRight: true,
      },
    ]);
  });

  it("normalizes full ISO timestamps via slice(0,10) instead of UTC-parsing them", () => {
    const task = makeTask({
      id: "a",
      startDate: "2026-06-04T00:00:00.000Z",
      dueDate: "2026-06-05T23:59:59.000Z",
    });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts[0].segments).toEqual([
      { task, colStart: 4, colEnd: 5, lane: 0, clippedLeft: false, clippedRight: false },
    ]);
  });

  it("packs overlapping spans greedily into lanes 0, 1, 2 and demotes the 4th to per-day chips", () => {
    const a = makeTask({ id: "a", startDate: "2026-06-01", dueDate: "2026-06-05" });
    const b = makeTask({ id: "b", startDate: "2026-06-02", dueDate: "2026-06-06" });
    const c = makeTask({ id: "c", startDate: "2026-06-03", dueDate: "2026-06-07" });
    const d = makeTask({ id: "d", startDate: "2026-06-04", dueDate: "2026-06-06" });
    const layouts = placeTasks(weeks, [d, c, b, a]); // input order must not matter

    const w0 = layouts[0];
    expect(w0.segments).toHaveLength(MAX_LANES);
    const laneById = Object.fromEntries(
      w0.segments.map((s) => [s.task.id, s.lane]),
    );
    expect(laneById).toEqual({ a: 0, b: 1, c: 2 });

    // The overflow span appears as a chip on EVERY day it covers this week.
    expect(allSegmentsFor(layouts, "d")).toEqual([]);
    expect(chipIsosFor(layouts, "d")).toEqual([
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
    ]);
  });

  it("reuses a freed lane for non-overlapping spans (greedy lowest-free-lane)", () => {
    const a = makeTask({ id: "a", startDate: "2026-06-01", dueDate: "2026-06-02" });
    const b = makeTask({ id: "b", startDate: "2026-06-03", dueDate: "2026-06-04" });
    const layouts = placeTasks(weeks, [a, b]);
    expect(layouts[0].segments.map((s) => [s.task.id, s.lane])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("demotes per week: an overflowing task is chips in the crowded week but a bar in a quiet week", () => {
    // Three blockers fill W0's lanes; "long" spans W0 and W1 but only W0
    // is crowded, so it demotes in W0 and gets a lane in W1.
    const blockers = [1, 2, 3].map((n) =>
      makeTask({ id: `blk${n}`, startDate: "2026-06-01", dueDate: "2026-06-07" }),
    );
    const long = makeTask({
      id: "long",
      startDate: "2026-06-05",
      dueDate: "2026-06-09",
    });
    const layouts = placeTasks(weeks, [...blockers, long]);

    expect(allSegmentsFor([layouts[0]], "long")).toEqual([]);
    expect(chipIsosFor([layouts[0]], "long")).toEqual([
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
    expect(allSegmentsFor([layouts[1]], "long")).toEqual([
      {
        task: long,
        colStart: 1,
        colEnd: 2,
        lane: 0,
        clippedLeft: true,
        clippedRight: false,
      },
    ]);
  });

  it("places due-only tasks as a single chip on the due day", () => {
    const task = makeTask({ id: "a", dueDate: "2026-06-15" });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts.every((l) => l.segments.length === 0)).toBe(true);
    expect(layouts[2].chipsByIso["2026-06-15"]).toEqual([task]);
    expect(chipIsosFor(layouts, "a")).toEqual(["2026-06-15"]);
  });

  it("places start-only tasks as a single chip on the start day", () => {
    const task = makeTask({ id: "a", startDate: "2026-06-03" });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts.every((l) => l.segments.length === 0)).toBe(true);
    expect(layouts[0].chipsByIso["2026-06-03"]).toEqual([task]);
  });

  it("degrades an inverted range (start after due) to a chip on the due day", () => {
    const task = makeTask({
      id: "a",
      startDate: "2026-06-10",
      dueDate: "2026-06-08",
    });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts.every((l) => l.segments.length === 0)).toBe(true);
    expect(chipIsosFor(layouts, "a")).toEqual(["2026-06-08"]);
  });

  it("ignores tasks with neither date", () => {
    const task = makeTask({ id: "a" });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts.every((l) => l.segments.length === 0)).toBe(true);
    expect(layouts.every((l) => Object.keys(l.chipsByIso).length === 0)).toBe(true);
  });

  it("drops dated work that falls entirely outside the visible grid", () => {
    const layouts = placeTasks(weeks, [
      makeTask({ id: "chip", dueDate: "2026-08-15" }),
      makeTask({ id: "span", startDate: "2026-08-01", dueDate: "2026-08-10" }),
    ]);
    expect(layouts.every((l) => l.segments.length === 0)).toBe(true);
    expect(layouts.every((l) => Object.keys(l.chipsByIso).length === 0)).toBe(true);
  });

  it("sorts each day's chips by priority so per-cell truncation keeps important work visible", () => {
    const mk = (id: string, priority: TaskPriority) =>
      makeTask({ id, priority, dueDate: "2026-06-15", title: `t-${id}` });
    const low = mk("low", "low");
    const urgent = mk("urgent", "urgent");
    const none = mk("none", "none");
    const high = mk("high", "high");
    const layouts = placeTasks(weeks, [low, urgent, none, high]);

    const chips = layouts[2].chipsByIso["2026-06-15"];
    expect(chips.map((t) => t.id)).toEqual(["urgent", "high", "low", "none"]);
    // The UI truncates the list and derives "+N more" from its length.
    expect(chips).toHaveLength(4);
  });

  it("places chips on visible out-of-month cells (they are real, rendered days)", () => {
    // June 2026's grid runs through Jul 5 in its final week.
    const task = makeTask({ id: "a", dueDate: "2026-07-03" });
    const layouts = placeTasks(weeks, [task]);
    expect(layouts[4].chipsByIso["2026-07-03"]).toEqual([task]);
  });
});

/* ------------------------------------------------------------------ */
/*  date.ts additions — addMonths / startOfMonth                       */
/* ------------------------------------------------------------------ */

describe("addMonths", () => {
  it("clamps Jan 31 + 1 month to Feb 28 in a non-leap year", () => {
    const result = addMonths(new Date(2026, 0, 31), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([
      2026, 1, 28,
    ]);
  });

  it("clamps Jan 31 + 1 month to Feb 29 in a leap year", () => {
    const result = addMonths(new Date(2028, 0, 31), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([
      2028, 1, 29,
    ]);
  });

  it("rolls Dec + 1 month into January of the next year", () => {
    const result = addMonths(new Date(2026, 11, 15), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([
      2027, 0, 15,
    ]);
  });

  it("rolls Jan - 1 month into December of the previous year", () => {
    const result = addMonths(new Date(2026, 0, 15), -1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([
      2025, 11, 15,
    ]);
  });

  it("clamps when stepping backwards (Mar 31 - 1 month = Feb 28)", () => {
    const result = addMonths(new Date(2026, 2, 31), -1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([
      2026, 1, 28,
    ]);
  });

  it("preserves time-of-day and does not mutate its input", () => {
    const input = new Date(2026, 0, 31, 15, 30, 45, 123);
    const before = input.getTime();
    const result = addMonths(input, 1);
    expect(input.getTime()).toBe(before);
    expect([
      result.getHours(),
      result.getMinutes(),
      result.getSeconds(),
      result.getMilliseconds(),
    ]).toEqual([15, 30, 45, 123]);
  });

  it("returns the same calendar date for n = 0", () => {
    const result = addMonths(new Date(2026, 5, 11), 0);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([
      2026, 5, 11,
    ]);
  });

  it("steps every month of a year exactly once when navigating from a month-end anchor", () => {
    // The regression addMonths guards against: a naive setMonth from Jan 31
    // overflows past February. Repeated stepping must visit all 12 months.
    let cursor = new Date(2026, 0, 31);
    const visited: number[] = [cursor.getMonth()];
    for (let i = 0; i < 11; i++) {
      cursor = addMonths(cursor, 1);
      visited.push(cursor.getMonth());
    }
    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("startOfMonth", () => {
  it("returns the 1st of the month at local midnight", () => {
    const result = startOfMonth(new Date(2026, 5, 17, 14, 3, 22, 9));
    expect(result.getTime()).toBe(new Date(2026, 5, 1).getTime());
  });

  it("is a no-op date-wise when already on the 1st", () => {
    const result = startOfMonth(new Date(2026, 5, 1, 8, 0));
    expect(result.getTime()).toBe(new Date(2026, 5, 1).getTime());
  });

  it("does not mutate its input", () => {
    const input = new Date(2026, 5, 17, 14, 3);
    const before = input.getTime();
    startOfMonth(input);
    expect(input.getTime()).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/*  toIsoDate                                                          */
/* ------------------------------------------------------------------ */

describe("toIsoDate", () => {
  it("zero-pads single-digit months and days", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoDate(new Date(2026, 10, 30))).toBe("2026-11-30");
  });
});
