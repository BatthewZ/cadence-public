import { PRIORITY_DOT_CLASS } from "@/web/util/task-display";

import type { CalendarTask } from "../lib/month-grid";

/**
 * Single-day task chip rendered inside a calendar day cell (and reused by the
 * day-overflow popover so both surfaces present tasks identically).
 *
 * The priority dot reuses `PRIORITY_DOT_CLASS` — the same mapping the board
 * and timeline use — so priority color semantics cannot drift between views.
 * `none`/empty mappings fall back to a muted `bg-surface-3` dot to keep title
 * alignment consistent across chips.
 *
 * Completed tasks render struck-through and muted rather than being hidden:
 * the calendar answers "what happened/happens on this day", so completed work
 * remains visible unless the user filters it out via the Status filter.
 */
export function CalendarTaskChip({
  task,
  onClick,
}: {
  task: CalendarTask;
  onClick: (task: CalendarTask) => void;
}) {
  const dotClass = PRIORITY_DOT_CLASS[task.priority] || "bg-surface-3";

  return (
    <button
      type="button"
      onClick={() => onClick(task)}
      title={task.title}
      className="flex w-full min-w-0 cursor-pointer items-center gap-r6 rounded px-r6 py-0.5 text-left text-body-3 duration-fast hover:bg-surface-2"
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${dotClass}`}
        aria-hidden="true"
      />
      <span
        className={`truncate ${
          task.completed ? "line-through text-fg-muted" : "text-fg-primary"
        }`}
      >
        {task.title}
      </span>
    </button>
  );
}
