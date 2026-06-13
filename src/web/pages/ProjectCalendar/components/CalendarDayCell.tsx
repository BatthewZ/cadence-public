import { cn } from "@/web/util/style/style";

import type { CalendarTask, GridDay } from "../lib/month-grid";
import { MAX_LANES } from "../lib/month-grid";
import { CalendarTaskChip } from "./CalendarTaskChip";
import { DayOverflowPopover } from "./DayOverflowPopover";

/**
 * Maximum chips rendered inline in a day cell before collapsing into the
 * "+N more" popover. Two chips + three span lanes + the date number fit the
 * `min-h-28` cell without pushing row heights around; `placeTasks` sorts
 * chips urgent-first, so truncation always keeps the most important work
 * visible.
 */
export const CHIP_BUDGET = 2;

/**
 * One day of the month grid. Rendered as THREE sibling grid items inside the
 * week row's shared 7-column subgrid (background, date number, chips) rather
 * than a single wrapper, because multi-day span bars must occupy the rows
 * BETWEEN the date number and the chips — a single-element cell could not
 * interleave with spans that way. The background paints first in DOM order so
 * spans/chips layer above it without z-index management.
 */
export function CalendarDayCell({
  day,
  col,
  isLastWeek,
  chips,
  dayTasks,
  onTaskClick,
}: {
  day: GridDay;
  /** 1-based grid column (1 = Monday … 7 = Sunday). */
  col: number;
  /** Suppresses the bottom border so the grid's outer frame stays 1px. */
  isLastWeek: boolean;
  /** Per-day chips from `placeTasks` (priority-sorted; may exceed budget). */
  chips: CalendarTask[];
  /** Every task touching this day (spans + chips) for the overflow popover. */
  dayTasks: CalendarTask[];
  onTaskClick: (task: CalendarTask) => void;
}) {
  // Day-of-month from the ISO string itself — no Date parsing, no UTC risk.
  const dayNumber = Number(day.iso.slice(8, 10));
  const visibleChips =
    chips.length > CHIP_BUDGET ? chips.slice(0, CHIP_BUDGET) : chips;
  const hiddenCount = chips.length - visibleChips.length;

  return (
    <>
      {/* Background layer: borders + in/out-of-month surface, spanning every
          subgrid row so spans and chips render on top of it. */}
      <div
        className={cn(
          "border-border-default",
          col < 7 && "border-r",
          !isLastWeek && "border-b",
          day.inMonth ? "bg-surface-0" : "bg-surface-1",
        )}
        style={{ gridColumn: col, gridRow: "1 / -1" }}
      />

      {/* Date number row. `aria-current="date"` marks today's accent circle
          semantically (and is what tests target) instead of a decorative-only
          style. */}
      <div
        className="flex justify-end px-r6 pt-r6 pb-r6"
        style={{ gridColumn: col, gridRow: 1 }}
      >
        {day.isToday ? (
          <span
            aria-current="date"
            className="inline-flex size-6 items-center justify-center rounded-full bg-accent text-body-3 font-medium text-fg-on-accent"
          >
            {dayNumber}
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex size-6 items-center justify-center text-body-3",
              day.inMonth ? "text-fg-secondary" : "text-fg-muted",
            )}
          >
            {dayNumber}
          </span>
        )}
      </div>

      {/* Chips row, below the span lanes. `data-date` is the test hook for
          asserting a task landed on the correct LOCAL calendar day — the
          single most likely bug class for calendars west of UTC. */}
      <div
        data-date={day.iso}
        className="flex min-w-0 flex-col gap-px px-0.5 pb-0.5"
        style={{ gridColumn: col, gridRow: MAX_LANES + 2 }}
      >
        {visibleChips.map((task) => (
          <CalendarTaskChip key={task.id} task={task} onClick={onTaskClick} />
        ))}
        {hiddenCount > 0 && (
          <DayOverflowPopover
            iso={day.iso}
            hiddenCount={hiddenCount}
            tasks={dayTasks}
            onTaskClick={onTaskClick}
          />
        )}
      </div>
    </>
  );
}
