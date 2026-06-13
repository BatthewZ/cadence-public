import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FILTER_NONE } from "@/web/hooks/use-task-filters";

import { LabelFilter, type LabelFilterProps } from "./LabelFilter";

/**
 * LabelFilter is fully controlled (no router, no query client), which is the
 * point of the FB refactor: these tests pin down the `onChange` contract that
 * BOTH owners (project TaskFilterBar today, workspace My Tasks next wave)
 * rely on. They are also the only automated coverage of the TaskFilterBar
 * cluster's riskiest change — the removal of LabelFilter's old
 * `return null` on zero labels in favor of the empty-state popover.
 */

const OPTIONS: LabelFilterProps["options"] = [
  { id: "lbl-bug", name: "Bug", color: "#ef4444" },
  { id: "lbl-feature", name: "Feature", color: "#3b82f6" },
];

function renderFilter(overrides: Partial<LabelFilterProps> = {}) {
  const onChange = vi.fn();
  const props: LabelFilterProps = {
    options: OPTIONS,
    selected: [],
    onChange,
    ...overrides,
  };
  render(<LabelFilter {...props} />);
  return { onChange };
}

/** Opens the popover via its trigger (accessible name starts with "Label"). */
async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Label/ }));
  await screen.findByText("Filter by label");
}

describe("LabelFilter", () => {
  it("always renders the trigger, even with zero labels", () => {
    renderFilter({ options: [] });
    expect(screen.getByRole("button", { name: "Label" })).toBeInTheDocument();
  });

  describe("empty state (zero labels)", () => {
    it("shows the explainer and a Manage labels button when onManageLabels is provided", async () => {
      const user = userEvent.setup();
      const onManageLabels = vi.fn();
      renderFilter({ options: [], onManageLabels });

      await openPopover(user);

      expect(
        screen.getByText("No labels in this project yet."),
      ).toBeInTheDocument();

      const manageButton = screen.getByRole("button", { name: "Manage labels" });
      await user.click(manageButton);
      expect(onManageLabels).toHaveBeenCalledOnce();
    });

    it("shows text-only guidance (no button) when onManageLabels is omitted", async () => {
      const user = userEvent.setup();
      renderFilter({ options: [] });

      await openPopover(user);

      expect(
        screen.getByText(
          "No labels in this workspace yet. Create labels inside a project.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Manage labels" }),
      ).not.toBeInTheDocument();
    });

    it("renders no label options in the empty state", async () => {
      const user = userEvent.setup();
      renderFilter({ options: [] });

      await openPopover(user);

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });
  });

  describe("pinned 'No label' option", () => {
    it("is pinned as the first option in the list", async () => {
      const user = userEvent.setup();
      renderFilter();

      await openPopover(user);

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(3);
      expect(checkboxes[0]).toBe(
        screen.getByRole("checkbox", { name: "No label" }),
      );
    });

    it("adds FILTER_NONE to the selection when toggled on", async () => {
      const user = userEvent.setup();
      const { onChange } = renderFilter({ selected: ["lbl-bug"] });

      await openPopover(user);
      await user.click(screen.getByRole("checkbox", { name: "No label" }));

      expect(onChange).toHaveBeenCalledExactlyOnceWith(["lbl-bug", FILTER_NONE]);
    });

    it("removes FILTER_NONE from the selection when toggled off", async () => {
      const user = userEvent.setup();
      const { onChange } = renderFilter({ selected: [FILTER_NONE, "lbl-bug"] });

      await openPopover(user);
      const noLabel = screen.getByRole("checkbox", { name: "No label" });
      expect(noLabel).toBeChecked();

      await user.click(noLabel);
      expect(onChange).toHaveBeenCalledExactlyOnceWith(["lbl-bug"]);
    });
  });

  describe("regular option toggling", () => {
    it("adds an unselected label id to the selection", async () => {
      const user = userEvent.setup();
      const { onChange } = renderFilter({ selected: ["lbl-bug"] });

      await openPopover(user);
      await user.click(screen.getByRole("checkbox", { name: "Feature" }));

      expect(onChange).toHaveBeenCalledExactlyOnceWith(["lbl-bug", "lbl-feature"]);
    });

    it("removes an already-selected label id from the selection", async () => {
      const user = userEvent.setup();
      const { onChange } = renderFilter({ selected: ["lbl-bug", "lbl-feature"] });

      await openPopover(user);
      const bug = screen.getByRole("checkbox", { name: "Bug" });
      expect(bug).toBeChecked();

      await user.click(bug);
      expect(onChange).toHaveBeenCalledExactlyOnceWith(["lbl-feature"]);
    });

    it("reflects the controlled selection in checkbox state", async () => {
      const user = userEvent.setup();
      renderFilter({ selected: ["lbl-feature", FILTER_NONE] });

      await openPopover(user);

      expect(screen.getByRole("checkbox", { name: "No label" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Feature" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Bug" })).not.toBeChecked();
    });
  });

  describe("trigger badge", () => {
    it("shows the selected count (sentinel included) when filters are active", () => {
      renderFilter({ selected: ["lbl-bug", FILTER_NONE] });

      const trigger = screen.getByRole("button", { name: /^Label/ });
      expect(within(trigger).getByText("2")).toBeInTheDocument();
    });

    it("shows no count badge when nothing is selected", () => {
      renderFilter({ selected: [] });

      const trigger = screen.getByRole("button", { name: "Label" });
      expect(within(trigger).queryByText(/\d/)).not.toBeInTheDocument();
    });
  });
});
