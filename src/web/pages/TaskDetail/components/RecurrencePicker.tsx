import { Repeat, X } from "lucide-react";
import { useCallback, useState } from "react";

import { formatRecurrenceRule } from "@/shared/lib/recurrence";
import type { RecurrenceRule } from "@/shared/types/recurrence";
import { RECURRENCE_FREQUENCIES } from "@/shared/types/recurrence";
import { Input } from "@/web/components/form/Input";
import { Button } from "@/web/components/ui/Button";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DAY_NAMES_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const ORDINAL_LABELS = ["1st", "2nd", "3rd", "4th", "5th"] as const;

const FREQUENCY_LABELS: Record<RecurrenceRule["frequency"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const FREQUENCY_UNIT_SINGULAR: Record<RecurrenceRule["frequency"], string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

const FREQUENCY_UNIT_PLURAL: Record<RecurrenceRule["frequency"], string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};

type MonthlyMode = "dayOfMonth" | "nthWeekday";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getFrequencyUnit(frequency: RecurrenceRule["frequency"], interval: number): string {
  return interval === 1
    ? FREQUENCY_UNIT_SINGULAR[frequency]
    : FREQUENCY_UNIT_PLURAL[frequency];
}

function clampInterval(value: number): number {
  return Math.max(1, Math.min(365, Math.round(value) || 1));
}

function clampDayOfMonth(value: number): number {
  return Math.max(1, Math.min(31, Math.round(value) || 1));
}

/** Build the default rule when switching frequencies */
function buildDefaultRule(frequency: RecurrenceRule["frequency"]): RecurrenceRule {
  return { frequency, interval: 1 };
}

/* ------------------------------------------------------------------ */
/*  RecurrencePicker (interactive)                                     */
/* ------------------------------------------------------------------ */

