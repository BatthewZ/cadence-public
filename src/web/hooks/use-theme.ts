import { useCallback, useEffect, useSyncExternalStore } from "react";

import { type Theme, THEMES } from "@/shared/types/theme";

export { THEMES };

export const STORAGE_KEY = "theme";

function getSnapshot(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return THEMES.includes(attr as Theme) ? (attr as Theme) : "default";
}

function getServerSnapshot(): Theme {
  return "default";
}

function subscribe(callback: () => void) {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === "data-theme") {
        callback();
        break;
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    if (next === "default") {
      document.documentElement.removeAttribute("data-theme");
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* private browsing */ }
    } else {
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private browsing */ }
    }
  }, []);

  return { theme, setTheme, themes: THEMES };
}

/**
 * Resolves and applies the effective theme based on the hierarchical resolution:
 * project theme > workspace theme > "default" (Minimal).
 *
 * Sets `data-theme` on `<html>` and caches to localStorage for FOUC prevention.
 * Returns the resolved effective theme.
 *
 * The validation against THEMES ensures that stale or invalid theme strings from
 * the database never propagate to the DOM — they fall back safely to "default".
 */
export function useThemeApplication(
  workspaceTheme: string | null | undefined,
  projectTheme: string | null | undefined,
): Theme {
  const raw = projectTheme ?? workspaceTheme ?? "default";
  const effective: Theme = THEMES.includes(raw as Theme) ? (raw as Theme) : "default";

  useEffect(() => {
    if (effective === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", effective);
    }
    // Cache to localStorage so the FOUC prevention script in index.html
    // can restore it on next page load before CSS paints.
    // Use removeItem for "default" to match useTheme.setTheme("default") behavior.
    try {
      if (effective === "default") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, effective);
      }
    } catch { /* private browsing */ }
  }, [effective]);

  return effective;
}

/**
 * Temporarily previews a theme on the document while active, without touching
 * localStorage. Restores the previous theme when the preview theme changes,
 * deactivates, or the component unmounts.
 *
 * This exists so that selecting a theme in the Create Project dialog gives
 * immediate visual feedback without persisting anything until the project is
 * actually created.
 */
export function useThemePreview(previewTheme: Theme | null, active: boolean) {
  useEffect(() => {
    if (!active || previewTheme === null) return;

    const previous = document.documentElement.getAttribute("data-theme") ?? null;

    if (previewTheme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", previewTheme);
    }

    return () => {
      if (previous === null) {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", previous);
      }
    };
  }, [previewTheme, active]);
}

export type { Theme };
