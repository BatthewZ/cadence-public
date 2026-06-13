import { useState } from "react";

import { Stack } from "@/web/components/layout";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";

import type { CalendarTask } from "../lib/month-grid";
import { CalendarTaskChip } from "./CalendarTaskChip";

/**
 * Format a `YYYY-MM-DD` cell date for the popover heading.
 *
 * Parsed from parts via the local `new Date(y, m, d)` constructor — NEVER
 * `new Date("YYYY-MM-DD")`, which parses as UTC midnight and renders the
 * previous calendar day for users west of UTC (the repo's top date-bug class).
 */
function formatDayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * "+N more" disclosure for a calendar day cell whose chips exceed the per-cell
 * budget. The trigger reports only the HIDDEN chip count (so the math
 * "visible chips + N = all chips" stays truthful), while the popover lists
 * EVERY task touching the day — spans included — giving one complete answer
 * to "what's on this day" without the user cross-referencing bars and chips.
 *
 * Controlled open state lets a row click close the popover before opening the
 * task detail panel; otherwise the popover would linger over the panel.
 */
export function DayOverflowPopover({
  iso,
  hiddenCount,
  tasks,
  onTaskClick,
}: {
  iso: string;
  hiddenCount: number;
  tasks: CalendarTask[];
  onTaskClick: (task: CalendarTask) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-start">
      <Popover.Trigger className="w-full cursor-pointer rounded px-r6 py-0.5 text-left text-body-3 text-fg-muted duration-fast hover:bg-surface-2 hover:text-fg-primary">
        +{hiddenCount} more
      </Popover.Trigger>
      <Popover.Content className="w-64 !p-r5">
        <Stack gap="r6">
          <Text variant="body-3" color="muted" className="px-r6 font-medium">
            {formatDayLabel(iso)}
          </Text>
          {tasks.map((task) => (
            <CalendarTaskChip
              key={task.id}
              task={task}
              onClick={(t) => {
                setOpen(false);
                onTaskClick(t);
              }}
            />
          ))}
        </Stack>
      </Popover.Content>
    </Popover>
  );
}
