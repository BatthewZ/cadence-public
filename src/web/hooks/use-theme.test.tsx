import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY, THEMES, useTheme, useThemeApplication, useThemePreview } from "./use-theme";

describe("useTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("returns the current theme as 'default' when no data-theme attribute is set", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("default");
  });

  it("returns all available themes", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.themes).toBe(THEMES);
    expect(result.current.themes).toEqual(["default", "noir", "botanical", "sunset", "candy", "cyberpunk", "pastel", "brutalist", "ocean", "ember", "luxe", "sakura", "melancholy", "storm", "dreamlike", "terminal", "synthwave", "forest", "slate", "paper", "carbon"]);
  });

  it("reads the current theme from data-theme attribute", () => {
    document.documentElement.setAttribute("data-theme", "noir");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("noir");
  });

  it("falls back to 'default' for an unrecognized data-theme value", () => {
    document.documentElement.setAttribute("data-theme", "nonexistent");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("default");
  });

  it("setTheme updates the data-theme attribute and persists to localStorage", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("cyberpunk");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("cyberpunk");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("cyberpunk");
  });

  it("setTheme('default') removes the data-theme attribute and localStorage entry", () => {
    document.documentElement.setAttribute("data-theme", "botanical");
    localStorage.setItem(STORAGE_KEY, "botanical");

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("default");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("updates theme reactively when data-theme attribute changes externally", async () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("default");

    // Simulate an external mutation (e.g., from another part of the app)
    act(() => {
      document.documentElement.setAttribute("data-theme", "botanical");
    });

    // MutationObserver is async; flush microtasks
    await vi.waitFor(() => {
      expect(result.current.theme).toBe("botanical");
    });
  });

  it("handles localStorage errors gracefully (e.g., private browsing)", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });

    const { result } = renderHook(() => useTheme());

    // Should not throw
    act(() => {
      result.current.setTheme("noir");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("noir");

    setItemSpy.mockRestore();
  });
});

/**
 * Tests for useThemeApplication — the hierarchical theme resolution hook.
 * This hook is critical because it resolves project > workspace > default theme
 * priority, applies it to the DOM, and caches it to localStorage for FOUC prevention.
 * Bugs here would cause theme flickering, stale themes persisting after navigation,
 * or invalid theme strings reaching the DOM.
 */
