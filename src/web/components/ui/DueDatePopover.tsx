import { Calendar } from "lucide-react";
import { useState } from "react";

import type { Placement } from "@/web/hooks/use-floating";

import { Input } from "../form/Input";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { Text } from "./Text";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface DueDatePopoverProps {
  /** Called when a date is selected or cleared. */
  onSelect: (date: string | null) => void;
  /** Popover placement relative to trigger. */
  placement?: Placement;
  /** The currently set due date (ISO string) — used to show the date in the trigger. */
  currentDate?: string | null;
  /** Custom trigger element. When provided, replaces the default Button trigger. */
  trigger?: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Shared date-picker popover for setting due dates on tasks.
 * Used by BulkActionBar for bulk operations and available for
 * any context that needs a standalone due-date picker.
 */
export function DueDatePopover({
  onSelect,
  placement = "top-start",
  currentDate,
  trigger,
}: DueDatePopoverProps) {
  const [open, setOpen] = useState(false);

  const formattedDate = currentDate
    ? new Date(currentDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen} placement={placement}>
      <Popover.Trigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm">
            <Calendar size={14} />
            <span className="hidden sm:inline ml-1">
              {formattedDate ?? "Due date"}
            </span>
          </Button>
        )}
      </Popover.Trigger>
      <Popover.Content className="bg-surface-0 border border-border-default rounded-lg shadow-xl p-3 flex flex-col gap-2">
        <Text variant="body-3" weight="semibold">
          Set due date
        </Text>
        <Input
          type="date"
          defaultValue={currentDate ? currentDate.slice(0, 10) : undefined}
          onChange={(e) => {
            void onSelect(e.target.value || null);
            setOpen(false);
          }}
          className="text-body-3"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void onSelect(null);
            setOpen(false);
          }}
        >
          Clear due date
        </Button>
      </Popover.Content>
    </Popover>
  );
}
