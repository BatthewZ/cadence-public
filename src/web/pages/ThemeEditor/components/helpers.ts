import { formatHex, parse } from "culori";

import { ALL_TOKENS } from "./token-constants";

/** Read the current computed value for a CSS variable */
function getComputedVar(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

/** Snapshot every token's current computed value */
function snapshotAll(): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const t of ALL_TOKENS) {
    snap[t.variable] = getComputedVar(t.variable);
  }
  return snap;
}

/** Convert any CSS color (hex, rgb, oklch, hsl, etc.) to #hex for color inputs */
function toHex(raw: string): string {
  const v = raw.trim();
  if (v.startsWith("#")) return v;

  const parsed = parse(v);
  if (parsed) return formatHex(parsed);

  return v;
}

export { getComputedVar, snapshotAll, toHex };
