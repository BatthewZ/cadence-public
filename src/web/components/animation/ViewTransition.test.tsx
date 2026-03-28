import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { ViewTransition } from "./ViewTransition";

describe("ViewTransition", () => {
  it("renders children", () => {
    render(<ViewTransition name="hero">Hello</ViewTransition>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("applies view-transition-name style", () => {
    render(
      <ViewTransition name="hero" data-testid="vt">
        Content
      </ViewTransition>
    );
    const el = screen.getByTestId("vt");
    expect(el.style.viewTransitionName).toBe("hero");
  });

  it("merges custom className", () => {
    render(
      <ViewTransition name="card" className="custom-class" data-testid="vt">
        Styled
      </ViewTransition>
    );
    expect(screen.getByTestId("vt").className).toContain("custom-class");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ViewTransition name="test" ref={ref}>
        Ref
      </ViewTransition>
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
