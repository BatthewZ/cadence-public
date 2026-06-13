import { act, renderHook } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { Task } from "@/web/contexts/ProjectContext";

import {
  FILTER_NONE,
  type TaskFilters,
  useTaskFilterControls,
  useTaskFilters,
} from "./use-task-filters";

/**
 * These tests pin down the URL contract of the task filter hooks:
 *
 * - The `"none"` sentinel (FILTER_NONE) lives ONLY inside ID-list params
 *   (`assignee`, `label`) and composes with real IDs as an OR within the
 *   dimension ("assigned to u1 OR unassigned"). Real IDs are nanoids, so the
 *   sentinel cannot collide — but `priority` legitimately has a "none" value,
 *   which is exactly why the sentinel must never leak into name-based params.
 * - Due-date absence uses the dedicated `noDueDate=true` boolean param, and
 *   the due-date trio (`dueDateFrom`/`dueDateTo`/`noDueDate`) counts as a
 *   single dimension in the active-filter badge.
 * - `useTaskFilterControls` is the lightweight URL read/write hook consumed
 *   per-card (e.g. TaskCard click-to-filter) where re-filtering the whole
 *   task list would be wasteful. It is exercised directly here so it is
 *   provably live API surface, not dead code, even before all consumers land.
 */

/** Captures the router's current search string so tests can assert on the
 * serialized URL (the actual single source of truth), not just parsed state. */
function createWrapper(initialEntry = "/") {
  const search = { current: "" };
  function LocationProbe() {
    const location = useLocation();
    // Written in an effect (not during render) so the probe stays
    // side-effect-free under React's render rules; renderHook/act flush
    // effects before assertions run.
    useEffect(() => {
      search.current = location.search;
    }, [location.search]);
    return null;
  }
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        {children}
      </MemoryRouter>
    );
  }
  return { wrapper, search };
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: `Task ${overrides.id}`,
    taskGroupId: "tg-1",
    priority: "medium",
    completed: false,
    position: "a0",
    ...overrides,
  };
}

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe("useTaskFilterControls", () => {
  it("parses the none sentinel and noDueDate from the URL", () => {
    const { wrapper } = createWrapper(
      "/?assignee=u1,none&label=none&noDueDate=true",
    );
    const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

    expect(result.current.filters.assigneeIds).toEqual(["u1", FILTER_NONE]);
    expect(result.current.filters.labelIds).toEqual([FILTER_NONE]);
    expect(result.current.filters.noDueDate).toBe(true);
  });

  it("round-trips the sentinel through setFilter (serialize then re-parse)", () => {
    const { wrapper, search } = createWrapper("/");
    const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

    act(() => {
      result.current.setFilter("assigneeIds", ["u2", FILTER_NONE]);
    });

    expect(search.current).toBe("?assignee=u2%2Cnone");
    expect(result.current.filters.assigneeIds).toEqual(["u2", FILTER_NONE]);
  });

  describe("setFilters batches multiple keys into one URL update", () => {
    // react-router's functional setSearchParams updater closes over the
    // render-time params, so two single-key setFilter calls in one handler
    // both start from the SAME stale URL and the last write wins (the earlier
    // key is silently dropped). setFilters writes every key in one update so
    // the due-date quick-picks (from+to) and "Clear dates" (from+to+noDueDate)
    // cannot lose a key. Pinning this guards against a regression back to
    // per-key setFilter calls.
    it("sets dueDateFrom and dueDateTo together (quick-pick range)", () => {
      const { wrapper, search } = createWrapper("/");
      const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

      act(() => {
        result.current.setFilters({
          dueDateFrom: "2026-06-01",
          dueDateTo: "2026-06-30",
        });
      });

      expect(search.current).toBe(
        "?dueDateFrom=2026-06-01&dueDateTo=2026-06-30",
      );
      expect(result.current.filters.dueDateFrom).toBe("2026-06-01");
      expect(result.current.filters.dueDateTo).toBe("2026-06-30");
    });

    it('clears the whole due-date dimension at once ("Clear dates")', () => {
      const { wrapper, search } = createWrapper(
        "/?dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true&view=board",
      );
      const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

      act(() => {
        result.current.setFilters({
          dueDateFrom: null,
          dueDateTo: null,
          noDueDate: false,
        });
      });

      expect(search.current).toBe("?view=board");
      expect(result.current.filters.dueDateFrom).toBeNull();
      expect(result.current.filters.dueDateTo).toBeNull();
      expect(result.current.filters.noDueDate).toBe(false);
    });
  });

  it("writes noDueDate=true and removes the param when set back to false", () => {
    const { wrapper, search } = createWrapper("/");
    const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

    act(() => {
      result.current.setFilter("noDueDate", true);
    });
    expect(search.current).toBe("?noDueDate=true");
    expect(result.current.filters.noDueDate).toBe(true);

    act(() => {
      result.current.setFilter("noDueDate", false);
    });
    expect(search.current).toBe("");
    expect(result.current.filters.noDueDate).toBe(false);
  });

  describe("URL trust boundary (regression: gate-found calendar-date bug)", () => {
    // The URL is hand-editable, so date params must be validated down to real
    // calendar dates — `applyFilters` compares them lexically, where a
    // shape-valid-but-impossible date or arbitrary text silently mis-filters.
    // Mirrors the server-side z.iso.date() fix on the My Tasks API.
    it("drops a date-shaped but calendar-invalid dueDateFrom (2030-02-30)", () => {
      const { wrapper } = createWrapper("/?dueDateFrom=2030-02-30");
      const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

      expect(result.current.filters.dueDateFrom).toBeNull();
    });

    it("drops non-date garbage in dueDateTo while keeping a valid dueDateFrom", () => {
      const { wrapper } = createWrapper(
        "/?dueDateFrom=2030-03-01&dueDateTo=banana",
      );
      const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

      expect(result.current.filters.dueDateFrom).toBe("2030-03-01");
      expect(result.current.filters.dueDateTo).toBeNull();
    });

    it("accepts a leap-day date that a naive month/day bound check would reject", () => {
      const { wrapper } = createWrapper("/?dueDateFrom=2028-02-29");
      const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

      expect(result.current.filters.dueDateFrom).toBe("2028-02-29");
    });

    it("drops unknown priority values from the CSV, keeping genuine ones", () => {
      const { wrapper } = createWrapper("/?priority=high,banana,low");
      const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

      expect(result.current.filters.priorities).toEqual(["high", "low"]);
    });
  });

  it("clearFilter removes a single dimension's param", () => {
    const { wrapper, search } = createWrapper("/?noDueDate=true&assignee=none");
    const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

    act(() => {
      result.current.clearFilter("noDueDate");
    });

    expect(search.current).toBe("?assignee=none");
    expect(result.current.filters.noDueDate).toBe(false);
    expect(result.current.filters.assigneeIds).toEqual([FILTER_NONE]);
  });

  it("clearFilters removes all filter params (including noDueDate) but preserves unrelated params", () => {
    const { wrapper, search } = createWrapper(
      "/?assignee=u1,none&priority=high&completed=true&dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true&label=none&view=board",
    );
    const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

    act(() => {
      result.current.clearFilters();
    });

    expect(search.current).toBe("?view=board");
    expect(result.current.filters).toEqual({
      assigneeIds: [],
      priorities: [],
      completed: null,
      dueDateFrom: null,
      dueDateTo: null,
      noDueDate: false,
      labelIds: [],
    } satisfies TaskFilters);
  });

  it("exposes only URL read/write surface (no task-list derivations)", () => {
    const { wrapper } = createWrapper("/");
    const { result } = renderHook(() => useTaskFilterControls(), { wrapper });

    expect(Object.keys(result.current).sort()).toEqual([
      "clearFilter",
      "clearFilters",
      "filters",
      "setFilter",
      "setFilters",
    ]);
  });
});

