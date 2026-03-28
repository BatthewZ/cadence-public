import { describe, expect, it } from "vitest";

import { generateKeyBetween, generateNKeysBetween } from "./fractional-index";

describe("generateKeyBetween", () => {
  it("returns a valid key when both boundaries are null", () => {
    const key = generateKeyBetween(null, null);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
    expect(key).toBe("a0");
  });

  it("returns a key less than the input when a is null", () => {
    const key = generateKeyBetween(null, "a0");
    expect(key < "a0").toBe(true);
  });

  it("returns a key greater than the input when b is null", () => {
    const key = generateKeyBetween("a0", null);
    expect(key > "a0").toBe(true);
  });

  it("returns a key between a and b", () => {
    const mid = generateKeyBetween("a0", "a1");
    expect(mid > "a0").toBe(true);
    expect(mid < "a1").toBe(true);
  });

  it("returns a key between two close keys", () => {
    const mid = generateKeyBetween("a0", "a1");
    const mid2 = generateKeyBetween("a0", mid);
    expect(mid2 > "a0").toBe(true);
    expect(mid2 < mid).toBe(true);
  });

  it("handles widely spaced keys", () => {
    const mid = generateKeyBetween("A0", "z0");
    expect(mid > "A0").toBe(true);
    expect(mid < "z0").toBe(true);
  });

  it("maintains order for multiple sequential insertions at the end", () => {
    const keys: string[] = [];
    let last: string | null = null;

    for (let i = 0; i < 20; i++) {
      const key = generateKeyBetween(last, null);
      if (last !== null) {
        expect(key > last).toBe(true);
      }
      keys.push(key);
      last = key;
    }

    // Verify all keys are strictly ascending.
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("maintains order for multiple sequential insertions at the start", () => {
    const keys: string[] = [];
    let first: string | null = null;

    for (let i = 0; i < 20; i++) {
      const key = generateKeyBetween(null, first);
      if (first !== null) {
        expect(key < first).toBe(true);
      }
      keys.push(key);
      first = key;
    }

    // Verify all keys are strictly descending (since we prepend each time).
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] < keys[i - 1]).toBe(true);
    }
  });

  it("inserts between adjacent items correctly", () => {
    const a = generateKeyBetween(null, null); // "a0"
    const b = generateKeyBetween(a, null);    // something > "a0"

    const between = generateKeyBetween(a, b);
    expect(between > a).toBe(true);
    expect(between < b).toBe(true);

    // Now insert between a and between.
    const between2 = generateKeyBetween(a, between);
    expect(between2 > a).toBe(true);
    expect(between2 < between).toBe(true);
  });

  it("throws when a >= b", () => {
    expect(() => generateKeyBetween("b", "a")).toThrow();
    expect(() => generateKeyBetween("a", "a")).toThrow();
  });

  it("throws when a equals b", () => {
    expect(() => generateKeyBetween("a0", "a0")).toThrow();
  });

  it("throws on invalid characters in keys", () => {
    expect(() => generateKeyBetween("a0!", null)).toThrow();
    expect(() => generateKeyBetween(null, "a 0")).toThrow();
  });

  it("throws on empty string keys", () => {
    expect(() => generateKeyBetween("", null)).toThrow();
    expect(() => generateKeyBetween(null, "")).toThrow();
  });
});

describe("generateNKeysBetween", () => {
  it("returns an empty array when n is 0", () => {
    const keys = generateNKeysBetween(null, null, 0);
    expect(keys).toEqual([]);
  });

  it("returns one key when n is 1", () => {
    const keys = generateNKeysBetween(null, null, 1);
    expect(keys).toHaveLength(1);
    expect(typeof keys[0]).toBe("string");
  });

  it("returns n correctly ordered keys between null boundaries", () => {
    const keys = generateNKeysBetween(null, null, 5);
    expect(keys).toHaveLength(5);

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("returns n keys that all fall between a and b", () => {
    const a = "A0";
    const b = "z0";
    const keys = generateNKeysBetween(a, b, 5);

    expect(keys).toHaveLength(5);

    for (const key of keys) {
      expect(key > a).toBe(true);
      expect(key < b).toBe(true);
    }

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("returns n keys after a when b is null", () => {
    const a = "a0";
    const keys = generateNKeysBetween(a, null, 5);

    expect(keys).toHaveLength(5);

    for (const key of keys) {
      expect(key > a).toBe(true);
    }

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("returns n keys before b when a is null", () => {
    const b = "z0";
    const keys = generateNKeysBetween(null, b, 5);

    expect(keys).toHaveLength(5);

    for (const key of keys) {
      expect(key < b).toBe(true);
    }

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("throws when n is negative", () => {
    expect(() => generateNKeysBetween(null, null, -1)).toThrow();
  });
});

describe("stress tests", () => {
  it("100 sequential insertions at the end maintain order", () => {
    const keys: string[] = [];
    let last: string | null = null;

    for (let i = 0; i < 100; i++) {
      const key = generateKeyBetween(last, null);
      keys.push(key);
      last = key;
    }

    // All keys are unique.
    const unique = new Set(keys);
    expect(unique.size).toBe(100);

    // All keys are in strictly ascending order.
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("100 sequential insertions at the start maintain order", () => {
    const keys: string[] = [];
    let first: string | null = null;

    for (let i = 0; i < 100; i++) {
      const key = generateKeyBetween(null, first);
      keys.push(key);
      first = key;
    }

    // All keys are unique.
    const unique = new Set(keys);
    expect(unique.size).toBe(100);

    // Keys were generated in descending order (each new key is before the previous).
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] < keys[i - 1]).toBe(true);
    }

    // Reversed, they should be in ascending order.
    const sorted = [...keys].reverse();
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] > sorted[i - 1]).toBe(true);
    }
  });

  it("50 insertions between the same two adjacent keys maintain order", () => {
    // Start with two initial keys.
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);

    // Repeatedly insert between a and the last-inserted key.
    const keys: string[] = [a];
    let upper = b;

    for (let i = 0; i < 50; i++) {
      const mid = generateKeyBetween(a, upper);
      expect(mid > a).toBe(true);
      expect(mid < upper).toBe(true);
      keys.push(mid);
      upper = mid;
    }

    keys.push(b);

    // All keys must be unique.
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("keys are sortable with standard string comparison", () => {
    // Generate a shuffled set of keys by inserting in various positions.
    const keys: string[] = [];
    let last: string | null = null;

    for (let i = 0; i < 30; i++) {
      const key = generateKeyBetween(last, null);
      keys.push(key);
      last = key;
    }

    // Shuffle and re-sort.
    const shuffled = [...keys].sort(() => Math.random() - 0.5);
    const sorted = [...shuffled].sort();

    // The sorted result should match the original insertion order.
    expect(sorted).toEqual(keys);
  });
});
