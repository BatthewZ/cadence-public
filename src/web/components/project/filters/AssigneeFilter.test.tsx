import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProjectMember } from "@/web/contexts/ProjectContext";
import {
  FILTER_NONE,
  type TaskFilters,
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";

import { AssigneeFilter } from "./AssigneeFilter";

/**
 * These tests pin down the "Unassigned" filter option, which encodes
 * absence-of-assignee as the FILTER_NONE sentinel inside `assigneeIds`
 * (design decision D1 of the filtering bundle). They matter because the
 * option is intentionally rendered OUTSIDE the member search filter and the
 * scrollable member list — a refactor that folds it into the searchable list
 * would make it silently disappear whenever a search query matches no member,
 * and `applyFilters` would still accept the sentinel, so nothing else in the
 * system would catch the regression.
 */

/** Six members so the search input renders (gated on `members.length > 5`). */
function makeMembers(): ProjectMember[] {
  return [
    "Alice Anders",
    "Bob Brown",
    "Cara Cole",
    "Dan Drake",
    "Eve Ember",
    "Finn Frost",
  ].map((name, i) => ({
    id: `m${i + 1}`,
    userId: `u${i + 1}`,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    image: null,
    role: "member" as ProjectMember["role"],
    joinedAt: "2026-01-01T00:00:00.000Z",
  }));
}

/**
 * Plain-object stand-in for the `useTaskFilters` return value. Mocking at the
 * prop boundary (rather than mounting a router for the real URL-backed hook)
 * keeps these tests focused on the component's contract: what it reads from
 * `filters` and what it passes to `setFilter`.
 */
function makeFiltersReturn(
  overrides: Partial<TaskFilters> = {},
): UseTaskFiltersReturn {
  const filters: TaskFilters = {
    assigneeIds: [],
    priorities: [],
    completed: null,
    dueDateFrom: null,
    dueDateTo: null,
    noDueDate: false,
    labelIds: [],
    ...overrides,
  };
  return {
    filters,
    setFilter: vi.fn(),
    setFilters: vi.fn(),
    clearFilter: vi.fn(),
    clearFilters: vi.fn(),
    filteredTasks: [],
    activeFilterCount: 0,
    hasActiveFilters: false,
  };
}

async function renderOpen(filtersReturn: UseTaskFiltersReturn) {
  const user = userEvent.setup();
  render(<AssigneeFilter members={makeMembers()} filtersReturn={filtersReturn} />);
  await user.click(screen.getByRole("button", { name: /assigned to/i }));
  await screen.findByText("Filter by person");
  return user;
}

describe("AssigneeFilter — pinned Unassigned option", () => {
  it("renders the Unassigned option above the member list", async () => {
    await renderOpen(makeFiltersReturn());

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toHaveAccessibleName("Unassigned");

    // Explicit DOM-order check: Unassigned precedes the first member row.
    const unassigned = screen.getByRole("checkbox", { name: "Unassigned" });
    const firstMember = screen.getByRole("checkbox", { name: "Alice Anders" });
    expect(
      unassigned.compareDocumentPosition(firstMember) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stays visible when the search query matches no member", async () => {
    const user = await renderOpen(makeFiltersReturn());

    await user.type(screen.getByRole("searchbox"), "zzz-no-such-member");

    expect(screen.getByText("No members found")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Alice Anders" }),
    ).not.toBeInTheDocument();
    // The pinned option is outside the search filter, so it survives.
    expect(
      screen.getByRole("checkbox", { name: "Unassigned" }),
    ).toBeInTheDocument();
  });

  it("toggling on XORs FILTER_NONE into assigneeIds via setFilter", async () => {
    const filtersReturn = makeFiltersReturn({ assigneeIds: ["u1"] });
    const user = await renderOpen(filtersReturn);

    await user.click(screen.getByRole("checkbox", { name: "Unassigned" }));

    expect(filtersReturn.setFilter).toHaveBeenCalledExactlyOnceWith(
      "assigneeIds",
      ["u1", FILTER_NONE],
    );
  });

  it("toggling off XORs FILTER_NONE out of assigneeIds via setFilter", async () => {
    const filtersReturn = makeFiltersReturn({
      assigneeIds: ["u1", FILTER_NONE],
    });
    const user = await renderOpen(filtersReturn);

    const unassigned = screen.getByRole("checkbox", { name: "Unassigned" });
    expect(unassigned).toBeChecked();

    await user.click(unassigned);

    expect(filtersReturn.setFilter).toHaveBeenCalledExactlyOnceWith(
      "assigneeIds",
      ["u1"],
    );
  });

  it("counts FILTER_NONE in the trigger badge like any member selection", () => {
    render(
      <AssigneeFilter
        members={makeMembers()}
        filtersReturn={makeFiltersReturn({ assigneeIds: ["u1", FILTER_NONE] })}
      />,
    );

    const trigger = screen.getByRole("button", { name: /assigned to/i });
    expect(within(trigger).getByText("2")).toBeInTheDocument();
    expect(trigger).toHaveClass("task-filter-bar__trigger--active");
  });
});
