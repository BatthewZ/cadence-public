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

/** Convert rgb(r, g, b) or similar to #hex for color inputs */
function toHex(raw: string): string {
  const v = raw.trim();
  // Already hex
  if (v.startsWith("#")) return v;

  // rgb(r, g, b) or rgb(r g b)
  const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    const hex = [r, g, b]
      .map((c) =>
        Math.round(Number(c))
          .toString(16)
          .padStart(2, "0")
      )
      .join("");
    return `#${hex}`;
  }

  return v;
}

export { getComputedVar, snapshotAll, toHex };