describe("useTaskFilters", () => {
  describe("OR within a dimension (absence cases)", () => {
    const tasks = [
      makeTask({ id: "t-u1", assigneeId: "u1" }),
      makeTask({ id: "t-u2", assigneeId: "u2" }),
      makeTask({ id: "t-unassigned", assigneeId: null }),
    ];

    it("assignee sentinel alone matches only unassigned tasks", () => {
      const { wrapper } = createWrapper("/?assignee=none");
      const { result } = renderHook(() => useTaskFilters(tasks), { wrapper });

      expect(ids(result.current.filteredTasks)).toEqual(["t-unassigned"]);
    });

    it("assignee ID + sentinel matches that assignee OR unassigned", () => {
      const { wrapper } = createWrapper("/?assignee=u1,none");
      const { result } = renderHook(() => useTaskFilters(tasks), { wrapper });

      expect(ids(result.current.filteredTasks)).toEqual(["t-u1", "t-unassigned"]);
    });

    it("label sentinel matches tasks with zero labels, composing OR with real label IDs", () => {
      const labelTasks = [
        makeTask({ id: "t-l1", labels: [{ id: "l1", name: "Bug", color: "#f00" }] }),
        makeTask({ id: "t-l2", labels: [{ id: "l2", name: "Chore", color: "#0f0" }] }),
        makeTask({ id: "t-bare", labels: [] }),
        makeTask({ id: "t-undef" }),
      ];

      const only = createWrapper("/?label=none");
      const onlyNone = renderHook(() => useTaskFilters(labelTasks), {
        wrapper: only.wrapper,
      });
      expect(ids(onlyNone.result.current.filteredTasks)).toEqual([
        "t-bare",
        "t-undef",
      ]);

      const mixed = createWrapper("/?label=l1,none");
      const labelOrNone = renderHook(() => useTaskFilters(labelTasks), {
        wrapper: mixed.wrapper,
      });
      expect(ids(labelOrNone.result.current.filteredTasks)).toEqual([
        "t-l1",
        "t-bare",
        "t-undef",
      ]);
    });

    it("noDueDate alone matches only tasks without a due date", () => {
      const dueTasks = [
        makeTask({ id: "t-due", dueDate: "2026-06-15T00:00:00.000Z" }),
        makeTask({ id: "t-nodue", dueDate: null }),
        makeTask({ id: "t-undef-due" }),
      ];
      const { wrapper } = createWrapper("/?noDueDate=true");
      const { result } = renderHook(() => useTaskFilters(dueTasks), { wrapper });

      expect(ids(result.current.filteredTasks)).toEqual([
        "t-nodue",
        "t-undef-due",
      ]);
    });
  });

  describe("due-date dimension: range OR absence", () => {
    const tasks = [
      makeTask({ id: "t-in-range", dueDate: "2026-06-15T00:00:00.000Z" }),
      makeTask({ id: "t-out-of-range", dueDate: "2026-07-15T00:00:00.000Z" }),
      makeTask({ id: "t-no-due" }),
    ];

    it("range + noDueDate passes in-range tasks OR tasks without a due date", () => {
      const { wrapper } = createWrapper(
        "/?dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true",
      );
      const { result } = renderHook(() => useTaskFilters(tasks), { wrapper });

      expect(ids(result.current.filteredTasks)).toEqual([
        "t-in-range",
        "t-no-due",
      ]);
    });

    it("range alone still excludes tasks without a due date (regression guard)", () => {
      const { wrapper } = createWrapper(
        "/?dueDateFrom=2026-06-01&dueDateTo=2026-06-30",
      );
      const { result } = renderHook(() => useTaskFilters(tasks), { wrapper });

      expect(ids(result.current.filteredTasks)).toEqual(["t-in-range"]);
    });
  });

  it("ANDs across dimensions: unassigned AND high priority", () => {
    const tasks = [
      makeTask({ id: "t-unassigned-high", assigneeId: null, priority: "high" }),
      makeTask({ id: "t-unassigned-low", assigneeId: null, priority: "low" }),
      makeTask({ id: "t-assigned-high", assigneeId: "u1", priority: "high" }),
    ];
    const { wrapper } = createWrapper("/?assignee=none&priority=high");
    const { result } = renderHook(() => useTaskFilters(tasks), { wrapper });

    expect(ids(result.current.filteredTasks)).toEqual(["t-unassigned-high"]);
  });

  describe("active-filter counting", () => {
    it("counts the due-date trio (from/to/noDueDate) as one dimension", () => {
      const { wrapper } = createWrapper(
        "/?dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true",
      );
      const { result } = renderHook(() => useTaskFilters([]), { wrapper });

      expect(result.current.activeFilterCount).toBe(1);
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("noDueDate alone activates the due-date dimension", () => {
      const { wrapper } = createWrapper("/?noDueDate=true");
      const { result } = renderHook(() => useTaskFilters([]), { wrapper });

      expect(result.current.activeFilterCount).toBe(1);
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("counts each dimension once across the board", () => {
      const { wrapper } = createWrapper(
        "/?assignee=u1,none&priority=high,low&completed=false&noDueDate=true&label=none",
      );
      const { result } = renderHook(() => useTaskFilters([]), { wrapper });

      expect(result.current.activeFilterCount).toBe(5);
    });

    it("reports zero with no filter params", () => {
      const { wrapper } = createWrapper("/?view=board");
      const { result } = renderHook(() => useTaskFilters([]), { wrapper });

      expect(result.current.activeFilterCount).toBe(0);
      expect(result.current.hasActiveFilters).toBe(false);
    });
  });

  it("clearFilters resets noDueDate so all tasks reappear", () => {
    const tasks = [
      makeTask({ id: "t-due", dueDate: "2026-06-15T00:00:00.000Z" }),
      makeTask({ id: "t-no-due" }),
    ];
    const { wrapper, search } = createWrapper("/?noDueDate=true");
    const { result } = renderHook(() => useTaskFilters(tasks), { wrapper });

    expect(ids(result.current.filteredTasks)).toEqual(["t-no-due"]);

    act(() => {
      result.current.clearFilters();
    });

    expect(search.current).toBe("");
    expect(result.current.filters.noDueDate).toBe(false);
    expect(ids(result.current.filteredTasks)).toEqual(["t-due", "t-no-due"]);
    expect(result.current.hasActiveFilters).toBe(false);
  });
});
