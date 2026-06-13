import { cn } from "@/web/util/style/style";

import type { CalendarTask, Week, WeekLayout } from "../lib/month-grid";
import { MAX_LANES } from "../lib/month-grid";
import { CalendarDayCell } from "./CalendarDayCell";

/**
 * Monday-first to match `buildMonthGrid` (and `endOfWeek` in
 * `src/web/util/date.ts`, which treats Sunday as the week END) — a mismatch
 * here would put every task in the wrong visual column.
 */
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Subgrid rows per week: date number, MAX_LANES span lanes, then a flexible
 * chips row. Unused lane rows collapse to zero height (`minmax(0, auto)`), so
 * quiet weeks stay compact while busy weeks grow without overlap. The final
 * `1fr` lets the chips row absorb the `min-h-28` slack so short weeks keep
 * uniform cell heights.
 */
const WEEK_TEMPLATE_ROWS = `auto repeat(${MAX_LANES}, minmax(0, auto)) minmax(0, 1fr)`;

/**
 * Pure presentation of the month grid: weekday header + one 7-column subgrid
 * per week. Multi-day tasks render as span bars placed by `gridColumn`/lane
 * row straight from `placeTasks`' segments; single-day tasks render as chips
 * inside `CalendarDayCell`. An empty month still renders the full grid — a
 * calendar's empty state IS the calendar.
 */
export function CalendarGrid({
  weeks,
  layouts,
  colorByTaskId,
  onTaskClick,
}: {
  weeks: Week[];
  /** Parallel to `weeks` — output of `placeTasks(weeks, tasks)`. */
  layouts: WeekLayout[];
  /**
   * Task id → task-group hex color, used to tint span bars at low alpha so
   * bars inherit the same group color language as the board. Tasks without a
   * group color fall back to `bg-surface-3`.
   */
  colorByTaskId: ReadonlyMap<string, string>;
  onTaskClick: (task: CalendarTask) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-default">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border-default bg-surface-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-r6 text-center text-body-3 text-fg-muted"
          >
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week, w) => {
        const layout = layouts[w];
        const isLastWeek = w === weeks.length - 1;

        return (
          <div
            key={week[0].iso}
            className="grid min-h-28 grid-cols-7"
            style={{ gridTemplateRows: WEEK_TEMPLATE_ROWS }}
          >
            {week.map((day, i) => {
              const col = i + 1;
              const chips = layout.chipsByIso[day.iso] ?? [];
              // Everything touching this day for the overflow popover:
              // span bars covering the column (in lane order) + the chips.
              // A task is never both a bar and a chip in the same week
              // (demotion is either/or), so no dedupe is needed.
              const spanTasks = layout.segments
                .filter((s) => s.colStart <= col && col <= s.colEnd)
                .map((s) => s.task);
              return (
                <CalendarDayCell
                  key={day.iso}
                  day={day}
                  col={col}
                  isLastWeek={isLastWeek}
                  chips={chips}
                  dayTasks={[...spanTasks, ...chips]}
                  onTaskClick={onTaskClick}
                />
              );
            })}

            {/* Span bars: painted after the day cells so they layer above the
                cell backgrounds purely by DOM order. Clipped edges square off
                (and lose their margin) to signal the task continues into the
                neighboring week row. */}
            {layout.segments.map((seg) => {
              const color = colorByTaskId.get(seg.task.id);
              return (
                <button
                  key={`${seg.task.id}:${seg.colStart}`}
                  type="button"
                  onClick={() => onTaskClick(seg.task)}
                  title={seg.task.title}
                  className={cn(
                    "mb-px flex min-w-0 cursor-pointer items-center px-r6 py-0.5 text-left text-body-3 duration-fast hover:opacity-80",
                    seg.clippedLeft ? "rounded-l-none" : "ml-0.5 rounded-l",
                    seg.clippedRight ? "rounded-r-none" : "mr-0.5 rounded-r",
                    !color && "bg-surface-3",
                    seg.task.completed
                      ? "line-through text-fg-muted"
                      : "text-fg-primary",
                  )}
                  style={{
                    gridColumn: `${seg.colStart} / ${seg.colEnd + 1}`,
                    gridRow: seg.lane + 2,
                    // Group hex + "33" = ~20% alpha tint; readable with
                    // standard fg text in both themes. Data-driven color, so
                    // an inline style (not a token) is correct here — same
                    // approach as the timeline's group color dots.
                    backgroundColor: color ? `${color}33` : undefined,
                  }}
                >
                  <span className="truncate">{seg.task.title}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
