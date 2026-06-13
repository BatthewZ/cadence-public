import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/web/contexts/ProjectContext";

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that depend on them
// ---------------------------------------------------------------------------
//
// Only ProjectContext is mocked. `useTaskFilters` runs for REAL against the
// MemoryRouter URL, so the filter tests exercise the actual URL→filter→render
// pipeline (the calendar's claim that "filters work exactly as on other tabs"
// is tested, not assumed).

const mockUseProject = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: (): unknown => mockUseProject(),
}));

// ---------------------------------------------------------------------------
// Polyfills for jsdom (floating-ui's Popover needs ResizeObserver)
// ---------------------------------------------------------------------------

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// ---------------------------------------------------------------------------
// Dynamic import so mocks are established first
// ---------------------------------------------------------------------------

const { default: ProjectCalendar } = await import("./ProjectCalendar");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    taskGroupId: "tg-1",
    priority: "none",
    completed: false,
    position: "000001",
    ...overrides,
  };
}

function setupProjectMock(tasks: Task[], extra: Record<string, unknown> = {}) {
  mockUseProject.mockReturnValue({
    project: { id: "proj-1", name: "Test Project", workspaceId: "ws-1" },
    members: [],
    taskGroups: [
      { id: "tg-1", name: "To Do", color: "#3b82f6", isCompletionGroup: false, position: "a" },
      { id: "tg-2", name: "Done", isCompletionGroup: true, position: "b" },
    ],
    tasks,
    tasksError: null,
    refetchTasks: vi.fn(),
    refetch: vi.fn(),
    updateProject: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    addTask: vi.fn(),
    ...extra,
  });
}

