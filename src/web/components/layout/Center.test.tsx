import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Center } from "./Center";

describe("Center", () => {
  it("renders children", () => {
    render(<Center>Hello</Center>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("applies centering classes", () => {
    render(<Center>Content</Center>);
    const el = screen.getByText("Content");
    expect(el.className).toContain("flex");
    expect(el.className).toContain("items-center");
    expect(el.className).toContain("justify-center");
  });

  it("merges custom className", () => {
    render(<Center className="custom-class">Styled</Center>);
    const el = screen.getByText("Styled");
    expect(el.className).toContain("custom-class");
    expect(el.className).toContain("flex");
  });

  it("renders as a div element", () => {
    render(<Center data-testid="center">Content</Center>);
    const el = screen.getByTestId("center");
    expect(el.tagName).toBe("DIV");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Center ref={ref}>Ref</Center>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
