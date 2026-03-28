import { createContext, type ReactNode, useContext } from "react";

import type { Theme } from "@/shared/types/theme";

/**
 * Bridges theme control state from layouts (WorkspaceLayout / ProjectLayout)
 * to the ThemeSwitcher in the navbar. This is necessary because the ThemeSwitcher
 * sits in WorkspaceLayout's navbar, but needs to know about the project context
 * which is nested inside.
 *
 * - WorkspaceLayout provides a default value (scope: "workspace")
 * - ProjectLayout overrides with project-scoped values (scope: "project")
 * - ThemeSwitcher reads from this context and renders nothing when canEdit is false
 */
export interface ThemeControlValue {
  /** Whether we're currently scoped to a workspace or project */
  scope: "workspace" | "project";
  /** Whether the current user can edit the theme (owner/admin only) */
  canEdit: boolean;
  /** The resolved effective theme (after project > workspace > default fallback) */
  effectiveTheme: Theme;
  /** Mutation handler — sets the theme for the current scope via API */
  setTheme: (theme: Theme | null) => void;
  /** True when the project has its own theme override (not inheriting from workspace) */
  hasProjectOverride: boolean;
  /** True when a theme mutation is in-flight (API has not yet responded) */
  isPending: boolean;
}

const ThemeControlContext = createContext<ThemeControlValue | null>(null);

interface ThemeControlProviderProps {
  value: ThemeControlValue;
  children: ReactNode;
}

export function ThemeControlProvider({ value, children }: ThemeControlProviderProps) {
  return (
    <ThemeControlContext.Provider value={value}>
      {children}
    </ThemeControlContext.Provider>
  );
}

/**
 * Returns the current theme control context or null if outside a workspace.
 * The ThemeSwitcher uses this — null means we fall back to the local-only
 * useTheme() behavior (for pages like ThemeEditor, Showcase, etc.).
 */
export function useThemeControl(): ThemeControlValue | null {
  return useContext(ThemeControlContext);
}

/* ------------------------------------------------------------------ */
/*  ThemeOverrideContext                                                */
/* ------------------------------------------------------------------ */

/**
 * Allows a nested layout (ProjectLayout) to communicate its theme control
 * value upward to the parent layout (WorkspaceLayout) without nesting
 * ThemeControlProviders. WorkspaceLayout provides the setter; ProjectLayout
 * calls it on mount and clears it on unmount. This ensures the single
 * ThemeControlProvider in WorkspaceLayout always reflects the correct scope,
 * and the theme reverts to workspace level when leaving a project.
 */
type ThemeOverrideSetter = (override: ThemeControlValue | null) => void;

const ThemeOverrideContext = createContext<ThemeOverrideSetter | null>(null);

/**
 * Returns the setter function that ProjectLayout uses to push its theme
 * control up to WorkspaceLayout. Returns null if outside the provider.
 */
export function useSetThemeOverride(): ThemeOverrideSetter | null {
  return useContext(ThemeOverrideContext);
}

interface ThemeOverrideProviderProps {
  children: ReactNode;
  onOverride: ThemeOverrideSetter;
}

export function ThemeOverrideProvider({ children, onOverride }: ThemeOverrideProviderProps) {
  return (
    <ThemeOverrideContext.Provider value={onOverride}>
      {children}
    </ThemeOverrideContext.Provider>
  );
}
