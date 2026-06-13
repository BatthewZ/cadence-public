// Relative import, not the `@/` alias — type-only so esbuild erases it today,
// but worker-reachable modules avoid the alias entirely: wrangler's esbuild
// can't resolve it, and converting this to a value import with the alias
// would crash `wrangler dev` while every CI gate stays green.
import type { RecurrenceRule } from "../types/recurrence";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Safely parses a JSON-encoded recurrence rule string back into a RecurrenceRule.
 * Returns null for null/undefined input or malformed JSON, avoiding silent
 * data corruption when the stored value is invalid.
 */
export function parseRecurrenceRule(json: string | null | undefined): RecurrenceRule | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RecurrenceRule;
  } catch {
    return null;
  }
}

/**
 * Computes the next due date for a recurring task based on the current due date,
 * the completion date, and the recurrence rule.
 *
 * Uses max(currentDueDate, completionDate) as the anchor so that late completions
 * skip forward instead of generating overdue tasks.
 *
 * Returns null if the computed date would exceed the rule's endDate.
 */
export function computeNextDueDate(
  currentDueDate: Date,
  completionDate: Date,
  rule: RecurrenceRule,
): Date | null {
  const anchor =
    currentDueDate.getTime() >= completionDate.getTime()
      ? new Date(currentDueDate.getTime())
      : new Date(completionDate.getTime());

  let result: Date;

  switch (rule.frequency) {
    case "daily":
      result = computeDaily(anchor, rule.interval);
      break;
    case "weekly":
      result = computeWeekly(anchor, rule.interval, rule.daysOfWeek);
      break;
    case "monthly":
      result = computeMonthly(
        anchor,
        rule.interval,
        rule.dayOfMonth,
        rule.nthWeekday,
      );
      break;
    case "yearly":
      result = computeYearly(anchor, rule.interval);
      break;
  }

  // Guarantee the result is strictly after the anchor.
  // For weekly with daysOfWeek, the initial computation might land on or before the anchor.
  while (result.getTime() <= anchor.getTime()) {
    // Advance by one day and recompute to find the next valid date.
    const nudged = new Date(result.getTime());
    nudged.setUTCDate(nudged.getUTCDate() + 1);

    switch (rule.frequency) {
      case "daily":
        result = nudged;
        break;
      case "weekly":
        if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
          result = findNextMatchingDayOfWeek(nudged, rule.daysOfWeek);
        } else {
          result = nudged;
        }
        break;
      case "monthly":
        result = nudged;
        break;
      case "yearly":
        result = nudged;
        break;
    }
  }

  // End date check (exclusive: if result === endDate, return null)
  if (rule.endDate) {
    const end = parseISODate(rule.endDate);
    if (result.getTime() >= end.getTime()) {
      return null;
    }
  }

  return result;
}

const MS_PER_DAY = 86_400_000;

/**
 * Computes the start date for the next instance of a recurring task by
 * preserving the whole-day span between the previous instance's start and
 * due dates (e.g. a Mon–Thu task recurs as a Mon–Thu task).
 *
 * Recurrence itself stays anchored on due dates — `computeNextDueDate` is
 * the single source of truth for scheduling — and the start date is purely
 * derived: `nextDueDate` minus the previous span.
 *
 * Why UTC day math matters: task dates are stored as UTC-midnight
 * timestamps, so the millisecond delta between two of them is always an
 * exact multiple of 86,400,000 and `Math.round` recovers the whole-day
 * count losslessly. Local-time arithmetic would let DST transitions inside
 * the span perturb the delta by an hour, and rounding/truncation could then
 * silently drift the spawned instance's start date by a day. The subtraction
 * uses `setUTCDate` for the same reason, consistent with every other date
 * computation in this module.
 */
export function computeNextStartDate(
  nextDueDate: Date,
  prevStartDate: Date,
  prevDueDate: Date,
): Date {
  const durationDays = Math.round(
    (prevDueDate.getTime() - prevStartDate.getTime()) / MS_PER_DAY,
  );
  const result = new Date(nextDueDate.getTime());
  result.setUTCDate(result.getUTCDate() - durationDays);
  return result;
}

function computeDaily(anchor: Date, interval: number): Date {
  const result = new Date(anchor.getTime());
  result.setUTCDate(result.getUTCDate() + interval);
  return result;
}

function computeWeekly(
  anchor: Date,
  interval: number,
  daysOfWeek?: number[],
): Date {
  if (!daysOfWeek || daysOfWeek.length === 0) {
    const result = new Date(anchor.getTime());
    result.setUTCDate(result.getUTCDate() + interval * 7);
    return result;
  }

  // Advance interval weeks from the anchor's week start, then find the
  // first matching day of the week that is strictly after the anchor.
  const sorted = [...daysOfWeek].sort((a, b) => a - b);
  const anchorDay = anchor.getUTCDay();

  // First, try to find a matching day later in the same week as the anchor,
  // but only when interval is 1 (meaning "every week").
  // For interval > 1, we always jump forward interval weeks.
  if (interval === 1) {
    for (const day of sorted) {
      if (day > anchorDay) {
        const result = new Date(anchor.getTime());
        result.setUTCDate(result.getUTCDate() + (day - anchorDay));
        if (result.getTime() > anchor.getTime()) {
          return result;
        }
      }
    }
  }

  // Jump to the start of the next interval-week cycle and find the first matching day.
  const daysUntilNextWeekStart = 7 - anchorDay;
  const weeksToSkip = interval === 1 ? 0 : interval - 1;
  const nextWeekStart = new Date(anchor.getTime());
  nextWeekStart.setUTCDate(
    nextWeekStart.getUTCDate() + daysUntilNextWeekStart + weeksToSkip * 7,
  );
  // nextWeekStart is now a Sunday

  const firstMatchDay = sorted[0];
  const result = new Date(nextWeekStart.getTime());
  result.setUTCDate(result.getUTCDate() + firstMatchDay);
  return result;
}

