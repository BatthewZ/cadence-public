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
  default: "#2563eb",
  noir: "#e8b94a",
  botanical: "#4a6741",
  sunset: "#d4542c",
  candy: "#e63946",
  cyberpunk: "#e6247a",
  pastel: "#8b6aae",
  brutalist: "#0a0a0a",
  ocean: "#2a8a8a",
  ember: "#e88830",
  luxe: "#c4a44a",
  sakura: "#b07080",
  melancholy: "#b08a7a",
  storm: "#e0f0ff",
  dreamlike: "#b88aa0",
  terminal: "#33ff66",
  synthwave: "#f72585",
  forest: "#2d8a4e",
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
  ocean: ["#0c1424", "#2da89e", "#66d4d0", "#142030"],
  ember: ["#141010", "#c44e20", "#e88830", "#201818"],
  luxe: ["#121018", "#6e4a80", "#d4a85a", "#1c1a26"],
  sakura: ["#faf8f5", "#b07080", "#6a9a72", "#f5f2ed"],
  melancholy: ["#1a1e24", "#7a8a9e", "#b08a7a", "#22272e"],
  storm: ["#14161a", "#5a6a80", "#e0f0ff", "#1c2026"],
  dreamlike: ["#1a1220", "#b88aa0", "#7ac4b8", "#1e1628"],
  terminal: ["#0a0f0a", "#33ff66", "#ffb020", "#101a10"],
  synthwave: ["#0d0221", "#f72585", "#b429f9", "#160832"],
  forest: ["#0b130e", "#2d8a4e", "#c8963a", "#141e16"],
};
