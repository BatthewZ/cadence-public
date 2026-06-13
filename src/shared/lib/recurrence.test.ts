import { describe, expect, it } from "vitest";

import type { RecurrenceRule } from "@/shared/types/recurrence";

import { computeNextDueDate, computeNextStartDate, formatRecurrenceRule } from "./recurrence";

/** Helper: create a UTC date from "YYYY-MM-DD" */
function utc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Helper: format a Date to "YYYY-MM-DD" for readable assertions */
function fmt(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// computeNextDueDate
// ---------------------------------------------------------------------------

describe("computeNextDueDate", () => {
  // -------------------------------------------------------------------------
  // Daily
  // -------------------------------------------------------------------------
  describe("daily frequency", () => {
    it("interval=1 advances by one day", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 1 };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-11");
    });

    it("interval=3 advances by three days", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 3 };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-13");
    });

    it("late completion uses completionDate as anchor", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 1 };
      // Due Mon, completed Wed → next is Thu
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-12"), rule);
      expect(fmt(result)).toBe("2025-03-13");
    });

    it("crosses month boundary", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 1 };
      const result = computeNextDueDate(utc("2025-01-31"), utc("2025-01-31"), rule);
      expect(fmt(result)).toBe("2025-02-01");
    });

    it("crosses year boundary", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 2 };
      const result = computeNextDueDate(utc("2025-12-31"), utc("2025-12-31"), rule);
      expect(fmt(result)).toBe("2026-01-02");
    });
  });

  // -------------------------------------------------------------------------
  // Weekly (no daysOfWeek)
  // -------------------------------------------------------------------------
  describe("weekly frequency (no daysOfWeek)", () => {
    it("interval=1 advances by 7 days", () => {
      const rule: RecurrenceRule = { frequency: "weekly", interval: 1 };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-17");
    });

    it("interval=2 advances by 14 days", () => {
      const rule: RecurrenceRule = { frequency: "weekly", interval: 2 };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-24");
    });

    it("late completion uses completionDate", () => {
      const rule: RecurrenceRule = { frequency: "weekly", interval: 1 };
      // Due Mon 3/10, completed Wed 3/12 → anchor is 3/12, next is 3/19
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-12"), rule);
      expect(fmt(result)).toBe("2025-03-19");
    });
  });

  // -------------------------------------------------------------------------
  // Weekly (with daysOfWeek)
  // -------------------------------------------------------------------------
  describe("weekly frequency (with daysOfWeek)", () => {
    it("single day: finds next occurrence in next week", () => {
      // 2025-03-10 is Monday (day 1). Rule: every week on Monday.
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1], // Monday
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-17"); // next Monday
    });

    it("single day later in same week", () => {
      // 2025-03-10 is Monday (day 1). Rule: every week on Friday (5).
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [5], // Friday
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-14"); // this Friday
    });

    it("multiple days: picks next matching day", () => {
      // 2025-03-10 is Monday. Rule: Mon, Wed, Fri.
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1, 3, 5],
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-12"); // Wednesday
    });

    it("multiple days: wraps to next week when past all days", () => {
      // 2025-03-14 is Friday. Rule: every week on Mon, Wed.
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1, 3],
      };
      const result = computeNextDueDate(utc("2025-03-14"), utc("2025-03-14"), rule);
      expect(fmt(result)).toBe("2025-03-17"); // next Monday
    });

    it("interval=2: skips a week", () => {
      // 2025-03-10 is Monday. Rule: every 2 weeks on Mon.
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 2,
        daysOfWeek: [1],
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-24"); // Monday two weeks later
    });

    it("late completion finds next matching day after anchor", () => {
      // Due Mon 3/10, completed Wed 3/12. Rule: every week on Mon.
      // Anchor is Wed 3/12. Next Mon after that is 3/17.
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1],
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-12"), rule);
      expect(fmt(result)).toBe("2025-03-17");
    });

    it("late completion with multiple days picks first valid after anchor", () => {
      // Due Mon 3/10, completed Wed 3/12. Rule: every week on Mon, Fri.
      // Anchor is Wed 3/12. Next matching day after Wed is Fri 3/14.
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1, 5],
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-12"), rule);
      expect(fmt(result)).toBe("2025-03-14");
    });

    it("weekend days: Saturday and Sunday", () => {
      // 2025-03-10 is Monday. Rule: every week on Sat (6) and Sun (0).
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [0, 6],
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-15"); // Saturday
    });
  });

  // -------------------------------------------------------------------------
  // Monthly (dayOfMonth)
  // -------------------------------------------------------------------------
  describe("monthly frequency (dayOfMonth)", () => {
    it("normal month advance", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 15,
      };
      const result = computeNextDueDate(utc("2025-03-15"), utc("2025-03-15"), rule);
      expect(fmt(result)).toBe("2025-04-15");
    });

    it("interval=2 advances by 2 months", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 2,
        dayOfMonth: 10,
      };
      const result = computeNextDueDate(utc("2025-01-10"), utc("2025-01-10"), rule);
      expect(fmt(result)).toBe("2025-03-10");
    });

    it("end-of-month clamping: Jan 31 → Feb 28 (non-leap)", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 31,
      };
      const result = computeNextDueDate(utc("2025-01-31"), utc("2025-01-31"), rule);
      expect(fmt(result)).toBe("2025-02-28");
    });

    it("end-of-month clamping: Jan 31 → Feb 29 (leap year)", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 31,
      };
      const result = computeNextDueDate(utc("2024-01-31"), utc("2024-01-31"), rule);
      expect(fmt(result)).toBe("2024-02-29");
    });

    it("day 30 in February clamps to 28 (non-leap)", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 30,
      };
      const result = computeNextDueDate(utc("2025-01-30"), utc("2025-01-30"), rule);
      expect(fmt(result)).toBe("2025-02-28");
    });

    it("day 31 in April clamps to 30", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 31,
      };
      const result = computeNextDueDate(utc("2025-03-31"), utc("2025-03-31"), rule);
      expect(fmt(result)).toBe("2025-04-30");
    });

    it("crosses year boundary", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 15,
      };
      const result = computeNextDueDate(utc("2025-12-15"), utc("2025-12-15"), rule);
      expect(fmt(result)).toBe("2026-01-15");
    });
  });

  // -------------------------------------------------------------------------
  // Monthly (nthWeekday)
  // -------------------------------------------------------------------------
  describe("monthly frequency (nthWeekday)", () => {
    it("1st Monday of the month", () => {
      // 2025-03-03 is the 1st Monday of March.
      // Next: 1st Monday of April = 2025-04-07
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        nthWeekday: { n: 1, day: 1 },
      };
      const result = computeNextDueDate(utc("2025-03-03"), utc("2025-03-03"), rule);
      expect(fmt(result)).toBe("2025-04-07");
    });

    it("2nd Tuesday of the month", () => {
      // 2025-03-11 is the 2nd Tuesday of March.
      // Next: 2nd Tuesday of April = 2025-04-08
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        nthWeekday: { n: 2, day: 2 },
      };
      const result = computeNextDueDate(utc("2025-03-11"), utc("2025-03-11"), rule);
      expect(fmt(result)).toBe("2025-04-08");
    });

    it("3rd Friday of the month", () => {
      // 2025-03-21 is the 3rd Friday of March.
      // Next: 3rd Friday of April = 2025-04-18
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        nthWeekday: { n: 3, day: 5 },
      };
      const result = computeNextDueDate(utc("2025-03-21"), utc("2025-03-21"), rule);
      expect(fmt(result)).toBe("2025-04-18");
    });

    it("5th Monday falls back to last Monday when 5th doesn't exist", () => {
      // Rule: 5th Monday. In April 2025, Mondays are 7, 14, 21, 28 (only 4).
      // Should fall back to the 4th Monday = April 28.
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        nthWeekday: { n: 5, day: 1 },
      };
      const result = computeNextDueDate(utc("2025-03-31"), utc("2025-03-31"), rule);
      expect(fmt(result)).toBe("2025-04-28");
    });

    it("5th Monday exists in a month that has 5 Mondays", () => {
      // March 2025 has Mondays: 3, 10, 17, 24, 31 → 5th Monday is March 31.
      // Anchor: Feb 2025. Rule: 5th Monday, interval 1.
      // Feb → March. March 31 is the 5th Monday.
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        nthWeekday: { n: 5, day: 1 },
      };
      const result = computeNextDueDate(utc("2025-02-24"), utc("2025-02-24"), rule);
      expect(fmt(result)).toBe("2025-03-31");
    });

    it("interval=2 advances by 2 months", () => {
      // 1st Monday of Jan 2025 = Jan 6.
      // Skip 2 months → 1st Monday of March 2025 = March 3.
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 2,
        nthWeekday: { n: 1, day: 1 },
      };
      const result = computeNextDueDate(utc("2025-01-06"), utc("2025-01-06"), rule);
      expect(fmt(result)).toBe("2025-03-03");
    });

    it("4th Thursday (Thanksgiving-style)", () => {
      // 4th Thursday of November 2025.
      // Nov 2025 Thursdays: 6, 13, 20, 27 → 4th is Nov 27.
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        nthWeekday: { n: 4, day: 4 },
      };
      const result = computeNextDueDate(utc("2025-10-23"), utc("2025-10-23"), rule);
      expect(fmt(result)).toBe("2025-11-27");
    });
  });

  // -------------------------------------------------------------------------
  // Monthly (neither dayOfMonth nor nthWeekday)
  // -------------------------------------------------------------------------
  describe("monthly frequency (plain - no dayOfMonth, no nthWeekday)", () => {
    it("advances by interval months keeping same day", () => {
      const rule: RecurrenceRule = { frequency: "monthly", interval: 1 };
      const result = computeNextDueDate(utc("2025-03-15"), utc("2025-03-15"), rule);
      expect(fmt(result)).toBe("2025-04-15");
    });

    it("clamps day to end-of-month when target month is shorter", () => {
      const rule: RecurrenceRule = { frequency: "monthly", interval: 1 };
      // March 31 → April has 30 days
      const result = computeNextDueDate(utc("2025-03-31"), utc("2025-03-31"), rule);
      expect(fmt(result)).toBe("2025-04-30");
    });

    it("interval=3 advances by 3 months", () => {
      const rule: RecurrenceRule = { frequency: "monthly", interval: 3 };
      const result = computeNextDueDate(utc("2025-01-15"), utc("2025-01-15"), rule);
      expect(fmt(result)).toBe("2025-04-15");
    });
  });

  // -------------------------------------------------------------------------
  // Yearly
  // -------------------------------------------------------------------------
  describe("yearly frequency", () => {
    it("interval=1 advances by one year", () => {
      const rule: RecurrenceRule = { frequency: "yearly", interval: 1 };
      const result = computeNextDueDate(utc("2025-06-15"), utc("2025-06-15"), rule);
      expect(fmt(result)).toBe("2026-06-15");
    });

    it("interval=2 advances by two years", () => {
      const rule: RecurrenceRule = { frequency: "yearly", interval: 2 };
      const result = computeNextDueDate(utc("2025-06-15"), utc("2025-06-15"), rule);
      expect(fmt(result)).toBe("2027-06-15");
    });

    it("Feb 29 in leap year → Feb 28 in non-leap year", () => {
      const rule: RecurrenceRule = { frequency: "yearly", interval: 1 };
      const result = computeNextDueDate(utc("2024-02-29"), utc("2024-02-29"), rule);
      expect(fmt(result)).toBe("2025-02-28");
    });

    it("Feb 29 to Feb 29 when next year is also a leap year (interval=4)", () => {
      const rule: RecurrenceRule = { frequency: "yearly", interval: 4 };
      const result = computeNextDueDate(utc("2024-02-29"), utc("2024-02-29"), rule);
      expect(fmt(result)).toBe("2028-02-29");
    });

    it("crosses decade boundary", () => {
      const rule: RecurrenceRule = { frequency: "yearly", interval: 1 };
      const result = computeNextDueDate(utc("2029-07-04"), utc("2029-07-04"), rule);
      expect(fmt(result)).toBe("2030-07-04");
    });
  });

  // -------------------------------------------------------------------------
  // End date
  // -------------------------------------------------------------------------
  describe("end date", () => {
    it("returns the date when computed date is before endDate", () => {
      const rule: RecurrenceRule = {
        frequency: "daily",
        interval: 1,
        endDate: "2025-03-20",
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-11");
    });

    it("returns null when computed date is after endDate", () => {
      const rule: RecurrenceRule = {
        frequency: "daily",
        interval: 1,
        endDate: "2025-03-11",
      };
      const result = computeNextDueDate(utc("2025-03-11"), utc("2025-03-11"), rule);
      // Next would be 2025-03-12, which is after endDate 2025-03-11
      expect(result).toBeNull();
    });

    it("returns null when computed date falls on exact endDate (exclusive)", () => {
      const rule: RecurrenceRule = {
        frequency: "daily",
        interval: 1,
        endDate: "2025-03-12",
      };
      const result = computeNextDueDate(utc("2025-03-11"), utc("2025-03-11"), rule);
      // Next would be 2025-03-12, which equals endDate → null (exclusive)
      expect(result).toBeNull();
    });

    it("works with weekly frequency and endDate", () => {
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        endDate: "2025-03-20",
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-17"); // within range
    });

    it("weekly frequency returns null when next occurrence exceeds endDate", () => {
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        endDate: "2025-03-15",
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      // Next would be 2025-03-17, which exceeds endDate 2025-03-15
      expect(result).toBeNull();
    });

    it("monthly frequency respects endDate", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 15,
        endDate: "2025-04-14",
      };
      const result = computeNextDueDate(utc("2025-03-15"), utc("2025-03-15"), rule);
      // Next would be 2025-04-15, which exceeds endDate 2025-04-14
      expect(result).toBeNull();
    });

    it("yearly frequency respects endDate", () => {
      const rule: RecurrenceRule = {
        frequency: "yearly",
        interval: 1,
        endDate: "2026-01-01",
      };
      const result = computeNextDueDate(utc("2025-06-15"), utc("2025-06-15"), rule);
      // Next would be 2026-06-15, which exceeds endDate
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Late completion (anchor uses completionDate)
  // -------------------------------------------------------------------------
  describe("late completion anchoring", () => {
    it("daily: late completion skips forward", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 1 };
      // Due March 10, completed March 15 → next is March 16
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-15"), rule);
      expect(fmt(result)).toBe("2025-03-16");
    });

    it("weekly: late completion skips forward past missed week", () => {
      const rule: RecurrenceRule = { frequency: "weekly", interval: 1 };
      // Due Monday 3/10, completed Wednesday 3/19 → anchor 3/19, next 3/26
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-19"), rule);
      expect(fmt(result)).toBe("2025-03-26");
    });

    it("weekly with daysOfWeek: late completion finds next valid day", () => {
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1], // Monday
      };
      // Due Monday 3/10, completed Wednesday 3/12. Anchor = 3/12.
      // Next Monday after 3/12 is 3/17.
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-12"), rule);
      expect(fmt(result)).toBe("2025-03-17");
    });

    it("monthly: late completion pushes anchor forward", () => {
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 1,
      };
      // Due March 1, completed March 20 → anchor is March 20.
      // Advance 1 month from anchor → April, set day to 1 → April 1.
      // April 1 is after March 20, so it's the correct result.
      const result = computeNextDueDate(utc("2025-03-01"), utc("2025-03-20"), rule);
      expect(fmt(result)).toBe("2025-04-01");
    });

    it("yearly: very late completion", () => {
      const rule: RecurrenceRule = { frequency: "yearly", interval: 1 };
      // Due Jan 1 2025, completed June 15 2025 → anchor June 15 → next June 15 2026
      const result = computeNextDueDate(utc("2025-01-01"), utc("2025-06-15"), rule);
      expect(fmt(result)).toBe("2026-06-15");
    });

    it("on-time completion uses dueDate as anchor", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 1 };
      // Due March 10, completed March 10 (on time) → anchor is March 10 → next March 11
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(fmt(result)).toBe("2025-03-11");
    });

    it("early completion still uses dueDate as anchor", () => {
      const rule: RecurrenceRule = { frequency: "daily", interval: 1 };
      // Due March 10, completed March 8 (early) → anchor is March 10 → next March 11
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-08"), rule);
      expect(fmt(result)).toBe("2025-03-11");
    });
  });

  // -------------------------------------------------------------------------
  // Edge: result must be strictly after anchor
  // -------------------------------------------------------------------------
  describe("result is strictly after anchor", () => {
    it("weekly daysOfWeek: anchor day matches rule day but result is in the future", () => {
      // 2025-03-10 is Monday. Rule: every week on Monday.
      // Computed from anchor Monday → must land on a FUTURE Monday (3/17), not 3/10.
      const rule: RecurrenceRule = {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1],
      };
      const result = computeNextDueDate(utc("2025-03-10"), utc("2025-03-10"), rule);
      expect(result!.getTime()).toBeGreaterThan(utc("2025-03-10").getTime());
      expect(fmt(result)).toBe("2025-03-17");
    });

    it("monthly nthWeekday: computed date in target month is before anchor", () => {
      // Anchor: March 28. Rule: 1st Monday, interval 1.
      // April 1st Monday is April 7. Anchor is March 28.
      // April 7 > March 28, so it should be fine.
      const rule: RecurrenceRule = {
        frequency: "monthly",
        interval: 1,
        nthWeekday: { n: 1, day: 1 },
      };
      const result = computeNextDueDate(utc("2025-03-28"), utc("2025-03-28"), rule);
      expect(result!.getTime()).toBeGreaterThan(utc("2025-03-28").getTime());
      expect(fmt(result)).toBe("2025-04-07");
    });
  });
});

