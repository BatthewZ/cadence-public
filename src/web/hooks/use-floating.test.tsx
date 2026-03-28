import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFloating } from "./use-floating";

describe("useFloating", () => {
  it("returns refs for reference and floating elements", () => {
    const { result } = renderHook(() => useFloating());

    expect(result.current.refs).toBeDefined();
    expect(result.current.refs.reference).toBeDefined();
    expect(result.current.refs.floating).toBeDefined();
    expect(result.current.refs.setReference).toBeTypeOf("function");
    expect(result.current.refs.setFloating).toBeTypeOf("function");
  });

  it("returns floatingStyles object with position strategy", () => {
    const { result } = renderHook(() => useFloating());

    expect(result.current.floatingStyles).toBeDefined();
    expect(typeof result.current.floatingStyles).toBe("object");
    expect(result.current.floatingStyles).toHaveProperty("position");
  });

  it("returns the default placement of 'bottom'", () => {
    const { result } = renderHook(() => useFloating());

    expect(result.current.placement).toBe("bottom");
  });

  it("accepts a custom placement", () => {
    const { result } = renderHook(() => useFloating({ placement: "top-start" }));

    expect(result.current.placement).toBe("top-start");
  });

  it("accepts an offsetPx config", () => {
    const { result } = renderHook(() => useFloating({ offsetPx: 16 }));

    expect(result.current.refs).toBeDefined();
    expect(result.current.floatingStyles).toHaveProperty("position");
  });

  it("exposes isPositioned and context", () => {
    const { result } = renderHook(() => useFloating());

    expect(typeof result.current.isPositioned).toBe("boolean");
    expect(result.current.context).toBeDefined();
  });

  it("cleans up on unmount without errors", () => {
    const { unmount } = renderHook(() => useFloating({ placement: "right" }));

    // Should not throw
    expect(() => unmount()).not.toThrow();
  });

  it("passes open and onOpenChange to floating-ui", () => {
    const onOpenChange = vi.fn();

    const { result } = renderHook(() =>
      useFloating({ open: true, onOpenChange }),
    );

    expect(result.current.context).toBeDefined();
    expect(result.current.context.open).toBe(true);
  });
});
