/**
 * Fractional indexing utility for lexicographic position ordering.
 *
 * Generates position strings that sort correctly using standard string
 * comparison (`<`), enabling efficient reordering (e.g. drag-and-drop)
 * without renumbering all items.
 *
 * Uses a base-62 character set: 0-9, A-Z, a-z.
 */

const BASE_62_DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const BASE = BASE_62_DIGITS.length; // 62

const SMALLEST_CHAR = BASE_62_DIGITS[0]; // '0'

const MID_CHAR_INDEX = Math.floor(BASE / 2); // 31 -> 'V'

/**
 * Return the integer index (0-61) of a base-62 character.
 */
function charToIndex(c: string): number {
  const idx = BASE_62_DIGITS.indexOf(c);
  if (idx === -1) {
    throw new Error(`Invalid fractional index character: "${c}"`);
  }
  return idx;
}

/**
 * Return the base-62 character for an integer index (0-61).
 */
function indexToChar(i: number): string {
  return BASE_62_DIGITS[i];
}

/**
 * Get the digit value at position `i` of string `s`.
 * Returns 0 for positions beyond the string's length (right-padding with '0').
 */
function getDigit(s: string, i: number): number {
  return i < s.length ? charToIndex(s[i]) : 0;
}

/**
 * Build a prefix string from the computed digit values up to position `end`.
 * This correctly handles cases where one input is shorter than the other
 * by using the actual padded digit values rather than slicing the original string.
 */
function buildPrefix(a: string, _b: string, end: number): string {
  let result = "";
  for (let i = 0; i < end; i++) {
    // Both digits should be equal in the shared prefix region.
    result += indexToChar(getDigit(a, i));
  }
  return result;
}

/**
 * Compute the midpoint string between `a` and `b` where `a < b` lexicographically.
 *
 * The algorithm walks character-by-character from left to right:
 * 1. While digits are equal, they become part of the shared prefix.
 * 2. At the first differing position (da < db):
 *    - If db - da > 1, pick a digit halfway between them.
 *    - If db - da == 1 (adjacent), keep da at this position and find a
 *      suffix greater than a's remaining suffix (midpoint between a's
 *      suffix and the conceptual maximum).
 * 3. If all digits match up to maxLen, a is shorter than b and they
 *    differ only by trailing zeros - extend and find a midpoint in the
 *    extended space.
 */
function midpoint(a: string, b: string): string {
  const maxLen = Math.max(a.length, b.length);

  for (let i = 0; i < maxLen; i++) {
    const da = getDigit(a, i);
    const db = getDigit(b, i);

    if (da === db) {
      continue;
    }

    if (da > db) {
      throw new Error(
        `midpoint: unexpected da > db at position ${i} (a="${a}", b="${b}")`,
      );
    }

    // da < db at position i. Build the shared prefix from actual digit values.
    const prefix = buildPrefix(a, b, i);

    if (db - da > 1) {
      // Room between da and db. Pick the midpoint digit.
      const mid = Math.floor((da + db) / 2);
      return prefix + indexToChar(mid);
    }

    // Adjacent digits (db - da === 1). Use da at this position and find
    // a suffix that is greater than a's remaining suffix.
    const aSuffix = i + 1 < a.length ? a.substring(i + 1) : "";
    const suffixResult = midpointSuffixAbove(aSuffix);
    return prefix + indexToChar(da) + suffixResult;
  }

  // All digits equal up to maxLen. Since a < b in JS string comparison,
  // a must be shorter (e.g. "a0" < "a00"). There is no string strictly
  // between them in lexicographic order. We handle this by going one
  // level deeper: treat b as having additional characters beyond maxLen.
  // The midpoint is a + midChar, which is > a (longer) and < b (since
  // b starts with the same prefix and any extension starting with '0'
  // sorts before extensions starting with a higher character... wait,
  // actually "a0" + "V" = "a0V" > "a00" since 'V' > '0').
  //
  // For b of length > a.length + 1, we can use the digits of b beyond a's
  // length. Let's handle this by padding a to b's length and trying again.
  // Since padding a with '0's makes it equal to b (or a prefix), we go
  // one character further.
  //
  // In practice, this degenerate case (e.g. "a0" vs "a00") means b is
  // a + "0" repeated. We can produce something between them by returning
  // a + "0" + midChar, which is > "a00" (wait, no - we need < b).
  //
  // Actually "a0" < "a00" < "a00V" - so "a00V" is NOT between "a0" and "a00".
  // There truly is no string between "a0" and "a00". Our key generation
  // must avoid producing keys that end in '0' (the smallest char), which
  // would create these degenerate adjacent pairs.
  //
  // Safety: if this ever happens, throw a clear error.
  throw new Error(
    `midpoint: no space between "${a}" and "${b}"`,
  );
}

