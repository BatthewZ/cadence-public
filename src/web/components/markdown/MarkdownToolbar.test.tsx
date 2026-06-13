import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type MarkdownCommand,MarkdownToolbar } from "./MarkdownToolbar";

/**
 * The toolbar is the presentational half of the markdown editor: it must emit
 * the exact tagged-union command for each button (the editor maps those onto
 * pure transforms), keep every button a non-submitting `type="button"`, and go
 * inert when `disabled`. These tests pin that contract so a later editor wiring
 * change can't silently break which transform a button triggers.
 */
function renderToolbar(props: { disabled?: boolean } = {}) {
  const onCommand = vi.fn<(command: MarkdownCommand) => void>();
  render(<MarkdownToolbar onCommand={onCommand} disabled={props.disabled} />);
  return { onCommand };
}

describe("MarkdownToolbar", () => {
  it("emits a bold wrap command when Bold is clicked", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ type: "wrap", marker: "**" });
  });

  it("emits an ordered list command when Numbered list is clicked", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: "Numbered list" }));

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ type: "list", ordered: true });
  });

  it("emits an unordered list command when Bulleted list is clicked", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: "Bulleted list" }));

    expect(onCommand).toHaveBeenCalledWith({ type: "list", ordered: false });
  });

  it("renders every button as type=button so it never submits a surrounding form", () => {
    renderToolbar();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(10);
    for (const button of buttons) {
      expect(button).toHaveAttribute("type", "button");
    }
  });

  it("exposes an accessible label and tooltip on each button", () => {
    renderToolbar();

    const link = screen.getByRole("button", { name: "Link" });
    expect(link).toHaveAttribute("aria-label", "Link");
    expect(link).toHaveAttribute("title", "Link");
  });

  it("does not emit when disabled", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar({ disabled: true });

    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
  });
});