/**
 * FB9-style URL probe: renders the live location.search so tests can assert
 * that URL writes set their own key AND preserve everything else — the bug
 * class (sequential/object-form setSearchParams clobbering filter state) that
 * the page's one-write-per-action contract exists to prevent.
 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function getSearchParams(): URLSearchParams {
  const search = screen.getByTestId("location-search").textContent ?? "";
  return new URLSearchParams(search);
}

function renderCalendar(initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ProjectCalendar />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The chips container for a day cell, addressed by local `YYYY-MM-DD`. */
function getDayCell(iso: string): HTMLElement {
  const cell = document.querySelector(`[data-date="${iso}"]`);
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// All date-pinned tests use March 2026 via ?month=2026-03 so the grid is
// deterministic regardless of when (or where) the suite runs:
// Mar 1, 2026 is a Sunday → 6 Monday-start weeks, Feb 23 – Apr 5.
const MARCH = "/?month=2026-03";

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectCalendar", () => {
  // -----------------------------------------------------------------------
  // 1. Grid rendering
  // -----------------------------------------------------------------------
  describe("month grid", () => {
    it("renders the month label and Monday-first weekday header", () => {
      setupProjectMock([]);
      renderCalendar([MARCH]);

      expect(screen.getByText("March 2026")).toBeInTheDocument();
      for (const label of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    });

    it("renders the full grid for an empty month (the grid IS the empty state)", () => {
      setupProjectMock([]);
      renderCalendar([MARCH]);

      // 6 Monday-start weeks × 7 days, including out-of-month padding cells.
      expect(document.querySelectorAll("[data-date]").length).toBe(42);
      expect(getDayCell("2026-02-23")).toBeInTheDocument();
      expect(getDayCell("2026-04-05")).toBeInTheDocument();
      expect(screen.queryByText("No tasks")).not.toBeInTheDocument();
    });

    it("marks today's date with aria-current in the default (current) month", () => {
      setupProjectMock([]);
      renderCalendar(["/"]);

      const today = new Date();
      const todayEl = document.querySelector('[aria-current="date"]');
      expect(todayEl).not.toBeNull();
      expect(todayEl!.textContent).toBe(String(today.getDate()));
      // Default month is the user's local current month.
      expect(
        screen.getByText(
          today.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        ),
      ).toBeInTheDocument();
    });

    it("falls back to the current month for a malformed ?month param", () => {
      setupProjectMock([]);
      renderCalendar(["/?month=banana"]);

      const now = new Date();
      expect(
        screen.getByText(
          now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        ),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Chip placement (incl. the UTC off-by-one bug class)
  // -----------------------------------------------------------------------
  describe("chip placement", () => {
    it("renders a due-only task as a chip on its due day", () => {
      setupProjectMock([
        makeTask({ id: "t-1", title: "Chip task", dueDate: "2026-03-10" }),
      ]);
      renderCalendar([MARCH]);

      expect(within(getDayCell("2026-03-10")).getByText("Chip task")).toBeInTheDocument();
    });

    it("places a near-midnight UTC timestamp on its ISO calendar day in every timezone", () => {
      // 23:30 UTC straddles midnight for any zone east of UTC+0:30 — naive
      // `new Date(str)` placement would shift this task a day in those zones.
      // The contract is `.slice(0, 10)`: the chip belongs to the 9th, always.
      setupProjectMock([
        makeTask({ id: "t-1", title: "Straddle task", dueDate: "2026-03-09T23:30:00.000Z" }),
      ]);
      renderCalendar([MARCH]);

      expect(within(getDayCell("2026-03-09")).getByText("Straddle task")).toBeInTheDocument();
      expect(within(getDayCell("2026-03-10")).queryByText("Straddle task")).not.toBeInTheDocument();
    });

    it("renders completed tasks struck through instead of hiding them", () => {
      setupProjectMock([
        makeTask({ id: "t-1", title: "Done task", dueDate: "2026-03-20", completed: true }),
      ]);
      renderCalendar([MARCH]);

      const title = screen.getByText("Done task");
      expect(title.className).toContain("line-through");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Multi-day spans
  // -----------------------------------------------------------------------
  describe("span rendering", () => {
    it("renders a start+due task as one bar spanning its grid columns", () => {
      // Mar 9 2026 is a Monday, Mar 12 a Thursday → columns 1–4 of week 3.
      setupProjectMock([
        makeTask({
          id: "t-1",
          title: "Span task",
          startDate: "2026-03-09T22:00:00.000Z",
          dueDate: "2026-03-12",
        }),
      ]);
      renderCalendar([MARCH]);

      const bar = screen.getByRole("button", { name: "Span task" });
      expect(bar.style.gridColumn).toBe("1 / 5");
      // Unclipped on both edges → both ends rounded.
      expect(bar.className).not.toContain("rounded-l-none");
      expect(bar.className).not.toContain("rounded-r-none");
    });

    it("clips a week-crossing span into squared-off continuation segments", () => {
      // Mar 12 (Thu, week 3) → Mar 17 (Tue, week 4).
      setupProjectMock([
        makeTask({ id: "t-1", title: "Long span", startDate: "2026-03-12", dueDate: "2026-03-17" }),
      ]);
      renderCalendar([MARCH]);

      const bars = screen.getAllByRole("button", { name: "Long span" });
      expect(bars.length).toBe(2);

      const [first, second] = bars;
      expect(first.style.gridColumn).toBe("4 / 8"); // Thu–Sun of week 3
      expect(first.className).toContain("rounded-r-none"); // continues →
      expect(second.style.gridColumn).toBe("1 / 3"); // Mon–Tue of week 4
      expect(second.className).toContain("rounded-l-none"); // ← continued
    });
  });

  // -----------------------------------------------------------------------
  // 4. "+N more" overflow popover
  // -----------------------------------------------------------------------
  describe("day overflow popover", () => {
    it("truncates chips past the budget and lists every task for the day in the popover", async () => {
      const user = userEvent.setup();
      setupProjectMock([
        makeTask({ id: "t-1", title: "Alpha", dueDate: "2026-03-10" }),
        makeTask({ id: "t-2", title: "Bravo", dueDate: "2026-03-10" }),
        makeTask({ id: "t-3", title: "Charlie", dueDate: "2026-03-10" }),
        makeTask({ id: "t-4", title: "Delta", dueDate: "2026-03-10" }),
      ]);
      renderCalendar([MARCH]);

      const cell = getDayCell("2026-03-10");
      // Budget is 2; chips are priority-then-title sorted, so Alpha + Bravo
      // survive the cut and the trigger reports the 2 hidden chips.
      expect(within(cell).getByText("Alpha")).toBeInTheDocument();
      expect(within(cell).getByText("Bravo")).toBeInTheDocument();
      expect(within(cell).queryByText("Charlie")).not.toBeInTheDocument();
      const trigger = within(cell).getByText("+2 more");

      await user.click(trigger);

      await waitFor(() => {
        expect(document.querySelector(".popover-content")).not.toBeNull();
      });
      const popover = document.querySelector(".popover-content") as HTMLElement;
      // The popover is the complete answer for the day: all four tasks.
      for (const title of ["Alpha", "Bravo", "Charlie", "Delta"]) {
        expect(within(popover).getByText(title)).toBeInTheDocument();
      }
      expect(within(popover).getByText("Tuesday, March 10")).toBeInTheDocument();
    });

    it("opens the task detail (sets ?task=) from a popover row", async () => {
      const user = userEvent.setup();
      setupProjectMock([
        makeTask({ id: "t-1", title: "Alpha", dueDate: "2026-03-10" }),
        makeTask({ id: "t-2", title: "Bravo", dueDate: "2026-03-10" }),
        makeTask({ id: "t-3", title: "Charlie", dueDate: "2026-03-10" }),
      ]);
      renderCalendar([MARCH]);

      await user.click(within(getDayCell("2026-03-10")).getByText("+1 more"));
      await waitFor(() => {
        expect(document.querySelector(".popover-content")).not.toBeNull();
      });
      const popover = document.querySelector(".popover-content") as HTMLElement;
      await user.click(within(popover).getByText("Charlie"));

      const params = getSearchParams();
      expect(params.get("task")).toBe("t-3");
      expect(params.get("month")).toBe("2026-03");
    });
  });

  // -----------------------------------------------------------------------
  // 5. URL contract — task open preserves the rest of the query string
  // -----------------------------------------------------------------------
  describe("task open URL writes", () => {
    it("sets ?task= from a chip click and preserves all other params", async () => {
      const user = userEvent.setup();
      setupProjectMock([
        makeTask({ id: "t-1", title: "Chip task", dueDate: "2026-03-10" }),
      ]);
      renderCalendar(["/?month=2026-03&foo=bar"]);

      await user.click(screen.getByText("Chip task"));

      const params = getSearchParams();
      expect(params.get("task")).toBe("t-1");
      expect(params.get("month")).toBe("2026-03");
      expect(params.get("foo")).toBe("bar"); // nothing else clobbered
    });

    it("sets ?task= from a span click and preserves all other params", async () => {
      const user = userEvent.setup();
      setupProjectMock([
        makeTask({ id: "t-9", title: "Span task", startDate: "2026-03-09", dueDate: "2026-03-12" }),
      ]);
      renderCalendar(["/?month=2026-03&priority=none&foo=bar"]);

      await user.click(screen.getByRole("button", { name: "Span task" }));

      const params = getSearchParams();
      expect(params.get("task")).toBe("t-9");
      expect(params.get("month")).toBe("2026-03");
      expect(params.get("priority")).toBe("none");
      expect(params.get("foo")).toBe("bar");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Month navigation
  // -----------------------------------------------------------------------
  describe("month navigation", () => {
    it("steps to the next month, preserving every other param", async () => {
      const user = userEvent.setup();
      setupProjectMock([]);
      renderCalendar(["/?month=2026-03&priority=high&foo=bar"]);

      await user.click(screen.getByLabelText("Next month"));

      expect(screen.getByText("April 2026")).toBeInTheDocument();
      const params = getSearchParams();
      expect(params.get("month")).toBe("2026-04");
      expect(params.get("priority")).toBe("high");
      expect(params.get("foo")).toBe("bar");
    });

    it("steps to the previous month across a year boundary", async () => {
      const user = userEvent.setup();
      setupProjectMock([]);
      renderCalendar(["/?month=2026-01"]);

      await user.click(screen.getByLabelText("Previous month"));

      expect(screen.getByText("December 2025")).toBeInTheDocument();
      expect(getSearchParams().get("month")).toBe("2025-12");
    });

    it("steps from the implicit current month when no param is set", async () => {
      const user = userEvent.setup();
      setupProjectMock([]);
      renderCalendar(["/"]);

      await user.click(screen.getByLabelText("Next month"));

      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      expect(getSearchParams().get("month")).toBe(
        `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`,
      );
    });

    it("'Today' deletes the month param and preserves everything else", async () => {
      const user = userEvent.setup();
      setupProjectMock([]);
      renderCalendar(["/?month=2026-03&priority=high&foo=bar"]);

      await user.click(screen.getByText("Today"));

      const params = getSearchParams();
      expect(params.has("month")).toBe(false); // absent param = follow real today
      expect(params.get("priority")).toBe("high");
      expect(params.get("foo")).toBe("bar");
      const now = new Date();
      expect(
        screen.getByText(
          now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        ),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Filters (real useTaskFilters against the URL)
  // -----------------------------------------------------------------------
  describe("filter integration", () => {
    it("hides tasks excluded by an active URL filter", () => {
      setupProjectMock([
        makeTask({ id: "t-1", title: "High task", dueDate: "2026-03-10", priority: "high" }),
        makeTask({ id: "t-2", title: "Low task", dueDate: "2026-03-11", priority: "low" }),
      ]);
      renderCalendar(["/?month=2026-03&priority=high"]);

      expect(screen.getByText("High task")).toBeInTheDocument();
      expect(screen.queryByText("Low task")).not.toBeInTheDocument();
    });

    it("filters span tasks too, not just chips", () => {
      setupProjectMock([
        makeTask({
          id: "t-1",
          title: "Filtered span",
          startDate: "2026-03-09",
          dueDate: "2026-03-12",
          priority: "low",
        }),
      ]);
      renderCalendar(["/?month=2026-03&priority=high"]);

      expect(screen.queryByText("Filtered span")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 8. Loading / error states
  // -----------------------------------------------------------------------
  describe("loading and error states", () => {
    it("shows a spinner (no heading) while the project is transiently null", () => {
      setupProjectMock([], { project: null });
      renderCalendar([MARCH]);

      expect(screen.queryByText("Calendar")).not.toBeInTheDocument();
    });

    it("shows the retry surface when tasks failed to load", async () => {
      const user = userEvent.setup();
      const refetchTasks = vi.fn();
      setupProjectMock([], { tasksError: new Error("boom"), refetchTasks });
      renderCalendar([MARCH]);

      expect(screen.getByText("Failed to load calendar data.")).toBeInTheDocument();
      await user.click(screen.getByText("Retry"));
      expect(refetchTasks).toHaveBeenCalled();
    });
  });
});
