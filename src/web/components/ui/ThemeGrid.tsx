import { Check } from "lucide-react";

import { type Theme, THEMES } from "@/shared/types/theme";
import { THEME_LABELS, THEME_PALETTES } from "@/web/lib/theme-constants";

import { Text } from "./Text";

interface ThemeGridProps {
  /** The currently active (selected) theme, or null if no override is set */
  activeTheme: Theme | null;
  /** Called when the user selects a theme */
  onSelect: (theme: Theme) => void;
  /** Disables all theme buttons (e.g. while a mutation is in-flight) */
  disabled?: boolean;
  /**
   * Optional "highlighted" theme — shown with an accent border but no check.
   * Used in project settings to indicate the inherited workspace theme when
   * no project override is active.
   */
  highlightedTheme?: Theme;
}

/**
 * Shared theme selection grid used in both WorkspaceSettings and ProjectSettings.
 * Renders all available themes as clickable swatch cards in a responsive grid.
 *
 * This component exists to eliminate duplication between the two settings pages
 * and ensure consistent styling and behavior for theme selection.
 */
export function ThemeGrid({
  activeTheme,
  onSelect,
  disabled = false,
  highlightedTheme,
}: ThemeGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {THEMES.map((t) => {
        const isActive = activeTheme === t;
        const isHighlighted = !isActive && highlightedTheme === t;
        return (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(t)}
            className={`
              relative flex flex-col items-center gap-2 rounded-lg border p-3
              transition-all duration-fast cursor-pointer
              hover:shadow-md hover:-translate-y-0.5
              focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2
              ${isActive
                ? "border-accent bg-accent-subtle shadow-sm"
                : isHighlighted
                  ? "border-accent/40 bg-surface-0"
                  : "border-border-default bg-surface-0 hover:border-accent/30"
              }
            `}
          >
            {/* Multi-color preview strip showing canvas, primary, accent, and surface */}
            <div
              className="w-full h-6 rounded-md overflow-hidden border border-border-default shadow-sm flex"
              aria-hidden="true"
            >
              {THEME_PALETTES[t].map((color, ci) => (
                <span
                  key={ci}
                  className="flex-1 h-full"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <Text
              variant="body-3"
              weight={isActive ? "semibold" : undefined}
              className={isActive ? "text-accent" : ""}
            >
              {THEME_LABELS[t]}
            </Text>
            {isActive && (
              <div className="absolute top-1.5 right-1.5">
                <Check size={14} className="text-accent" />
              </div>
            )}
            {isHighlighted && (
              <Text variant="body-3" color="muted" className="text-[10px]">
                inherited
              </Text>
            )}
          </button>
        );
      })}
    </div>
  );
}