// ---------------------------------------------------------------------------
// computeNextStartDate
// ---------------------------------------------------------------------------

/**
 * computeNextStartDate derives the spawned instance's startDate from the next
 * due date by preserving the previous start→due whole-day span. These tests
 * matter because recurrence is anchored exclusively on due dates — if the
 * derived offset drifted (month boundaries, DST), recurring date-range tasks
 * would silently shrink or grow their planned duration on every completion.
 */
describe("computeNextStartDate", () => {
  it("3-day span with weekly recurrence: next start = next due − 3 days", () => {
    // Previous instance spans Fri 3/7 → Mon 3/10 (3 whole days).
    const prevStart = utc("2025-03-07");
    const prevDue = utc("2025-03-10");
    const rule: RecurrenceRule = { frequency: "weekly", interval: 1 };
    const nextDue = computeNextDueDate(prevDue, prevDue, rule);
    expect(fmt(nextDue)).toBe("2025-03-17");

    const nextStart = computeNextStartDate(nextDue!, prevStart, prevDue);
    expect(fmt(nextStart)).toBe("2025-03-14"); // 3 days before next due
  });

  it("zero-duration span (start === due): next start equals next due", () => {
    const sameDay = utc("2025-03-10");
    const nextDue = utc("2025-03-17");

    const nextStart = computeNextStartDate(nextDue, sameDay, sameDay);
    expect(fmt(nextStart)).toBe("2025-03-17");
    expect(nextStart.getTime()).toBe(nextDue.getTime());
  });

  it("month-boundary span: start Jan 30 → due Feb 2 keeps a 3-day span", () => {
    const prevStart = utc("2025-01-30");
    const prevDue = utc("2025-02-02");
    // Monthly on the 2nd: next due is March 2.
    const rule: RecurrenceRule = { frequency: "monthly", interval: 1, dayOfMonth: 2 };
    const nextDue = computeNextDueDate(prevDue, prevDue, rule);
    expect(fmt(nextDue)).toBe("2025-03-02");

    // Subtracting 3 days from March 2 must roll back across the month
    // boundary into February (non-leap 2025 → Feb 27).
    const nextStart = computeNextStartDate(nextDue!, prevStart, prevDue);
    expect(fmt(nextStart)).toBe("2025-02-27");
  });

  it("year-boundary subtraction: next start rolls back into the previous year", () => {
    // 5-day span ending Jan 2 → start must land in the previous December.
    const nextStart = computeNextStartDate(
      utc("2026-01-02"),
      utc("2025-12-22"),
      utc("2025-12-27"),
    );
    expect(fmt(nextStart)).toBe("2025-12-28");
  });

  describe("DST windows (UTC math is drift-free)", () => {
    it("span straddling US spring-forward (2025-03-09) stays exactly 3 days", () => {
      // US DST starts Sun 2025-03-09 (local clocks lose an hour). In local
      // time the start→due delta would be 71h ≠ 3 days; in UTC-midnight
      // timestamps it is exactly 72h, so the span is recovered losslessly.
      const prevStart = utc("2025-03-08");
      const prevDue = utc("2025-03-11");
      expect(prevDue.getTime() - prevStart.getTime()).toBe(3 * 86_400_000);

      const nextStart = computeNextStartDate(utc("2025-03-18"), prevStart, prevDue);
      expect(fmt(nextStart)).toBe("2025-03-15");
    });

    it("span straddling US fall-back (2025-11-02) stays exactly 3 days", () => {
      // US DST ends Sun 2025-11-02 (local clocks gain an hour → 73h locally).
      const prevStart = utc("2025-11-01");
      const prevDue = utc("2025-11-04");
      expect(prevDue.getTime() - prevStart.getTime()).toBe(3 * 86_400_000);

      const nextStart = computeNextStartDate(utc("2025-11-11"), prevStart, prevDue);
      expect(fmt(nextStart)).toBe("2025-11-08");
    });

    it("next due itself inside a DST window subtracts whole UTC days", () => {
      // EU DST starts Sun 2025-03-30. Next due Mon 3/31 with a 2-day span
      // must give Sat 3/29 — crossing the transition without drift.
      const nextStart = computeNextStartDate(
        utc("2025-03-31"),
        utc("2025-03-24"),
        utc("2025-03-26"),
      );
      expect(fmt(nextStart)).toBe("2025-03-29");
    });
  });
});