/**
 * Find a suffix string that is greater than `suffix` but less than the
 * conceptual maximum ("zzz..."). Used when two adjacent digits force us
 * to go one level deeper.
 *
 * Strategy: scan from right to left for the rightmost non-max digit,
 * then set it to the midpoint between its value and max. If all digits
 * are max, append a middle character.
 */
function midpointSuffixAbove(suffix: string): string {
  if (suffix.length === 0) {
    return indexToChar(MID_CHAR_INDEX);
  }

  for (let i = suffix.length - 1; i >= 0; i--) {
    const d = charToIndex(suffix[i]);
    if (d < BASE - 1) {
      // Midpoint between d+1 and BASE-1, rounded up for better spacing.
      const mid = Math.ceil((d + 1 + (BASE - 1)) / 2);
      return suffix.slice(0, i) + indexToChar(Math.min(mid, BASE - 1));
    }
  }

  // All digits are max ('z'). Append a middle character.
  return suffix + indexToChar(MID_CHAR_INDEX);
}

/**
 * Generate a key after `s` (greater than `s`), keeping it short.
 *
 * Finds the rightmost non-max digit and bumps it up toward the midpoint
 * between its value and the max. Never produces trailing '0' characters.
 */
function generateKeyAfter(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    const d = charToIndex(s[i]);
    if (d < BASE - 1) {
      const mid = Math.ceil((d + 1 + (BASE - 1)) / 2);
      return s.slice(0, i) + indexToChar(Math.min(mid, BASE - 1));
    }
  }

  // All digits are max ('z'). Append a middle character.
  return s + indexToChar(MID_CHAR_INDEX);
}

/**
 * Generate a key before `s` (less than `s`), keeping it short.
 *
 * Avoids producing keys that end in '0' (the smallest char), which would
 * create degenerate cases in midpoint calculations.
 */
function generateKeyBefore(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    const d = charToIndex(s[i]);
    if (d > 1) {
      // Midpoint between 1 and d (avoid 0 as trailing digit).
      const mid = Math.max(Math.floor(d / 2), 1);
      return s.slice(0, i) + indexToChar(mid);
    }
    if (d === 1) {
      // Going to 0 would create a trailing-zero key. Instead, extend:
      // use '0' at this position and append a middle character.
      return s.slice(0, i) + SMALLEST_CHAR + indexToChar(MID_CHAR_INDEX);
    }
    // d === 0: keep looking leftward.
  }

  throw new Error(
    `Cannot generate a key before "${s}": all digits are at minimum`,
  );
}

/**
 * Validate that a key is a non-empty string of valid base-62 characters.
 */
function validateKey(key: string, label: string): void {
  if (key.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  for (const c of key) {
    if (BASE_62_DIGITS.indexOf(c) === -1) {
      throw new Error(`${label} contains invalid character: "${c}"`);
    }
  }
}

/**
 * Generate a position key that sorts between `a` and `b`.
 *
 * - Pass `null` for `a` to generate a key before `b` (insert at start).
 * - Pass `null` for `b` to generate a key after `a` (insert at end).
 * - Both `null` generates a midpoint key.
 *
 * @throws If `a >= b` when both are provided.
 */
export function generateKeyBetween(
  a: string | null,
  b: string | null,
): string {
  if (a !== null) validateKey(a, "a");
  if (b !== null) validateKey(b, "b");

  if (a !== null && b !== null) {
    if (a >= b) {
      throw new Error(
        `generateKeyBetween: a must be less than b (got a="${a}", b="${b}")`,
      );
    }
    return midpoint(a, b);
  }

  if (a === null && b === null) {
    return "a0";
  }

  if (a === null) {
    return generateKeyBefore(b!);
  }

  return generateKeyAfter(a);
}

/**
 * Generate `n` evenly spaced keys between `a` and `b`.
 *
 * - Pass `null` for either boundary (same semantics as `generateKeyBetween`).
 * - Returns an array of `n` keys in ascending order, all between `a` and `b`.
 *
 * @throws If `n < 0`, or if `a >= b` when both are provided.
 */
export function generateNKeysBetween(
  a: string | null,
  b: string | null,
  n: number,
): string[] {
  if (n < 0) {
    throw new Error("n must be non-negative");
  }

  if (n === 0) {
    return [];
  }

  if (n === 1) {
    return [generateKeyBetween(a, b)];
  }

  // Divide and conquer: generate the middle key, then recurse on both halves.
  const mid = Math.floor(n / 2);
  const midKey = generateKeyBetween(a, b);

  const left = generateNKeysBetween(a, midKey, mid);
  const right = generateNKeysBetween(midKey, b, n - mid - 1);

  return [...left, midKey, ...right];
}
