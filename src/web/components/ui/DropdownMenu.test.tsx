import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DropdownMenu } from "./DropdownMenu";

function renderMenu(
  options: { onSelect?: () => void; disabledOnSelect?: () => void } = {},
) {
  const onSelect = options.onSelect ?? vi.fn();
  const disabledOnSelect = options.disabledOnSelect ?? vi.fn();

  return {
    onSelect,
    disabledOnSelect,
    ...render(
      <DropdownMenu>
        <DropdownMenu.Trigger>Open menu</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Label>Actions</DropdownMenu.Label>
          <DropdownMenu.Item index={0} onSelect={onSelect}>
            Edit
          </DropdownMenu.Item>
          <DropdownMenu.Item index={1}>Duplicate</DropdownMenu.Item>
          <DropdownMenu.Divider />
          <DropdownMenu.Item index={2} disabled onSelect={disabledOnSelect}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>,
    ),
  };
}

describe("DropdownMenu", () => {
  it("does not show content when closed", () => {
    renderMenu();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens menu when trigger is clicked", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("closes menu on Escape", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("items have role='menuitem'", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("menu");

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3);
  });

  it("divider has role='separator'", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("menu");

    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("clicking an item calls onSelect and closes menu", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("menu");

    await user.click(screen.getByRole("menuitem", { name: "Edit" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("disabled items have aria-disabled and do not fire onSelect", async () => {
    const user = userEvent.setup();
    const { disabledOnSelect } = renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("menu");

    const deleteItem = screen.getByRole("menuitem", { name: "Delete" });
    expect(deleteItem).toHaveAttribute("aria-disabled", "true");

    await user.click(deleteItem);

    expect(disabledOnSelect).not.toHaveBeenCalled();
  });

  it("arrow down moves focus through menu items", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("menu");

    const items = screen.getAllByRole("menuitem");
    await user.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
  });

  it("arrow up from first item wraps to last enabled item", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("menu");

    const items = screen.getAllByRole("menuitem");

    // Navigate to first item
    await user.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();

    // Arrow up should wrap — skipping the disabled "Delete" item
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
  });

  it("trigger has aria-expanded and aria-haspopup='menu'", async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger);
    await screen.findByRole("menu");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
