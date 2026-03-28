import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => false,
}));

import { Stagger } from "./Stagger";

describe("Stagger", () => {
  it("renders children", () => {
    render(
      <Stagger>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </Stagger>
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("wraps children in stagger-item divs with stagger index", () => {
    const { container } = render(
      <Stagger>
        <span>A</span>
        <span>B</span>
      </Stagger>
    );
    const items = container.querySelectorAll(".stagger-item");
    expect(items).toHaveLength(2);
    expect((items[0] as HTMLElement).style.getPropertyValue("--stagger-index")).toBe("0");
    expect((items[1] as HTMLElement).style.getPropertyValue("--stagger-index")).toBe("1");
  });

  it("applies stagger-delay CSS variable when prop is set", () => {
    const { container } = render(
      <Stagger staggerDelay="100ms">
        <span>A</span>
      </Stagger>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue("--stagger-delay")).toBe("100ms");
  });

  it("merges custom className", () => {
    const { container } = render(
      <Stagger className="custom-class">
        <span>A</span>
      </Stagger>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("custom-class");
  });
});
