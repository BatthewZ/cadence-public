import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => false,
}));

import { Parallax } from "./Parallax";

describe("Parallax", () => {
  it("renders children", () => {
    render(<Parallax>Hello</Parallax>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("applies willChange transform style", () => {
    render(<Parallax data-testid="parallax">Content</Parallax>);
    const el = screen.getByTestId("parallax");
    expect(el.style.willChange).toBe("transform");
  });

  it("merges custom className", () => {
    render(<Parallax className="custom-class" data-testid="parallax">Styled</Parallax>);
    expect(screen.getByTestId("parallax").className).toContain("custom-class");
  });

  it("merges custom style", () => {
    render(
      <Parallax style={{ color: "red" }} data-testid="parallax">
        Content
      </Parallax>
    );
    const el = screen.getByTestId("parallax");
    expect(el.style.color).toBe("red");
    expect(el.style.willChange).toBe("transform");
  });
});
