import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProjectMember } from "@/web/contexts/ProjectContext";
import type { Label } from "@/web/hooks/use-labels";
import {
  FILTER_NONE,
  type TaskFilters,
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";

import { FilterChips } from "./FilterChips";

/**
 * These tests pin down the absence-filter chips ("Unassigned", "No label",
 * "No due date") because their bugs are silent: a wrong remover doesn't
 * crash, it just rewrites the URL filter state incorrectly (dropping a
 * teammate's id along with the sentinel, or wiping a date range the user
 * still wants). The chips are the ONLY UI for removing a single value from a
 * multi-value dimension, so their removers must be surgically precise.
 *
 * `filtersReturn` is mocked as a plain object — FilterChips is purely
 * presentational and must not depend on real hook wiring, so asserting on the
 * exact `setFilter`/`clearFilter` calls is the complete contract.
 */

const emptyFilters: TaskFilters = {
  assigneeIds: [],
  priorities: [],
  completed: null,
  dueDateFrom: null,
  dueDateTo: null,
  noDueDate: false,
  labelIds: [],
};

const members: ProjectMember[] = [
  {
    id: "pm-1",
    userId: "u1",
    name: "Alice",
    email: "alice@example.com",
    image: null,
    role: "member",
    joinedAt: "2026-01-01T00:00:00.000Z",
  },
];

const labels: Label[] = [
  {
    id: "lbl-1",
    projectId: "p1",
    name: "Bug",
    color: "#ff0000",
    taskCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

function makeFiltersReturn(
  overrides: Partial<TaskFilters> = {},
): UseTaskFiltersReturn {
  return {
    filters: { ...emptyFilters, ...overrides },
    setFilter: vi.fn(),
    setFilters: vi.fn(),
    clearFilter: vi.fn(),
    clearFilters: vi.fn(),
    filteredTasks: [],
    activeFilterCount: 0,
    hasActiveFilters: false,
  };
}

function renderChips(filtersReturn: UseTaskFiltersReturn) {
  return render(
    <FilterChips
      filters={filtersReturn.filters}
      members={members}
      labels={labels}
      filtersReturn={filtersReturn}
    />,
  );
}

describe("FilterChips absence chips", () => {
  it("renders no absence chips when no absence filters are active", () => {
    renderChips(makeFiltersReturn());

    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
    expect(screen.queryByText("No label")).not.toBeInTheDocument();
    expect(screen.queryByText("No due date")).not.toBeInTheDocument();
  });

  describe("Unassigned chip", () => {
    it("renders when the FILTER_NONE sentinel is in assigneeIds", () => {
      renderChips(makeFiltersReturn({ assigneeIds: [FILTER_NONE] }));

      expect(screen.getByText("Unassigned")).toBeInTheDocument();
    });

    it("does not leak the sentinel into the member-name chips", () => {
      // The sentinel matches no member, so falling through to the id→name
      // lookup would render a bogus "Unknown" chip next to "Unassigned".
      renderChips(makeFiltersReturn({ assigneeIds: [FILTER_NONE, "u1"] }));

      expect(screen.getByText("Unassigned")).toBeInTheDocument();
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
      expect(screen.queryByText("none")).not.toBeInTheDocument();
    });

    it("remover strips only the sentinel, preserving other assignee ids", async () => {
      const user = userEvent.setup();
      const filtersReturn = makeFiltersReturn({
        assigneeIds: ["u1", FILTER_NONE],
      });
      renderChips(filtersReturn);

      await user.click(
        screen.getByRole("button", { name: "Remove unassigned filter" }),
      );

      expect(filtersReturn.setFilter).toHaveBeenCalledExactlyOnceWith(
        "assigneeIds",
        ["u1"],
      );
    });
  });

  describe("No label chip", () => {
    it("renders when the FILTER_NONE sentinel is in labelIds", () => {
      renderChips(makeFiltersReturn({ labelIds: [FILTER_NONE] }));

      expect(screen.getByText("No label")).toBeInTheDocument();
    });

    it("does not leak the sentinel into the label-name chips", () => {
      renderChips(makeFiltersReturn({ labelIds: [FILTER_NONE, "lbl-1"] }));

      expect(screen.getByText("No label")).toBeInTheDocument();
      expect(screen.getByText("Bug")).toBeInTheDocument();
      expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
      expect(screen.queryByText("none")).not.toBeInTheDocument();
    });

    it("remover strips only the sentinel, preserving other label ids", async () => {
      const user = userEvent.setup();
      const filtersReturn = makeFiltersReturn({
        labelIds: ["lbl-1", FILTER_NONE],
      });
      renderChips(filtersReturn);

      await user.click(
        screen.getByRole("button", { name: "Remove no label filter" }),
      );

      expect(filtersReturn.setFilter).toHaveBeenCalledExactlyOnceWith(
        "labelIds",
        ["lbl-1"],
      );
    });
  });

  describe("No due date chip", () => {
    it("renders when noDueDate is set", () => {
      renderChips(makeFiltersReturn({ noDueDate: true }));

      expect(screen.getByText("No due date")).toBeInTheDocument();
    });

    it("remover clears only the noDueDate dimension", async () => {
      const user = userEvent.setup();
      const filtersReturn = makeFiltersReturn({ noDueDate: true });
      renderChips(filtersReturn);

      await user.click(
        screen.getByRole("button", { name: "Remove no due date filter" }),
      );

      expect(filtersReturn.clearFilter).toHaveBeenCalledExactlyOnceWith(
        "noDueDate",
      );
      expect(filtersReturn.setFilter).not.toHaveBeenCalled();
    });

    it("preserves an active date range when the no-due-date chip is removed", async () => {
      // Range and absence are independent OR sub-filters of the due-date
      // dimension, each with its own chip. Removing "No due date" must narrow
      // the view to the range — not wipe dueDateFrom/dueDateTo too.
      const user = userEvent.setup();
      const filtersReturn = makeFiltersReturn({
        noDueDate: true,
        dueDateFrom: "2026-06-01",
        dueDateTo: "2026-06-30",
      });
      renderChips(filtersReturn);

      // Both chips render side by side for the combined state.
      expect(screen.getByText("2026-06-01 — 2026-06-30")).toBeInTheDocument();
      expect(screen.getByText("No due date")).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Remove no due date filter" }),
      );

      expect(filtersReturn.clearFilter).toHaveBeenCalledExactlyOnceWith(
        "noDueDate",
      );
      // The range params are never written to — clearFilter("noDueDate")
      // deletes a single URL param, so dueDateFrom/dueDateTo survive.
      expect(filtersReturn.setFilter).not.toHaveBeenCalled();
    });
  });

  describe("date-range chip", () => {
    it("remover clears from AND to in one batched setFilters call (regression: gate-found clobber bug)", async () => {
      // Two back-to-back setFilter calls would clobber each other:
      // react-router's functional setSearchParams updater closes over the
      // render-time params, so the second call starts from the same stale URL
      // and resurrects the param the first call deleted. The remover must use
      // the batched setFilters so BOTH keys land in one URL update.
      const user = userEvent.setup();
      const filtersReturn = makeFiltersReturn({
        dueDateFrom: "2026-06-01",
        dueDateTo: "2026-06-30",
      });
      renderChips(filtersReturn);

      await user.click(
        screen.getByRole("button", { name: "Remove due date filter" }),
      );

      expect(filtersReturn.setFilters).toHaveBeenCalledExactlyOnceWith({
        dueDateFrom: null,
        dueDateTo: null,
      });
      // Single-key writers must NOT be involved — they are the clobber vector.
      expect(filtersReturn.setFilter).not.toHaveBeenCalled();
    });
  });
});
