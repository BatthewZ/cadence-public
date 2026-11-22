import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdatePrompt } from "./UpdatePrompt";

const update = vi.hoisted(() => ({ ready: false, apply: vi.fn(), dismiss: vi.fn() }));

vi.mock("@/web/lib/pwa", () => ({ useUpdatePrompt: () => update }));

beforeEach(() => {
  update.ready = false;
  update.apply.mockReset();
  update.dismiss.mockReset();
});

describe("UpdatePrompt", () => {
  it("keeps an empty live region mounted until a new version waits", () => {
    render(<UpdatePrompt />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
  });

  it("offers Reload and Not now inside the live region", () => {
    update.ready = true;
    render(<UpdatePrompt />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("A new version of Cadence is available");
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
  });

  it("Not now dismisses without updating", async () => {
    update.ready = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(update.dismiss).toHaveBeenCalledTimes(1);
    expect(update.apply).not.toHaveBeenCalled();
  });

  it("Reload applies once and locks both buttons while the page reloads", async () => {
    update.ready = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(update.apply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reloading…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();
  });
});
