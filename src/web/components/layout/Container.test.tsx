import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Container } from "./Container";

describe("Container", () => {
  it("renders children", () => {
    render(<Container>Hello</Container>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("applies default container classes", () => {
    render(<Container data-testid="container">Content</Container>);
    const el = screen.getByTestId("container");
    expect(el.className).toContain("mx-auto");
    expect(el.className).toContain("w-full");
  });

  it("applies default md size", () => {
    render(<Container data-testid="container">Content</Container>);
    const el = screen.getByTestId("container");
    expect(el.className).toContain("max-w-[640px]");
  });

  it("supports sm size variant", () => {
    render(<Container size="sm" data-testid="container">Content</Container>);
    expect(screen.getByTestId("container").className).toContain("max-w-[480px]");
  });

  it("supports lg size variant", () => {
    render(<Container size="lg" data-testid="container">Content</Container>);
    expect(screen.getByTestId("container").className).toContain("max-w-[768px]");
  });

  it("supports xl size variant", () => {
    render(<Container size="xl" data-testid="container">Content</Container>);
    expect(screen.getByTestId("container").className).toContain("max-w-[1024px]");
  });

  it("supports full size variant", () => {
    render(<Container size="full" data-testid="container">Content</Container>);
    expect(screen.getByTestId("container").className).toContain("max-w-full");
  });

  it("merges custom className", () => {
    render(<Container className="custom-class">Styled</Container>);
    expect(screen.getByText("Styled").className).toContain("custom-class");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Container ref={ref}>Ref</Container>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
