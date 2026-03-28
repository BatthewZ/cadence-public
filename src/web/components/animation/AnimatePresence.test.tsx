import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => false,
}));

import { AnimatePresence } from "./AnimatePresence";

describe("AnimatePresence", () => {
  it("renders children when show is true", () => {
    render(<AnimatePresence show={true}>Visible</AnimatePresence>);
    expect(screen.getByText("Visible")).toBeInTheDocument();
  });

  it("does not render children when show is false", () => {
    render(<AnimatePresence show={false}>Hidden</AnimatePresence>);
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("applies enter class when show is true", () => {
    render(
      <AnimatePresence show={true} data-testid="animate">
        Content
      </AnimatePresence>
    );
    const el = screen.getByTestId("animate");
    expect(el.className).toContain("fade-in");
  });

  it("merges custom className", () => {
    render(
      <AnimatePresence show={true} className="custom-class" data-testid="animate">
        Content
      </AnimatePresence>
    );
    expect(screen.getByTestId("animate").className).toContain("custom-class");
  });
});
