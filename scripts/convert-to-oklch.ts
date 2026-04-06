/**
 * One-off conversion script: hex/rgb → oklch across design token files.
 *
 * Operates on an explicit allowlist of project source paths only — never
 * walks node_modules, .git, or any non-source directory.
 *
 * Usage:  bun run scripts/convert-to-oklch.ts
 */

import { parse, converter } from "culori";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const toOklch = converter("oklch");

/* ---------- helpers ---------- */

/** Round to N decimal places */
function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Convert a parsed culori color to an oklch() CSS string with sensible precision */
function toOklchString(color: ReturnType<typeof parse>): string | null {
  if (!color) return null;
  const oklch = toOklch(color);
  if (!oklch) return null;

  const l = round(oklch.l, 4);
  const c = round(oklch.c, 4);
  // Hue can be NaN for achromatic colors (black, white, grays)
  const h = oklch.h == null || Number.isNaN(oklch.h) ? 0 : round(oklch.h, 2);

  if (oklch.alpha !== undefined && oklch.alpha < 1) {
    return `oklch(${l} ${c} ${h} / ${round(oklch.alpha, 4)})`;
  }
  return `oklch(${l} ${c} ${h})`;
}

/* ---------- CSS conversion ---------- */

/**
 * Match hex colors: #abc or #aabbcc or #aabbccdd
 * Negative lookbehind avoids matching inside URLs or other non-color contexts.
 */
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g;

/**
 * Match rgb()/rgba() with numeric values.
 * Handles both comma-separated and space-separated syntax, with optional alpha.
 */
const RGB_RE = /rgba?\(\s*[\d.]+[\s,/]+[\d.]+[\s,/]+[\d.]+(?:[\s,/]+[\d.]+)?\s*\)/g;

/** Replace `color-mix(in srgb,` with `color-mix(in oklch,` */
const COLOR_MIX_RE = /color-mix\(\s*in\s+srgb\s*,/g;

function convertCssFile(filePath: string): void {
  const abs = resolve(ROOT, filePath);
  let content = readFileSync(abs, "utf-8");
  let changes = 0;

  // 1. Convert hex → oklch
  content = content.replace(HEX_RE, (match) => {
    const parsed = parse(match);
    const oklch = toOklchString(parsed);
    if (oklch) {
      changes++;
      return oklch;
    }
    return match;
  });

  // 2. Convert rgb()/rgba() → oklch()
  content = content.replace(RGB_RE, (match) => {
    const parsed = parse(match);
    const oklch = toOklchString(parsed);
    if (oklch) {
      changes++;
      return oklch;
    }
    return match;
  });

  // 3. Switch color-mix interpolation space
  content = content.replace(COLOR_MIX_RE, (match) => {
    changes++;
    return "color-mix(in oklch,";
  });

  writeFileSync(abs, content, "utf-8");
  console.log(`  ${filePath}: ${changes} conversions`);
}

/* ---------- TS conversion ---------- */

/**
 * For TS files, only convert hex strings inside quotes: "#aabbcc"
 * This avoids touching unrelated code.
 */
const TS_HEX_IN_QUOTES_RE = /(["'])#(?:[0-9a-fA-F]{3,4}){1,2}\1/g;

function convertTsFile(filePath: string): void {
  const abs = resolve(ROOT, filePath);
  let content = readFileSync(abs, "utf-8");
  let changes = 0;

  content = content.replace(TS_HEX_IN_QUOTES_RE, (match, quote) => {
    const hex = match.slice(1, -1); // strip quotes
    const parsed = parse(hex);
    const oklch = toOklchString(parsed);
    if (oklch) {
      changes++;
      return `${quote}${oklch}${quote}`;
    }
    return match;
  });

  writeFileSync(abs, content, "utf-8");
  console.log(`  ${filePath}: ${changes} conversions`);
}

/* ---------- Explicit file list ---------- */

const CSS_FILES = [
  // Base tokens
  "src/web/style/tokens/colors.css",
  "src/web/style/tokens/shadows.css",
  "src/web/style/tokens/overlay.css",

  // Theme files
  "src/web/style/themes/botanical.css",
  "src/web/style/themes/brutalist.css",
  "src/web/style/themes/candy.css",
  "src/web/style/themes/cyberpunk.css",
  "src/web/style/themes/dreamlike.css",
  "src/web/style/themes/ember.css",
  "src/web/style/themes/forest.css",
  "src/web/style/themes/luxe.css",
  "src/web/style/themes/melancholy.css",
  "src/web/style/themes/noir.css",
  "src/web/style/themes/ocean.css",
  "src/web/style/themes/pastel.css",
  "src/web/style/themes/sakura.css",
  "src/web/style/themes/storm.css",
  "src/web/style/themes/sunset.css",
  "src/web/style/themes/synthwave.css",
  "src/web/style/themes/terminal.css",

  // Component CSS with color-mix / rgb
  "src/web/style/components/theme-bubble.css",
  "src/web/style/components/task-filter-bar.css",
  "src/web/style/components/table.css",
  "src/web/style/components/notification.css",
  "src/web/style/components/landing.css",
  "src/web/style/components/label.css",
  "src/web/style/components/auth-layout.css",
  "src/web/style/components/carousel.css",
  "src/web/style/components/command-palette.css",
];

const TS_FILES = [
  "src/web/lib/theme-constants.ts",
  "src/web/pages/Landing/components/constants.ts",
  "src/web/pages/ProjectSettings/ProjectSettings.test.tsx",
  "src/web/components/ui/HoldToDeleteButton.tsx",
  "src/web/components/layout/AuthLayout.tsx",
];

/* ---------- Run ---------- */

console.log("Converting CSS files to oklch...");
for (const file of CSS_FILES) {
  convertCssFile(file);
}

console.log("\nConverting TS/TSX files to oklch...");
for (const file of TS_FILES) {
  convertTsFile(file);
}

console.log("\nDone!");
