import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { Row, Stack } from "@/web/components/layout";
import { Button, Spinner, Text } from "@/web/components/ui";
import { IconButton } from "@/web/components/ui/IconButton";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { useProject } from "@/web/contexts/ProjectContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useTaskFilters } from "@/web/hooks/use-task-filters";
import { addMonths } from "@/web/util/date";

import { CalendarGrid } from "./components/CalendarGrid";
import type { CalendarTask } from "./lib/month-grid";
import { buildMonthGrid, placeTasks } from "./lib/month-grid";

/* ------------------------------------------------------------------ */
/*  Month URL param (?month=YYYY-MM)                                    */
/* ------------------------------------------------------------------ */

const MONTH_PARAM_RE = /^(\d{4})-(\d{2})$/;

interface MonthParts {
  year: number;
  /** 0-based month (January = 0), matching `Date`/`buildMonthGrid`. */
  monthIndex: number;
}

/**
 * Parse the user-editable `?month=YYYY-MM` param. The URL is a trust
 * boundary (hand-typed, shared, bookmarked), so malformed or impossible
 * values (`month=banana`, `2026-13`) degrade to "current month" rather than
 * feeding garbage into `buildMonthGrid` — same philosophy as
 * `parseDateParam` in `use-task-filters`.
 */
function parseMonthParam(raw: string | null): MonthParts | null {
  if (!raw) return null;
  const match = MONTH_PARAM_RE.exec(raw);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), monthIndex: month - 1 };
}

/** The user's local current month — what an absent `month` param means. */
function currentMonthParts(): MonthParts {
  const now = new Date();
  return { year: now.getFullYear(), monthIndex: now.getMonth() };
}

function formatMonthParam(parts: MonthParts): string {
  return `${parts.year}-${String(parts.monthIndex + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  ProjectCalendar page                                               */
/* ------------------------------------------------------------------ */

/**
 * Month-calendar view of a project's dated tasks. Tasks with both a start
 * and due date render as multi-day span bars; single-dated tasks render as
 * chips on their day. Filters from the shared `TaskFilterBar` apply exactly
 * as on Board/List/Timeline because this view consumes the same
 * `useTaskFilters(tasks)` URL-backed hook.
 *
 * URL contract (every write below is ONE functional `setSearchParams` call
 * touching only its own key — sequential calls or the object form would
 * clobber concurrently-held params like filters, `view`, and `task`):
 * - `?month=YYYY-MM` selects the visible month; absent = current month
 *   ("Today" deletes the key rather than writing the current month, so a
 *   bookmarked default URL keeps following the real today).
 * - `?task=<id>` opens the task detail panel, identical to the timeline.
 */
export default function ProjectCalendar() {
  const { project, tasks, taskGroups, tasksError, refetchTasks } = useProject();
  // ProjectContext's type says `project: Project`, but the underlying fetch
  // can transiently produce a null project (same guard as ProjectTimeline).
  useDocumentTitle(project ? `${project.name} — Calendar` : "Calendar");
  const { filteredTasks } = useTaskFilters(tasks);
  const [searchParams, setSearchParams] = useSearchParams();

  const month =
    parseMonthParam(searchParams.get("month")) ?? currentMonthParts();

  /**
   * Step the visible month by `delta`. The anchor month is re-read from the
   * updater's own `prev` params — not from the render-time `month` value —
   * because react-router's functional updaters close over render-time state;
   * reading inside the updater keeps rapid prev/next clicks from stepping
   * off a stale anchor.
   */
  const handleMonthStep = useCallback(
    (delta: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const anchor =
            parseMonthParam(next.get("month")) ?? currentMonthParts();
          // Anchored on day 1, so addMonths' day-clamping never engages and
          // repeated stepping lands on every month exactly once.
          const moved = addMonths(
            new Date(anchor.year, anchor.monthIndex, 1),
            delta,
          );
          next.set(
            "month",
            formatMonthParam({
              year: moved.getFullYear(),
              monthIndex: moved.getMonth(),
            }),
          );
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** "Today" deletes `month` (absent param = current month) — see URL contract. */
  const handleToday = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("month");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /**
   * Open the task detail panel exactly as TimelineTaskRow does: set only the
   * `task` key, preserving month/filters/view, with a real history entry so
   * Back closes the panel.
   */
  const handleTaskClick = useCallback(
    (task: CalendarTask) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("task", task.id);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const weeks = useMemo(
    () => buildMonthGrid(month.year, month.monthIndex),
    [month.year, month.monthIndex],
  );

  // `Task` structurally satisfies `CalendarTask`, and `placeTasks` returns
  // the same object references, so no adapter layer is needed (single source
  // of truth — clicking a segment hands back the full task).
  const layouts = useMemo(
    () => placeTasks(weeks, filteredTasks),
    [weeks, filteredTasks],
  );

  // Tint span bars with their task group's color so the calendar speaks the
  // same color language as the board columns.
  const colorByTaskId = useMemo(() => {
    const colorByGroupId = new Map(
      taskGroups.map((group) => [group.id, group.color]),
    );
    const map = new Map<string, string>();
    for (const task of filteredTasks) {
      const color = colorByGroupId.get(task.taskGroupId);
      if (color) map.set(task.id, color);
    }
    return map;
  }, [taskGroups, filteredTasks]);

  if (!project) {
    return (
      <Row justify="center" className="py-r1">
        <Spinner />
      </Row>
    );
  }

  if (tasksError) {
    return (
      <QueryErrorRetry
        message="Failed to load calendar data."
        onRetry={refetchTasks}
      />
    );
  }

  const monthLabel = new Date(
    month.year,
    month.monthIndex,
    1,
  ).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <Stack gap="r3">
      <Row justify="between" align="center">
        <Text variant="h4">Calendar</Text>
        <Row gap="r5" align="center">
          <Button variant="ghost" size="sm" onClick={handleToday}>
            Today
          </Button>
          <IconButton
            aria-label="Previous month"
            onClick={() => handleMonthStep(-1)}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <Text variant="h5" className="min-w-[9rem] text-center">
            {monthLabel}
          </Text>
          <IconButton
            aria-label="Next month"
            onClick={() => handleMonthStep(1)}
          >
            <ChevronRight size={16} />
          </IconButton>
        </Row>
      </Row>

      <CalendarGrid
        weeks={weeks}
        layouts={layouts}
        colorByTaskId={colorByTaskId}
        onTaskClick={handleTaskClick}
      />
    </Stack>
  );
}
