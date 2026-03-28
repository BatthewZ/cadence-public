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
  chalk: "Chalk",
  ocean: "Ocean",
  ember: "Ember",
  luxe: "Luxe",
  deco: "Deco",
  sakura: "Sakura",
};

/** Accent color swatch per theme — used for visual indicators in theme selectors. */
export const THEME_SWATCHES: Record<Theme, string> = {
  default: "#2563eb",
  noir: "#e8b94a",
  botanical: "#4a6741",
  sunset: "#d4542c",
  candy: "#e63946",
  cyberpunk: "#e6247a",
  pastel: "#8b6aae",
  brutalist: "#0a0a0a",
  chalk: "#f0c87c",
  ocean: "#2a8a8a",
  ember: "#e88830",
  luxe: "#c4a44a",
  deco: "#c4a44a",
  sakura: "#b07080",
};

/**
 * Key color palette per theme — canvas, primary, accent, surface.
 * Used in the ThemeGrid to provide a richer visual preview of each theme
 * beyond a single swatch dot.
 */
export const THEME_PALETTES: Record<Theme, [string, string, string, string]> = {
  default: ["#ffffff", "#1e293b", "#2563eb", "#f9fafb"],
  noir: ["#1a1714", "#d4a54a", "#e8b94a", "#272219"],
  botanical: ["#faf6f0", "#4a6741", "#c07a50", "#f5efe6"],
  sunset: ["#fffcf8", "#d4542c", "#e89030", "#fef8f0"],
  candy: ["#ffffff", "#e63946", "#2563eb", "#fefcfa"],
  cyberpunk: ["#0a0a14", "#e6247a", "#00e5ff", "#141424"],
  pastel: ["#f5f0fa", "#8b6aae", "#e88a9a", "#f2ecf8"],
  brutalist: ["#ffffff", "#0a0a0a", "#dc2626", "#f5f5f5"],
  chalk: ["#1e2a22", "#e8dcc8", "#f0c87c", "#28352c"],
  ocean: ["#0c1424", "#2da89e", "#66d4d0", "#142030"],
  ember: ["#141010", "#c44e20", "#e88830", "#201818"],
  luxe: ["#121018", "#6e4a80", "#d4a85a", "#1c1a26"],
  deco: ["#080c1a", "#c4a44a", "#d4b86a", "#121830"],
  sakura: ["#faf8f5", "#b07080", "#6a9a72", "#f5f2ed"],
};