export function RecurrencePicker({
  value,
  onSelect,
}: {
  value: RecurrenceRule | null;
  onSelect: (rule: RecurrenceRule | null) => void;
}) {
  const [open, setOpen] = useState(false);

  /** Determine what monthly sub-mode the current rule uses */
  const monthlyMode: MonthlyMode =
    value?.frequency === "monthly" && value.nthWeekday ? "nthWeekday" : "dayOfMonth";

  /* ---- Callbacks for auto-apply on each change ---- */

  const updateRule = useCallback(
    (patch: Partial<RecurrenceRule>) => {
      const base: RecurrenceRule = value ?? { frequency: "daily", interval: 1 };
      onSelect({ ...base, ...patch });
    },
    [value, onSelect],
  );

  const handleFrequencyChange = useCallback(
    (frequency: RecurrenceRule["frequency"]) => {
      onSelect(buildDefaultRule(frequency));
    },
    [onSelect],
  );

  const handleIntervalChange = useCallback(
    (raw: string) => {
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed)) return;
      updateRule({ interval: clampInterval(parsed) });
    },
    [updateRule],
  );

  const handleDayOfWeekToggle = useCallback(
    (day: number) => {
      const current = value?.daysOfWeek ?? [];
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b);
      updateRule({ daysOfWeek: next.length > 0 ? next : undefined });
    },
    [value, updateRule],
  );

  const handleMonthlyModeChange = useCallback(
    (mode: MonthlyMode) => {
      if (mode === "dayOfMonth") {
        updateRule({ dayOfMonth: value?.dayOfMonth ?? 1, nthWeekday: undefined });
      } else {
        updateRule({
          dayOfMonth: undefined,
          nthWeekday: value?.nthWeekday ?? { n: 1, day: 1 },
        });
      }
    },
    [value, updateRule],
  );

  const handleDayOfMonthChange = useCallback(
    (raw: string) => {
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed)) return;
      updateRule({ dayOfMonth: clampDayOfMonth(parsed) });
    },
    [updateRule],
  );

  const handleNthChange = useCallback(
    (raw: string) => {
      const n = parseInt(raw, 10);
      if (Number.isNaN(n)) return;
      updateRule({ nthWeekday: { n, day: value?.nthWeekday?.day ?? 1 } });
    },
    [value, updateRule],
  );

  const handleNthDayChange = useCallback(
    (raw: string) => {
      const day = parseInt(raw, 10);
      if (Number.isNaN(day)) return;
      updateRule({ nthWeekday: { n: value?.nthWeekday?.n ?? 1, day } });
    },
    [value, updateRule],
  );

  const handleEndDateChange = useCallback(
    (raw: string) => {
      updateRule({ endDate: raw || undefined });
    },
    [updateRule],
  );

  const handleRemove = useCallback(() => {
    onSelect(null);
    setOpen(false);
  }, [onSelect]);

  /* ---- Derived state for rendering ---- */
  const rule = value;
  const frequency = rule?.frequency ?? "daily";
  const interval = rule?.interval ?? 1;

  return (
    <Popover placement="bottom-start" portal={false} open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="task-property-picker__trigger">
          <Repeat size={14} className="shrink-0 text-fg-muted" />
          <span className="task-property-picker__label">
            {rule ? formatRecurrenceRule(rule) : "None"}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Content className="task-property-picker__popover" style={{ width: 280 }}>
        <Text variant="body-3" weight="semibold" className="mb-2">
          Recurrence
        </Text>

        {/* ── 1. Frequency selector ── */}
        <div className="flex gap-1 mb-3">
          {RECURRENCE_FREQUENCIES.map((freq) => (
            <button
              key={freq}
              type="button"
              className={cn(
                "flex-1 px-1 py-1 rounded-md text-body-3 font-medium cursor-pointer",
                "border border-transparent transition-colors duration-fast",
                frequency === freq
                  ? "bg-accent-subtle text-accent border-accent/30"
                  : "bg-surface-1 text-fg-secondary hover:bg-surface-2",
              )}
              onClick={() => handleFrequencyChange(freq)}
            >
              {FREQUENCY_LABELS[freq]}
            </button>
          ))}
        </div>

        {/* ── 2. Interval input ── */}
        <div className="flex items-center gap-2 mb-3">
          <Text variant="body-3" color="secondary" className="shrink-0">
            Every
          </Text>
          <Input
            type="number"
            min={1}
            max={365}
            value={interval}
            onChange={(e) => handleIntervalChange(e.target.value)}
            className="w-16 text-center !py-1 !px-2 text-body-3"
          />
          <Text variant="body-3" color="secondary" className="shrink-0">
            {getFrequencyUnit(frequency, interval)}
          </Text>
        </div>

        {/* ── 3. Day-of-week checkboxes (weekly only) ── */}
        {frequency === "weekly" && (
          <div className="mb-3">
            <Text variant="body-3" color="muted" className="mb-1">
              On days
            </Text>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, idx) => {
                const isSelected = rule?.daysOfWeek?.includes(idx) ?? false;
                return (
                  <button
                    key={idx}
                    type="button"
                    title={DAY_NAMES_FULL[idx]}
                    className={cn(
                      "w-8 h-8 rounded-md text-body-3 font-medium cursor-pointer",
                      "border border-transparent transition-colors duration-fast",
                      isSelected
                        ? "bg-accent-subtle text-accent border-accent/30"
                        : "bg-surface-1 text-fg-secondary hover:bg-surface-2",
                    )}
                    onClick={() => handleDayOfWeekToggle(idx)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 4. Monthly: day-of-month or nth-weekday ── */}
        {frequency === "monthly" && (
          <div className="mb-3">
            {/* Mode toggle */}
            <div className="flex gap-1 mb-2">
              <button
                type="button"
                className={cn(
                  "flex-1 px-2 py-1 rounded-md text-body-3 cursor-pointer",
                  "border border-transparent transition-colors duration-fast",
                  monthlyMode === "dayOfMonth"
                    ? "bg-accent-subtle text-accent border-accent/30"
                    : "bg-surface-1 text-fg-secondary hover:bg-surface-2",
                )}
                onClick={() => handleMonthlyModeChange("dayOfMonth")}
              >
                Day of month
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 px-2 py-1 rounded-md text-body-3 cursor-pointer",
                  "border border-transparent transition-colors duration-fast",
                  monthlyMode === "nthWeekday"
                    ? "bg-accent-subtle text-accent border-accent/30"
                    : "bg-surface-1 text-fg-secondary hover:bg-surface-2",
                )}
                onClick={() => handleMonthlyModeChange("nthWeekday")}
              >
                Nth weekday
              </button>
            </div>

            {monthlyMode === "dayOfMonth" ? (
              <div className="flex items-center gap-2">
                <Text variant="body-3" color="secondary" className="shrink-0">
                  On day
                </Text>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={rule?.dayOfMonth ?? 1}
                  onChange={(e) => handleDayOfMonthChange(e.target.value)}
                  className="w-16 text-center !py-1 !px-2 text-body-3"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Text variant="body-3" color="secondary" className="shrink-0">
                  The
                </Text>
                <select
                  value={rule?.nthWeekday?.n ?? 1}
                  onChange={(e) => handleNthChange(e.target.value)}
                  className={cn(
                    "px-2 py-1 rounded-md text-body-3",
                    "bg-surface-0 border border-border-strong text-fg-primary",
                    "focus:outline-none focus:ring-2 focus:ring-border-focus",
                    "cursor-pointer",
                  )}
                >
                  {ORDINAL_LABELS.map((label, idx) => (
                    <option key={idx} value={idx + 1}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={rule?.nthWeekday?.day ?? 1}
                  onChange={(e) => handleNthDayChange(e.target.value)}
                  className={cn(
                    "px-2 py-1 rounded-md text-body-3",
                    "bg-surface-0 border border-border-strong text-fg-primary",
                    "focus:outline-none focus:ring-2 focus:ring-border-focus",
                    "cursor-pointer",
                  )}
                >
                  {DAY_NAMES_FULL.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* ── 5. Optional end date ── */}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <Text variant="body-3" color="secondary" className="shrink-0">
              Ends on
            </Text>
            <div className="flex items-center gap-1 flex-1">
              <Input
                type="date"
                value={rule?.endDate ?? ""}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="w-full !py-1 !px-2 text-body-3"
              />
              {rule?.endDate && (
                <button
                  type="button"
                  className={cn(
                    "shrink-0 p-0.5 rounded text-fg-muted hover:text-fg-primary hover:bg-surface-2",
                    "transition-colors duration-fast cursor-pointer",
                  )}
                  onClick={() => handleEndDateChange("")}
                  title="Clear end date"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── 6. Remove recurrence button ── */}
        {value !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-status-error hover:text-status-error"
            onClick={handleRemove}
          >
            Remove recurrence
          </Button>
        )}
      </Popover.Content>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/*  RecurrencePickerReadOnly                                           */
/* ------------------------------------------------------------------ */

export function RecurrencePickerReadOnly({ value }: { value: RecurrenceRule | null }) {
  return (
    <div className="task-property-picker__trigger" style={{ cursor: "default" }}>
      <Repeat size={14} className="shrink-0 text-fg-muted" />
      <span className="task-property-picker__label">
        {value ? formatRecurrenceRule(value) : "None"}
      </span>
    </div>
  );
}
