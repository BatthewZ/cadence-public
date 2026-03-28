import { describe, expect, it, vi } from "vitest";

import { mergeRefs } from "./merge-refs";

describe("mergeRefs", () => {
  it("calls callback ref with element", () => {
    const callbackRef = vi.fn();
    const merged = mergeRefs(callbackRef);
    const node = document.createElement("div");

    merged(node);

    expect(callbackRef).toHaveBeenCalledWith(node);
  });

  it("sets .current on ref object", () => {
    const refObject: { current: HTMLDivElement | null } = { current: null };
    const merged = mergeRefs(refObject);
    const node = document.createElement("div");

    merged(node);

    expect(refObject.current).toBe(node);
  });

  it("merges multiple refs (callback + object)", () => {
    const callbackRef = vi.fn();
    const refObject: { current: HTMLDivElement | null } = { current: null };
    const merged = mergeRefs(callbackRef, refObject);
    const node = document.createElement("div");

    merged(node);

    expect(callbackRef).toHaveBeenCalledWith(node);
    expect(refObject.current).toBe(node);
  });

  it("handles null refs gracefully", () => {
    const callbackRef = vi.fn();
    const merged = mergeRefs(null, callbackRef);
    const node = document.createElement("div");

    merged(node);

    expect(callbackRef).toHaveBeenCalledWith(node);
  });

  it("handles undefined refs gracefully", () => {
    const callbackRef = vi.fn();
    const merged = mergeRefs(undefined, callbackRef);
    const node = document.createElement("div");

    merged(node);

    expect(callbackRef).toHaveBeenCalledWith(node);
  });

  it("calls callback with null on cleanup", () => {
    const callbackRef = vi.fn();
    const refObject = { current: null as HTMLDivElement | null };
    const merged = mergeRefs(callbackRef, refObject);

    merged(null);

    expect(callbackRef).toHaveBeenCalledWith(null);
    expect(refObject.current).toBeNull();
  });
});
