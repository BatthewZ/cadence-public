/**
 * Client-side project calendar export — maps project tasks to ICS events and
 * triggers a `.ics` download in the browser.
 *
 * ## Why client-side (no export endpoint)
 *
 * The shared generator (`@/shared/lib/ics`) is isomorphic and the project's
 * tasks are already in memory via `useProject()`, so generating in the
 * browser needs zero new API surface, zero extra auth handling, and cannot
 * drift from what the user is looking at. The Worker-side subscription feed
 * remains the only server-rendered ICS.
 *
 * ## Why ALL tasks with dates (not the filtered subset)
 *
 * "Export this project" is a project-level action sitting next to the tabs,
 * not a view-level one — exporting only the currently filtered tasks would
 * silently produce different files depending on invisible filter state.
 * A task with EITHER a due date or a start date is exported (a start-only
 * task lands on its start day); only tasks with no date at all are skipped,
 * because an all-day VEVENT needs a day to sit on.
 *
 * ## Why descriptions ARE included here (unlike the subscription feed)
 *
 * The feed URL is a long-lived, unauthenticated capability that can leak in
 * calendar-app settings, so it omits task descriptions. This export is an
 * explicit, user-initiated local download by an authenticated project member
 * — the user already sees every description on screen, so the file includes
 * them.
 *
 * ## Date handling
 *
 * Task dates arrive as ISO timestamp strings; the calendar day is recovered
 * with `.slice(0, 10)` ONLY — never `new Date(str)` + local accessors, which
 * shifts the day for users west of UTC (this repo's highest-risk bug class).
 * DTEND is exclusive per RFC 5545, so it is the event's inclusive last day + 1
 * day (the due date, or the start date for a start-only task), computed with
 * UTC math. UIDs follow the feed's `task-<id>@cadence` convention so a file
 * exported today and one exported tomorrow refer to the same events.
 */
import { generateICS, type ICSEvent } from "@/shared/lib/ics";

/**
 * Minimal structural slice of the web `Task` shape this module needs —
 * `ProjectContext`'s `Task[]` satisfies it directly.
 */
export interface ExportableTask {
  id: string;
  title: string;
  description?: string | null;
  /** ISO timestamp. May stand alone (start-only task) or anchor a range with `dueDate`. */
  startDate?: string | null;
  /** ISO timestamp. A task with neither date is skipped (no day to place it on). */
  dueDate?: string | null;
  completed: boolean;
}

/**
 * Adds days to a `"YYYY-MM-DD"` string via pure UTC math (no string→Date
 * parsing followed by local getters — see module JSDoc). `setUTCFullYear`
 * rather than `Date.UTC(y, …)` so years 0–99 are never remapped to 19xx.
 */
function addDaysUTC(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Maps tasks to ICS events. A task with neither date is skipped (nothing to
 * place it on). Otherwise the event spans `[anchorStart, anchorEnd]`:
 *
 * - both dates, start < due → multi-day span (start → due);
 * - due only → single all-day event on the due date;
 * - start only → single all-day event on the start date (a task that begins
 *   on a day with no deadline still belongs on the calendar);
 * - start at or after due → clamped to a single-day event on the due date
 *   (mirrors the Worker feed's defensive clamp — DTEND <= DTSTART makes some
 *   clients reject the whole file).
 *
 * `dtstamp` is one shared timestamp for the whole export so a single
 * download is internally consistent (and injectable for deterministic
 * tests).
 */
export function projectTasksToICSEvents(
  tasks: ExportableTask[],
  dtstamp: Date = new Date(),
): ICSEvent[] {
  const events: ICSEvent[] = [];
  for (const task of tasks) {
    const startDay = task.startDate ? task.startDate.slice(0, 10) : null;
    const dueDay = task.dueDate ? task.dueDate.slice(0, 10) : null;
    if (!startDay && !dueDay) continue;

    // The inclusive last day of the event: the due date when present, else the
    // start date (start-only task). The first day: the start date when it
    // precedes that last day, else the last day itself (single-day event).
    const lastDay = dueDay ?? startDay!;
    const firstDay = startDay && startDay < lastDay ? startDay : lastDay;
    events.push({
      uid: `task-${task.id}@cadence`,
      summary: task.title,
      ...(task.description ? { description: task.description } : {}),
      startDate: firstDay,
      // RFC 5545 exclusive DTEND: first day AFTER the event.
      endDateExclusive: addDaysUTC(lastDay, 1),
      dtstamp,
      ...(task.completed ? { status: "COMPLETED" as const } : {}),
    });
  }
  return events;
}

/**
 * Builds a safe download filename from the project name: strips characters
 * that are invalid or hazardous in filenames across platforms, collapses the
 * resulting whitespace, and falls back to `calendar.ics` when nothing
 * printable remains.
 */
export function icsFileName(projectName: string): string {
  // Character-by-character scan instead of a regex literal: the characters
  // to strip include the C0 control range, and control characters inside a
  // regex trip `no-control-regex` (this repo never suppresses lint signals).
  const cleaned = Array.from(projectName)
    .map((ch) => (ch < " " || ch === "\u007f" || '/\\:*?"<>|'.includes(ch) ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleaned === "" ? "calendar" : cleaned}.ics`;
}

/** Generates the full VCALENDAR text for a project export. */
export function buildProjectICS(
  projectName: string,
  tasks: ExportableTask[],
  dtstamp: Date = new Date(),
): string {
  return generateICS({
    calendarName: projectName,
    events: projectTasksToICSEvents(tasks, dtstamp),
  });
}

/**
 * Generates and downloads `<project-name>.ics` via a Blob + object URL +
 * synthetic anchor click (the standard no-endpoint download pattern).
 *
 * Returns the number of exported events; `0` means no download was triggered
 * (every task was date-less) so the caller can tell the user why nothing
 * happened instead of handing them an empty calendar file.
 */
export function downloadProjectICS(
  projectName: string,
  tasks: ExportableTask[],
): number {
  const events = projectTasksToICSEvents(tasks);
  if (events.length === 0) return 0;

  const ics = generateICS({ calendarName: projectName, events });
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = icsFileName(projectName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return events.length;
}
