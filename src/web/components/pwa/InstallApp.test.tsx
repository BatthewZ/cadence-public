import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import type { Install } from "@/web/lib/pwa";

import { InstallAppMenuItem, InstallHelpDialog } from "./InstallApp";

const install = vi.hoisted(() => ({
  state: {} as Install,
}));

vi.mock("@/web/lib/pwa", () => ({ useInstall: () => install.state }));

// jsdom implements neither showModal nor close; toggle `open` as they do.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  install.state = {
    available: false,
    installed: false,
    install: vi.fn(() => Promise.resolve("accepted" as const)),
    help: { title: "Add to Home Screen", steps: ["Tap Share.", "Choose Add to Home Screen."] },
  };
});

async function openMenuWithItem(onShowHelp = vi.fn()) {
  render(
    <DropdownMenu>
      <DropdownMenu.Trigger>Account</DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <InstallAppMenuItem index={0} onShowHelp={onShowHelp} />
      </DropdownMenu.Content>
    </DropdownMenu>
  );
  await userEvent.click(screen.getByRole("button", { name: "Account" }));
  await screen.findByRole("menu");
  return onShowHelp;
}

describe("InstallAppMenuItem", () => {
  it("shows the browser's dialog when it has one", async () => {
    install.state.available = true;
    const onShowHelp = await openMenuWithItem();
    await userEvent.click(screen.getByRole("menuitem", { name: "Install app" }));
    expect(install.state.install).toHaveBeenCalledTimes(1);
    expect(onShowHelp).not.toHaveBeenCalled();
  });

  it("falls back to the manual steps when the browser's prompt is used up", async () => {
    install.state.available = true;
    install.state.install = vi.fn(() => Promise.resolve("unavailable" as const));
    const onShowHelp = await openMenuWithItem();
    await userEvent.click(screen.getByRole("menuitem", { name: "Install app" }));
    await vi.waitFor(() => expect(onShowHelp).toHaveBeenCalledTimes(1));
  });

  it("goes straight to the manual steps when the browser has no dialog (iOS, Firefox)", async () => {
    const onShowHelp = await openMenuWithItem();
    await userEvent.click(screen.getByRole("menuitem", { name: "Install app" }));
    expect(onShowHelp).toHaveBeenCalledTimes(1);
    expect(install.state.install).not.toHaveBeenCalled();
  });

  it("is hidden once Cadence is installed", async () => {
    install.state.installed = true;
    await openMenuWithItem();
    expect(screen.queryByRole("menuitem", { name: "Install app" })).not.toBeInTheDocument();
  });
});

describe("InstallHelpDialog", () => {
  it("lists this browser's steps in order under its title, and closes", async () => {
    const onClose = vi.fn();
    render(<InstallHelpDialog open onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Add to Home Screen" });
    expect(dialog).toHaveAttribute("open");
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(["Tap Share.", "Choose Add to Home Screen."]);
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