/**
 * Finds the next day on or after `from` whose UTC day-of-week is in `daysOfWeek`.
 */
function findNextMatchingDayOfWeek(from: Date, daysOfWeek: number[]): Date {
  const sorted = [...daysOfWeek].sort((a, b) => a - b);
  const result = new Date(from.getTime());
  for (let i = 0; i < 7; i++) {
    if (sorted.includes(result.getUTCDay())) {
      return result;
    }
    result.setUTCDate(result.getUTCDate() + 1);
  }
  // Should never reach here if daysOfWeek is non-empty
  return result;
}

function computeMonthly(
  anchor: Date,
  interval: number,
  dayOfMonth?: number,
  nthWeekday?: { n: number; day: number },
): Date {
  if (nthWeekday) {
    return computeMonthlyNthWeekday(anchor, interval, nthWeekday);
  }
  if (dayOfMonth !== undefined) {
    return computeMonthlyDayOfMonth(anchor, interval, dayOfMonth);
  }
  // Plain monthly: advance months, keep same day, clamp to end-of-month
  return computeMonthlyDayOfMonth(anchor, interval, anchor.getUTCDate());
}

function computeMonthlyDayOfMonth(
  anchor: Date,
  interval: number,
  targetDay: number,
): Date {
  // Set day to 1 first to avoid overflow when advancing months
  // (e.g., Jan 31 + 1 month would overflow to Mar 3 without this)
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + interval;
  const targetDate = new Date(Date.UTC(year, month, 1));

  // Clamp to end-of-month if targetDay exceeds the month's days
  const targetYear = targetDate.getUTCFullYear();
  const targetMonth = targetDate.getUTCMonth();
  const daysInMonth = getDaysInMonth(targetYear, targetMonth);
  targetDate.setUTCDate(Math.min(targetDay, daysInMonth));

  return targetDate;
}

function computeMonthlyNthWeekday(
  anchor: Date,
  interval: number,
  nthWeekday: { n: number; day: number },
): Date {
  // Use Date.UTC with month arithmetic to avoid day-overflow issues
  const targetMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + interval, 1),
  );

  const year = targetMonth.getUTCFullYear();
  const month = targetMonth.getUTCMonth();

  return findNthWeekdayInMonth(year, month, nthWeekday.n, nthWeekday.day);
}

/**
 * Finds the nth occurrence of a specific weekday in the given month/year.
 * If the nth occurrence doesn't exist (e.g., 5th Monday in a short month),
 * returns the last occurrence of that weekday.
 */
function findNthWeekdayInMonth(
  year: number,
  month: number,
  n: number,
  day: number,
): Date {
  // Find the first occurrence of `day` in this month
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstDow = firstOfMonth.getUTCDay();
  const firstOccurrence = 1 + ((day - firstDow + 7) % 7);

  // Collect all occurrences
  const daysInMonth = getDaysInMonth(year, month);
  const occurrences: number[] = [];
  let d = firstOccurrence;
  while (d <= daysInMonth) {
    occurrences.push(d);
    d += 7;
  }

  // Pick the nth (1-indexed), or the last if n exceeds count
  const index = Math.min(n, occurrences.length) - 1;
  return new Date(Date.UTC(year, month, occurrences[index]));
}

function computeYearly(anchor: Date, interval: number): Date {
  const targetYear = anchor.getUTCFullYear() + interval;
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();

  // Construct from scratch to avoid JS auto-adjusting invalid dates
  // (e.g., Feb 29 in a non-leap year would shift to Mar 1)
  const daysInMonth = getDaysInMonth(targetYear, month);
  return new Date(Date.UTC(targetYear, month, Math.min(day, daysInMonth)));
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function parseISODate(isoDate: string): Date {
  // Parse "YYYY-MM-DD" as UTC
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Formats a RecurrenceRule into a human-readable string.
 *
 * Examples:
 * - "Every day"
 * - "Every 2 days"
 * - "Every week on Mon"
 * - "Every 2 weeks on Mon, Wed, Fri"
 * - "Every month on the 15th"
 * - "Every month on the 2nd Tuesday"
 * - "Every 2 months"
 * - "Every year"
 * - "Every 2 years"
 */
export function formatRecurrenceRule(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case "daily":
      return rule.interval === 1 ? "Every day" : `Every ${rule.interval} days`;

    case "weekly": {
      const base =
        rule.interval === 1 ? "Every week" : `Every ${rule.interval} weeks`;
      if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        const sorted = [...rule.daysOfWeek].sort((a, b) => a - b);
        const dayNames = sorted.map((d) => DAY_NAMES[d]);
        return `${base} on ${dayNames.join(", ")}`;
      }
      return base;
    }

    case "monthly": {
      const base =
        rule.interval === 1 ? "Every month" : `Every ${rule.interval} months`;
      if (rule.nthWeekday) {
        const ordinal = toOrdinal(rule.nthWeekday.n);
        const dayName = DAY_NAMES[rule.nthWeekday.day];
        return `${base} on the ${ordinal} ${dayName}`;
      }
      if (rule.dayOfMonth !== undefined) {
        return `${base} on the ${toOrdinal(rule.dayOfMonth)}`;
      }
      return base;
    }

    case "yearly":
      return rule.interval === 1
        ? "Every year"
        : `Every ${rule.interval} years`;
  }
}

function toOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  const mod10 = n % 10;
  switch (mod10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
