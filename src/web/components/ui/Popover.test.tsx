import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Popover } from "./Popover";

function renderPopover(props: Record<string, unknown> = {}) {
  return render(
    <Popover {...props}>
      <Popover.Trigger>Toggle popover</Popover.Trigger>
      <Popover.Content>
        <p>Popover body content</p>
      </Popover.Content>
    </Popover>,
  );
}

describe("Popover", () => {
  it("does not show content when closed", () => {
    renderPopover();

    expect(screen.queryByText("Popover body content")).not.toBeInTheDocument();
  });

  it("opens popover when trigger is clicked", async () => {
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole("button", { name: "Toggle popover" }));

    expect(await screen.findByText("Popover body content")).toBeInTheDocument();
  });

  it("closes popover when trigger is clicked again", async () => {
    const user = userEvent.setup();
    renderPopover();

    const trigger = screen.getByRole("button", { name: "Toggle popover" });

    await user.click(trigger);
    expect(await screen.findByText("Popover body content")).toBeInTheDocument();

    await user.click(trigger);
    await waitFor(() => {
      expect(screen.queryByText("Popover body content")).not.toBeInTheDocument();
    });
  });

  it("closes popover on Escape", async () => {
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole("button", { name: "Toggle popover" }));
    expect(await screen.findByText("Popover body content")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Popover body content")).not.toBeInTheDocument();
    });
  });

  it("trigger has aria-expanded='false' initially", () => {
    renderPopover();

    expect(screen.getByRole("button", { name: "Toggle popover" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("trigger has aria-expanded='true' when open", async () => {
    const user = userEvent.setup();
    renderPopover();

    const trigger = screen.getByRole("button", { name: "Toggle popover" });
    await user.click(trigger);
    await screen.findByText("Popover body content");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("trigger has aria-haspopup='dialog'", () => {
    renderPopover();

    expect(screen.getByRole("button", { name: "Toggle popover" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  });

  it("respects controlled open prop", () => {
    const { rerender } = render(
      <Popover open={false} onOpenChange={() => {}}>
        <Popover.Trigger>Toggle popover</Popover.Trigger>
        <Popover.Content>
          <p>Popover body content</p>
        </Popover.Content>
      </Popover>,
    );

    expect(screen.queryByText("Popover body content")).not.toBeInTheDocument();

    rerender(
      <Popover open={true} onOpenChange={() => {}}>
        <Popover.Trigger>Toggle popover</Popover.Trigger>
        <Popover.Content>
          <p>Popover body content</p>
        </Popover.Content>
      </Popover>,
    );

    expect(screen.getByText("Popover body content")).toBeInTheDocument();
  });

  it("calls onOpenChange in controlled mode", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Popover open={false} onOpenChange={onOpenChange}>
        <Popover.Trigger>Toggle popover</Popover.Trigger>
        <Popover.Content>
          <p>Popover body content</p>
        </Popover.Content>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Toggle popover" }));

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
