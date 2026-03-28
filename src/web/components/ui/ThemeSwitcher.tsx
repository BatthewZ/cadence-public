import { Palette, RotateCcw } from "lucide-react";

import { type Theme, THEMES } from "@/shared/types/theme";
import { useThemeControl } from "@/web/contexts/ThemeControlContext";
import { useTheme } from "@/web/hooks/use-theme";
import { THEME_LABELS, THEME_SWATCHES } from "@/web/lib/theme-constants";
import { cn } from "@/web/util/style/style";

import { DropdownMenu } from "./DropdownMenu";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

interface ThemeSwitcherProps {
  className?: string;
}

/**
 * Context-aware theme switcher.
 *
 * When inside a workspace/project layout that provides ThemeControlContext:
 * - Shows scope label ("Workspace Theme" or "Project Theme")
 * - Hidden entirely for non-admins (canEdit === false)
 * - When project scope has an override, shows "Use Workspace Theme" reset option
 * - Calls context.setTheme() which triggers the API mutation
 *
 * When outside workspace context (ThemeEditor, Showcase, etc.):
 * - Falls back to local-only useTheme() behavior (localStorage)
 */
export function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  const themeControl = useThemeControl();
  const { theme: localTheme, setTheme: setLocalTheme } = useTheme();

  // If we have ThemeControlContext and user cannot edit, hide entirely
  if (themeControl && !themeControl.canEdit) {
    return null;
  }

  // Determine what theme to display and how to set it
  const currentTheme: Theme = themeControl ? themeControl.effectiveTheme : localTheme;
  const handleSetTheme = themeControl
    ? (t: Theme) => themeControl.setTheme(t)
    : setLocalTheme;

  const scopeLabel = themeControl
    ? themeControl.scope === "project"
      ? "Project Theme"
      : "Workspace Theme"
    : "Theme";

  const isPending = themeControl?.isPending ?? false;

  const showResetOption =
    themeControl?.scope === "project" && themeControl.hasProjectOverride;

  // We need an extra menu item index offset when reset option is shown
  const themeIndexOffset = showResetOption ? 1 : 0;

  return (
    <DropdownMenu placement="bottom-end">
      <Tooltip content={`Theme: ${THEME_LABELS[currentTheme]}`} placement="bottom">
        <DropdownMenu.Trigger
          className={cn("theme-switcher-trigger", className)}
          aria-label={`Theme: ${THEME_LABELS[currentTheme]}`}
        >
          <span
            className="theme-switcher-swatch"
            style={{ backgroundColor: THEME_SWATCHES[currentTheme] }}
          />
          <span className="theme-switcher-label">{THEME_LABELS[currentTheme]}</span>
          {isPending ? <Spinner size="sm" className="size-3.5" /> : <Palette size={14} />}
        </DropdownMenu.Trigger>
      </Tooltip>

      <DropdownMenu.Content>
        <DropdownMenu.Label>{scopeLabel}</DropdownMenu.Label>

        {showResetOption && (
          <>
            <DropdownMenu.Item
              index={0}
              onSelect={() => themeControl.setTheme(null)}
              icon={<RotateCcw size={14} />}
            >
              Use Workspace Theme
            </DropdownMenu.Item>
            <DropdownMenu.Divider />
          </>
        )}

        {THEMES.map((t, i) => (
          <DropdownMenu.Item
            key={t}
            index={i + themeIndexOffset}
            onSelect={() => handleSetTheme(t)}
            className={cn(currentTheme === t && "theme-switcher-item--active")}
            icon={
              <span
                className="theme-switcher-swatch"
                style={{ backgroundColor: THEME_SWATCHES[t] }}
              />
            }
          >
            {THEME_LABELS[t]}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