// ---------------------------------------------------------------------------
// formatRecurrenceRule
// ---------------------------------------------------------------------------

describe("formatRecurrenceRule", () => {
  // -------------------------------------------------------------------------
  // Daily
  // -------------------------------------------------------------------------
  describe("daily", () => {
    it('formats interval=1 as "Every day"', () => {
      expect(formatRecurrenceRule({ frequency: "daily", interval: 1 })).toBe(
        "Every day",
      );
    });

    it('formats interval=2 as "Every 2 days"', () => {
      expect(formatRecurrenceRule({ frequency: "daily", interval: 2 })).toBe(
        "Every 2 days",
      );
    });

    it('formats interval=7 as "Every 7 days"', () => {
      expect(formatRecurrenceRule({ frequency: "daily", interval: 7 })).toBe(
        "Every 7 days",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Weekly
  // -------------------------------------------------------------------------
  describe("weekly", () => {
    it('formats interval=1 with no days as "Every week"', () => {
      expect(formatRecurrenceRule({ frequency: "weekly", interval: 1 })).toBe(
        "Every week",
      );
    });

    it('formats interval=2 with no days as "Every 2 weeks"', () => {
      expect(formatRecurrenceRule({ frequency: "weekly", interval: 2 })).toBe(
        "Every 2 weeks",
      );
    });

    it("formats single day", () => {
      expect(
        formatRecurrenceRule({
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [1],
        }),
      ).toBe("Every week on Mon");
    });

    it("formats multiple days in order", () => {
      expect(
        formatRecurrenceRule({
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [1, 3, 5],
        }),
      ).toBe("Every week on Mon, Wed, Fri");
    });

    it("sorts unsorted daysOfWeek", () => {
      expect(
        formatRecurrenceRule({
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [5, 1, 3],
        }),
      ).toBe("Every week on Mon, Wed, Fri");
    });

    it("formats all 7 days", () => {
      expect(
        formatRecurrenceRule({
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        }),
      ).toBe("Every week on Sun, Mon, Tue, Wed, Thu, Fri, Sat");
    });

    it("formats interval=2 with days", () => {
      expect(
        formatRecurrenceRule({
          frequency: "weekly",
          interval: 2,
          daysOfWeek: [1, 3, 5],
        }),
      ).toBe("Every 2 weeks on Mon, Wed, Fri");
    });

    it("formats weekend days", () => {
      expect(
        formatRecurrenceRule({
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [0, 6],
        }),
      ).toBe("Every week on Sun, Sat");
    });
  });

  // -------------------------------------------------------------------------
  // Monthly
  // -------------------------------------------------------------------------
  describe("monthly", () => {
    it('formats plain monthly as "Every month"', () => {
      expect(formatRecurrenceRule({ frequency: "monthly", interval: 1 })).toBe(
        "Every month",
      );
    });

    it('formats interval=2 as "Every 2 months"', () => {
      expect(formatRecurrenceRule({ frequency: "monthly", interval: 2 })).toBe(
        "Every 2 months",
      );
    });

    it("formats dayOfMonth with ordinal suffix (1st)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 1,
        }),
      ).toBe("Every month on the 1st");
    });

    it("formats dayOfMonth with ordinal suffix (2nd)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 2,
        }),
      ).toBe("Every month on the 2nd");
    });

    it("formats dayOfMonth with ordinal suffix (3rd)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 3,
        }),
      ).toBe("Every month on the 3rd");
    });

    it("formats dayOfMonth with ordinal suffix (4th)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 4,
        }),
      ).toBe("Every month on the 4th");
    });

    it("formats dayOfMonth with ordinal suffix (11th - special case)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 11,
        }),
      ).toBe("Every month on the 11th");
    });

    it("formats dayOfMonth with ordinal suffix (12th - special case)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 12,
        }),
      ).toBe("Every month on the 12th");
    });

    it("formats dayOfMonth with ordinal suffix (13th - special case)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 13,
        }),
      ).toBe("Every month on the 13th");
    });

    it("formats dayOfMonth with ordinal suffix (21st)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 21,
        }),
      ).toBe("Every month on the 21st");
    });

    it("formats dayOfMonth with ordinal suffix (31st)", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          dayOfMonth: 31,
        }),
      ).toBe("Every month on the 31st");
    });

    it("formats dayOfMonth with interval > 1", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 3,
          dayOfMonth: 15,
        }),
      ).toBe("Every 3 months on the 15th");
    });

    it("formats nthWeekday: 1st Monday", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          nthWeekday: { n: 1, day: 1 },
        }),
      ).toBe("Every month on the 1st Mon");
    });

    it("formats nthWeekday: 2nd Tuesday", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          nthWeekday: { n: 2, day: 2 },
        }),
      ).toBe("Every month on the 2nd Tue");
    });

    it("formats nthWeekday: 3rd Friday", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          nthWeekday: { n: 3, day: 5 },
        }),
      ).toBe("Every month on the 3rd Fri");
    });

    it("formats nthWeekday: 4th Thursday", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 1,
          nthWeekday: { n: 4, day: 4 },
        }),
      ).toBe("Every month on the 4th Thu");
    });

    it("formats nthWeekday with interval > 1", () => {
      expect(
        formatRecurrenceRule({
          frequency: "monthly",
          interval: 2,
          nthWeekday: { n: 1, day: 1 },
        }),
      ).toBe("Every 2 months on the 1st Mon");
    });
  });

  // -------------------------------------------------------------------------
  // Yearly
  // -------------------------------------------------------------------------
  describe("yearly", () => {
    it('formats interval=1 as "Every year"', () => {
      expect(formatRecurrenceRule({ frequency: "yearly", interval: 1 })).toBe(
        "Every year",
      );
    });

    it('formats interval=2 as "Every 2 years"', () => {
      expect(formatRecurrenceRule({ frequency: "yearly", interval: 2 })).toBe(
        "Every 2 years",
      );
    });

    it('formats interval=5 as "Every 5 years"', () => {
      expect(formatRecurrenceRule({ frequency: "yearly", interval: 5 })).toBe(
        "Every 5 years",
      );
    });
  });
});
