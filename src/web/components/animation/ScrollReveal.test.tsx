import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => false,
}));

import { ScrollReveal } from "./ScrollReveal";

describe("ScrollReveal", () => {
  it("renders children", () => {
    render(<ScrollReveal>Hello</ScrollReveal>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("applies initial hidden state", () => {
    const { container } = render(<ScrollReveal>Content</ScrollReveal>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("scroll-reveal-hidden");
  });

  it("merges custom className", () => {
    const { container } = render(<ScrollReveal className="custom-class">Styled</ScrollReveal>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("custom-class");
  });

  it("renders as a div by default", () => {
    const { container } = render(<ScrollReveal>Content</ScrollReveal>);
    expect(container.firstElementChild!.tagName).toBe("DIV");
  });
});
