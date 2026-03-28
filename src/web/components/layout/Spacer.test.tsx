import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Spacer } from "./Spacer";

describe("Spacer", () => {
  it("renders an empty spacer element", () => {
    render(<Spacer data-testid="spacer" />);
    expect(screen.getByTestId("spacer")).toBeInTheDocument();
  });

  it("applies flex-1 class", () => {
    render(<Spacer data-testid="spacer" />);
    expect(screen.getByTestId("spacer").className).toContain("flex-1");
  });

  it("merges custom className", () => {
    render(<Spacer className="custom-class" data-testid="spacer" />);
    const el = screen.getByTestId("spacer");
    expect(el.className).toContain("custom-class");
    expect(el.className).toContain("flex-1");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Spacer ref={ref} data-testid="spacer" />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