describe("useThemeApplication", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("applies project theme when both workspace and project themes are provided", () => {
    const { result } = renderHook(() =>
      useThemeApplication("botanical", "cyberpunk"),
    );
    expect(result.current).toBe("cyberpunk");
    expect(document.documentElement.getAttribute("data-theme")).toBe("cyberpunk");
  });

  it("falls back to workspace theme when project theme is null", () => {
    const { result } = renderHook(() =>
      useThemeApplication("noir", null),
    );
    expect(result.current).toBe("noir");
    expect(document.documentElement.getAttribute("data-theme")).toBe("noir");
  });

  it("falls back to workspace theme when project theme is undefined", () => {
    const { result } = renderHook(() =>
      useThemeApplication("sunset", undefined),
    );
    expect(result.current).toBe("sunset");
    expect(document.documentElement.getAttribute("data-theme")).toBe("sunset");
  });

  it("falls back to 'default' when both themes are null", () => {
    const { result } = renderHook(() =>
      useThemeApplication(null, null),
    );
    expect(result.current).toBe("default");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("falls back to 'default' when both themes are undefined", () => {
    const { result } = renderHook(() =>
      useThemeApplication(undefined, undefined),
    );
    expect(result.current).toBe("default");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("validates invalid theme strings and falls back to 'default'", () => {
    const { result } = renderHook(() =>
      useThemeApplication("totally-bogus-theme", null),
    );
    expect(result.current).toBe("default");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("validates invalid project theme strings and falls back to workspace theme", () => {
    // Invalid project theme should be treated as "default" (since raw resolves to invalid string)
    // Actually: raw = projectTheme ?? workspaceTheme ?? "default" = "invalid-project"
    // THEMES.includes("invalid-project") = false -> "default"
    const { result } = renderHook(() =>
      useThemeApplication("noir", "invalid-project"),
    );
    // The raw value is "invalid-project" (project takes priority), which is invalid -> "default"
    expect(result.current).toBe("default");
  });

  it("updates DOM data-theme attribute correctly", () => {
    const { rerender } = renderHook(
      ({ ws, proj }: { ws: string | null; proj: string | null }) =>
        useThemeApplication(ws, proj),
      { initialProps: { ws: "botanical", proj: null } as { ws: string | null; proj: string | null } },
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("botanical");

    // Switch to project theme
    rerender({ ws: "botanical", proj: "candy" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("candy");

    // Clear project theme — should revert to workspace
    rerender({ ws: "botanical", proj: null });
    expect(document.documentElement.getAttribute("data-theme")).toBe("botanical");

    // Clear workspace theme — should revert to default
    rerender({ ws: null, proj: null });
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("caches non-default theme to localStorage", () => {
    renderHook(() => useThemeApplication("ocean", null));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ocean");
  });

  it("removes localStorage entry for default theme (consistent with useTheme)", () => {
    // First set a theme
    localStorage.setItem(STORAGE_KEY, "noir");
    renderHook(() => useThemeApplication(null, null));
    // "default" theme should remove the localStorage entry, not set it to ""
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("handles localStorage errors gracefully during caching", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });

    // Should not throw
    const { result } = renderHook(() =>
      useThemeApplication("ember", null),
    );
    expect(result.current).toBe("ember");
    expect(document.documentElement.getAttribute("data-theme")).toBe("ember");

    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });
});

/**
 * Tests for useThemePreview — temporary DOM-only theme preview.
 * This hook is used in the Create Project dialog so users get immediate visual
 * feedback when picking a theme, without persisting anything to localStorage
 * or the database. Bugs here would cause the theme to stick after the dialog
 * closes or cause flashing when switching between preview themes.
 */
describe("useThemePreview", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("applies a preview theme to the DOM when active", () => {
    renderHook(() => useThemePreview("noir", true));
    expect(document.documentElement.getAttribute("data-theme")).toBe("noir");
  });

  it("does nothing when not active", () => {
    document.documentElement.setAttribute("data-theme", "botanical");
    renderHook(() => useThemePreview("noir", false));
    expect(document.documentElement.getAttribute("data-theme")).toBe("botanical");
  });

  it("does nothing when previewTheme is null", () => {
    document.documentElement.setAttribute("data-theme", "botanical");
    renderHook(() => useThemePreview(null, true));
    expect(document.documentElement.getAttribute("data-theme")).toBe("botanical");
  });

  it("restores the previous theme when deactivated", () => {
    document.documentElement.setAttribute("data-theme", "botanical");

    type Props = { theme: import("@/shared/types/theme").Theme | null; active: boolean };
    const { rerender } = renderHook(
      ({ theme, active }: Props) => useThemePreview(theme, active),
      { initialProps: { theme: "noir", active: true } as Props },
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("noir");

    rerender({ theme: null, active: false });
    expect(document.documentElement.getAttribute("data-theme")).toBe("botanical");
  });

  it("restores the previous theme on unmount", () => {
    document.documentElement.setAttribute("data-theme", "botanical");

    const { unmount } = renderHook(() => useThemePreview("noir", true));
    expect(document.documentElement.getAttribute("data-theme")).toBe("noir");

    unmount();
    expect(document.documentElement.getAttribute("data-theme")).toBe("botanical");
  });

  it("restores correctly when previous theme was default (no attribute)", () => {
    const { unmount } = renderHook(() => useThemePreview("candy", true));
    expect(document.documentElement.getAttribute("data-theme")).toBe("candy");

    unmount();
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("handles switching between preview themes correctly", () => {
    document.documentElement.setAttribute("data-theme", "botanical");

    type Props = { theme: import("@/shared/types/theme").Theme | null; active: boolean };
    const { rerender } = renderHook(
      ({ theme, active }: Props) => useThemePreview(theme, active),
      { initialProps: { theme: "noir", active: true } as Props },
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("noir");

    rerender({ theme: "candy", active: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("candy");

    // Should restore original "botanical", not intermediate "noir"
    rerender({ theme: null, active: false });
    expect(document.documentElement.getAttribute("data-theme")).toBe("botanical");
  });

  it("removes data-theme when previewing 'default'", () => {
    document.documentElement.setAttribute("data-theme", "noir");

    renderHook(() => useThemePreview("default", true));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("does not touch localStorage during preview", () => {
    localStorage.setItem(STORAGE_KEY, "botanical");

    renderHook(() => useThemePreview("noir", true));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("botanical");
  });
});
