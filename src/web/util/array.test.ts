import { describe, expect, it } from "vitest";

import { toggleArrayValue } from "./array";

/**
 * `toggleArrayValue` is the shared XOR-toggle behind every multi-select filter
 * (filter popovers, click-to-filter task-card chips, list-view cells). These
 * tests pin the two properties those call sites depend on: a second toggle
 * *removes* (so click-to-filter is reversible and never produces `u1,u1` in the
 * URL), and the rest of the array is preserved (so toggles from one surface
 * compose with selections made elsewhere in the same dimension).
 */
describe("toggleArrayValue", () => {
  it("appends a value that is absent", () => {
    expect(toggleArrayValue(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("removes a value that is present", () => {
    expect(toggleArrayValue(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("appends to an empty array", () => {
    expect(toggleArrayValue([], "a")).toEqual(["a"]);
  });

  it("removes the last remaining value, yielding an empty array", () => {
    expect(toggleArrayValue(["a"], "a")).toEqual([]);
  });

  it("preserves the other values when removing — toggles compose, never clobber", () => {
    expect(toggleArrayValue(["u1", "none", "u2"], "none")).toEqual(["u1", "u2"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b"];
    const result = toggleArrayValue(input, "a");

    expect(input).toEqual(["a", "b"]);
    expect(result).not.toBe(input);
  });

  it("works with non-string element types", () => {
    expect(toggleArrayValue([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggleArrayValue([1, 2], 3)).toEqual([1, 2, 3]);
  });
});
