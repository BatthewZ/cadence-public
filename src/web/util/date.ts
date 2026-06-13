/**
 * Normalize a Date to midnight (start of day) in local timezone.
 */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Format a due date string for display relative to today.
 * Returns human-readable labels like "Today", "Tomorrow", "2d overdue",
 * or a formatted date string for further-out dates.
 */
export function formatDueDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7)
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Check if a due date is in the past (overdue).
 */
export function isOverdue(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const today = startOfDay(new Date());
  return date < today;
}

/**
 * Check if a due date is today.
 */
export function isDueToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const today = startOfDay(new Date());
  return startOfDay(date).getTime() === today.getTime();
}

/**
 * Return the end of the current week (Sunday 23:59:59.999).
 */
export function endOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  result.setHours(23, 59, 59, 999);
  return result;
}

function startOfNextWeek(d: Date): Date {
  const end = endOfWeek(d);
  return new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1,
  );
}

/**
 * Return the end of the week following the current one (Sunday 23:59:59.999).
 */
export function endOfNextWeek(d: Date): Date {
  const start = startOfNextWeek(d);
  const result = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 6,
  );
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Return the end of the current calendar month (last day 23:59:59.999).
 */
export function endOfMonth(d: Date): Date {
  const result = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Return the first day of the month containing `d` at local midnight.
 *
 * Built from local getters + the local `new Date(y, m, d)` constructor —
 * never ISO-string parsing or toISOString round-trips — because
 * `new Date("YYYY-MM-DD")` parses as UTC and shifts the calendar date for
 * users away from UTC, which is this codebase's most common date-bug class.
 * Calendar month navigation anchors on this value.
 */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Add `n` calendar months to a date (`n` may be negative), clamping the
 * day-of-month to the target month's length: Jan 31 + 1 month yields
 * Feb 28 (or Feb 29 in leap years) rather than overflowing into March.
 * Naive `setMonth` overflows, which makes month navigation anchored on a
 * 29th–31st skip February entirely — the clamp is what keeps repeated
 * prev/next month stepping landing on every month exactly once.
 * Time-of-day is preserved; all math is local-time.
 */
export function addMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const result = new Date(d.getTime());
  result.setDate(1); // avoid day-of-month overflow while the month changes
  result.setMonth(result.getMonth() + n);
  const daysInTarget = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(day, daysInTarget));
  return result;
}
