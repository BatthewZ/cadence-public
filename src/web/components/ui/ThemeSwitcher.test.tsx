import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSwitcher } from "./ThemeSwitcher";

const mockSetTheme = vi.fn();

vi.mock("@/web/hooks/use-theme", () => ({
  useTheme: () => ({
    theme: "default" as const,
    setTheme: mockSetTheme,
    themes: ["default", "noir", "botanical", "sunset", "candy", "cyberpunk", "pastel", "brutalist", "ocean", "ember", "luxe", "sakura", "melancholy", "storm", "dreamlike", "terminal", "synthwave", "forest", "slate", "paper", "carbon"] as const,
  }),
}));

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
  });

  it("renders a trigger button with the current theme label", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByRole("button", { name: /Minimal/i })).toBeDefined();
  });

  it("opens a menu when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole("button", { name: /Minimal/i }));
    expect(screen.getByRole("menu")).toBeDefined();
  });

  it("renders all 20 theme options as menu items", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole("button", { name: /Minimal/i }));
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(21);
  });

  it("calls setTheme when a menu item is clicked", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole("button", { name: /Minimal/i }));
    await user.click(screen.getByRole("menuitem", { name: /Noir/i }));
    expect(mockSetTheme).toHaveBeenCalledOnce();
    expect(mockSetTheme).toHaveBeenCalledWith("noir");
  });

  it("applies active class to the current theme item", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole("button", { name: /Minimal/i }));
    const minimalItem = screen.getByRole("menuitem", { name: /Minimal/i });
    expect(minimalItem.className).toContain("theme-switcher-item--active");
  });
});
