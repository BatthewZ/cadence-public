import type { Theme } from "@/shared/types/theme";

/** Human-readable label for each theme. */
export const THEME_LABELS: Record<Theme, string> = {
  default: "Minimal",
  noir: "Noir",
  botanical: "Botanical",
  sunset: "Sunset",
  candy: "Candy",
  cyberpunk: "Cyberpunk",
  pastel: "Pastel",
  brutalist: "Brutalist",
  ocean: "Ocean",
  ember: "Ember",
  luxe: "Luxe",
  sakura: "Sakura",
  melancholy: "Melancholy",
  storm: "Storm",
  dreamlike: "Dreamlike",
  terminal: "Terminal",
  synthwave: "Synthwave",
  forest: "Forest",
};

/** Accent color swatch per theme — used for visual indicators in theme selectors. */
export const THEME_SWATCHES: Record<Theme, string> = {
  default: "oklch(0.5461 0.2152 262.88)",
  noir: "oklch(0.8081 0.1369 85.54)",
  botanical: "oklch(0.4803 0.0682 138.46)",
  sunset: "oklch(0.6082 0.1704 37.36)",
  candy: "oklch(0.6122 0.2082 22.24)",
  cyberpunk: "oklch(0.6099 0.229 1.38)",
  pastel: "oklch(0.5842 0.1072 305.65)",
  brutalist: "oklch(0.1448 0 0)",
  ocean: "oklch(0.5796 0.0864 195.03)",
  ember: "oklch(0.7158 0.1518 58.2)",
  luxe: "oklch(0.7298 0.1149 89.68)",
  sakura: "oklch(0.6178 0.0834 3.55)",
  melancholy: "oklch(0.6651 0.0521 43.96)",
  storm: "oklch(0.9477 0.0265 246.34)",
  dreamlike: "oklch(0.6842 0.0631 348.61)",
  terminal: "oklch(0.8755 0.2493 146.58)",
  synthwave: "oklch(0.6429 0.2436 0.71)",
  forest: "oklch(0.5637 0.1266 151.58)",
};

/**
 * Key color palette per theme — canvas, primary, accent, surface.
 * Used in the ThemeGrid to provide a richer visual preview of each theme
 * beyond a single swatch dot.
 */
export const THEME_PALETTES: Record<Theme, [string, string, string, string]> = {
  default: ["oklch(1 0 0)", "oklch(0.2795 0.0368 260.03)", "oklch(0.5461 0.2152 262.88)", "oklch(0.9846 0.0017 247.84)"],
  noir: ["oklch(0.207 0.0075 67.39)", "oklch(0.7482 0.1212 81.46)", "oklch(0.8081 0.1369 85.54)", "oklch(0.2546 0.0178 82.17)"],
  botanical: ["oklch(0.9746 0.009 78.28)", "oklch(0.4803 0.0682 138.46)", "oklch(0.6444 0.1046 50.97)", "oklch(0.9543 0.0136 78.26)"],
  sunset: ["oklch(0.9923 0.0062 75.41)", "oklch(0.6082 0.1704 37.36)", "oklch(0.7296 0.1488 63.01)", "oklch(0.9816 0.0124 75.37)"],
  candy: ["oklch(1 0 0)", "oklch(0.6122 0.2082 22.24)", "oklch(0.5461 0.2152 262.88)", "oklch(0.992 0.0034 67.78)"],
  cyberpunk: ["oklch(0.1505 0.0214 283.53)", "oklch(0.6099 0.229 1.38)", "oklch(0.8442 0.1457 209.29)", "oklch(0.1999 0.0318 283.14)"],
  pastel: ["oklch(0.9619 0.0143 308.3)", "oklch(0.5842 0.1072 305.65)", "oklch(0.7367 0.1156 9.32)", "oklch(0.9512 0.0172 308.26)"],
  brutalist: ["oklch(1 0 0)", "oklch(0.1448 0 0)", "oklch(0.5771 0.2152 27.33)", "oklch(0.9702 0 0)"],
  ocean: ["oklch(0.1925 0.0348 263.28)", "oklch(0.6641 0.105 186.86)", "oklch(0.8046 0.1011 192.14)", "oklch(0.2407 0.0353 255.88)"],
  ember: ["oklch(0.178 0.0067 17.8)", "oklch(0.5741 0.1616 39.71)", "oklch(0.7158 0.1518 58.2)", "oklch(0.2188 0.0129 18.18)"],
  luxe: ["oklch(0.1794 0.0165 296.16)", "oklch(0.471 0.0941 313.78)", "oklch(0.756 0.1093 80.19)", "oklch(0.2257 0.0232 292.07)"],
  sakura: ["oklch(0.9798 0.0045 78.3)", "oklch(0.6178 0.0834 3.55)", "oklch(0.6407 0.0789 148.97)", "oklch(0.9621 0.0074 80.72)"],
  melancholy: ["oklch(0.2336 0.0131 258.37)", "oklch(0.6276 0.0355 254.09)", "oklch(0.6651 0.0521 43.96)", "oklch(0.2708 0.0149 256.8)"],
  storm: ["oklch(0.1998 0.0086 264.36)", "oklch(0.5194 0.04 256.41)", "oklch(0.9477 0.0265 246.34)", "oklch(0.2421 0.0129 258.37)"],
  dreamlike: ["oklch(0.1994 0.0298 309.97)", "oklch(0.6842 0.0631 348.61)", "oklch(0.7684 0.0762 182.83)", "oklch(0.2191 0.0361 304)"],
  terminal: ["oklch(0.161 0.0131 144.94)", "oklch(0.8755 0.2493 146.58)", "oklch(0.8131 0.165 75.04)", "oklch(0.2044 0.0244 144.62)"],
  synthwave: ["oklch(0.1418 0.0662 295.8)", "oklch(0.6429 0.2436 0.71)", "oklch(0.6032 0.2805 310.29)", "oklch(0.1878 0.0779 292.65)"],
  forest: ["oklch(0.1766 0.016 156.92)", "oklch(0.5637 0.1266 151.58)", "oklch(0.7043 0.1224 79.38)", "oklch(0.2223 0.0212 150.47)"],
};
