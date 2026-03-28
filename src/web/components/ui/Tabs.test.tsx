import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Tabs } from "./Tabs";

vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => true,
}));

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function renderTabs(props: { defaultValue?: string; variant?: "underline" | "pill" | "enclosed" } = {}) {
  const { defaultValue = "one", variant } = props;
  return render(
    <Tabs defaultValue={defaultValue} variant={variant}>
      <Tabs.List>
        <Tabs.Tab value="one">Tab One</Tabs.Tab>
        <Tabs.Tab value="two">Tab Two</Tabs.Tab>
        <Tabs.Tab value="three">Tab Three</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="one">Panel One Content</Tabs.Panel>
      <Tabs.Panel value="two">Panel Two Content</Tabs.Panel>
      <Tabs.Panel value="three">Panel Three Content</Tabs.Panel>
    </Tabs>,
  );
}

describe("Tabs", () => {
  it("renders tab list with role='tablist' and tab panels", () => {
    renderTabs();

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("first tab is selected by default", () => {
    renderTabs();

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel One Content")).toBeInTheDocument();
  });

  it("defaultValue prop sets initial active tab", () => {
    renderTabs({ defaultValue: "two" });

    expect(screen.getByRole("tab", { name: "Tab Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel Two Content")).toBeInTheDocument();
    expect(screen.queryByText("Panel One Content")).not.toBeInTheDocument();
  });

  it("clicking a tab activates it and shows its panel", async () => {
    const user = userEvent.setup();
    renderTabs();

    expect(screen.getByText("Panel One Content")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Tab Two" }));

    expect(screen.getByText("Panel Two Content")).toBeInTheDocument();
    expect(screen.queryByText("Panel One Content")).not.toBeInTheDocument();
  });

  it("active tab has aria-selected='true', others 'false'", async () => {
    const user = userEvent.setup();
    renderTabs();

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Tab Two" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Tab Three" })).toHaveAttribute("aria-selected", "false");

    await user.click(screen.getByRole("tab", { name: "Tab Two" }));

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Tab Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Tab Three" })).toHaveAttribute("aria-selected", "false");
  });

  it("tab panel has role='tabpanel' linked via aria-labelledby", () => {
    renderTabs();

    const panel = screen.getByRole("tabpanel");
    const tab = screen.getByRole("tab", { name: "Tab One" });

    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("keyboard: ArrowRight moves to next tab", async () => {
    const user = userEvent.setup();
    renderTabs();

    const tabOne = screen.getByRole("tab", { name: "Tab One" });
    tabOne.focus();

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Tab Two" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tab Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel Two Content")).toBeInTheDocument();
  });

  it("keyboard: ArrowLeft moves to previous tab", async () => {
    const user = userEvent.setup();
    renderTabs({ defaultValue: "two" });

    const tabTwo = screen.getByRole("tab", { name: "Tab Two" });
    tabTwo.focus();

    await user.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel One Content")).toBeInTheDocument();
  });

  it("keyboard: ArrowRight wraps from last to first tab", async () => {
    const user = userEvent.setup();
    renderTabs({ defaultValue: "three" });

    const tabThree = screen.getByRole("tab", { name: "Tab Three" });
    tabThree.focus();

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("aria-selected", "true");
  });

  it("keyboard: ArrowLeft wraps from first to last tab", async () => {
    const user = userEvent.setup();
    renderTabs();

    const tabOne = screen.getByRole("tab", { name: "Tab One" });
    tabOne.focus();

    await user.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: "Tab Three" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tab Three" })).toHaveAttribute("aria-selected", "true");
  });

  it("variant prop applies correct styling class", () => {
    const { rerender } = render(
      <Tabs defaultValue="one" variant="pill">
        <Tabs.List>
          <Tabs.Tab value="one">Tab One</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="one">Panel One</Tabs.Panel>
      </Tabs>,
    );

    expect(screen.getByRole("tablist")).toHaveClass("tabs-list--pill");

    rerender(
      <Tabs defaultValue="one" variant="enclosed">
        <Tabs.List>
          <Tabs.Tab value="one">Tab One</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="one">Panel One</Tabs.Panel>
      </Tabs>,
    );

    expect(screen.getByRole("tablist")).toHaveClass("tabs-list--enclosed");
  });

  it("inactive tabs have tabIndex=-1 and active tab has tabIndex=0", () => {
    renderTabs();

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Tab Two" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: "Tab Three" })).toHaveAttribute("tabindex", "-1");
  });

  it("tab has aria-controls pointing to its panel id", () => {
    renderTabs();

    const tab = screen.getByRole("tab", { name: "Tab One" });
    const panel = screen.getByRole("tabpanel");

    expect(tab).toHaveAttribute("aria-controls", panel.id);
  });

  it("disabled tab cannot be activated", async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="one">
        <Tabs.List>
          <Tabs.Tab value="one">Tab One</Tabs.Tab>
          <Tabs.Tab value="two" disabled>Tab Two</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="one">Panel One Content</Tabs.Panel>
        <Tabs.Panel value="two">Panel Two Content</Tabs.Panel>
      </Tabs>,
    );

    await user.click(screen.getByRole("tab", { name: "Tab Two" }));

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel One Content")).toBeInTheDocument();
    expect(screen.queryByText("Panel Two Content")).not.toBeInTheDocument();
  });

  it("calls onValueChange when tab is clicked", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="one" onValueChange={onValueChange}>
        <Tabs.List>
          <Tabs.Tab value="one">Tab One</Tabs.Tab>
          <Tabs.Tab value="two">Tab Two</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="one">Panel One</Tabs.Panel>
        <Tabs.Panel value="two">Panel Two</Tabs.Panel>
      </Tabs>,
    );

    await user.click(screen.getByRole("tab", { name: "Tab Two" }));

    expect(onValueChange).toHaveBeenCalledWith("two");
  });

  it("keyboard: Home moves to first tab", async () => {
    const user = userEvent.setup();
    renderTabs({ defaultValue: "three" });

    const tabThree = screen.getByRole("tab", { name: "Tab Three" });
    tabThree.focus();

    await user.keyboard("{Home}");

    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tab One" })).toHaveAttribute("aria-selected", "true");
  });

  it("keyboard: End moves to last tab", async () => {
    const user = userEvent.setup();
    renderTabs();

    const tabOne = screen.getByRole("tab", { name: "Tab One" });
    tabOne.focus();

    await user.keyboard("{End}");

    expect(screen.getByRole("tab", { name: "Tab Three" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tab Three" })).toHaveAttribute("aria-selected", "true");
  });
});
