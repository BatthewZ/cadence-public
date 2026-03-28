import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Row } from "./Row";

describe("Row", () => {
  it("renders children in a row layout", () => {
    render(<Row data-testid="row"><span>A</span><span>B</span></Row>);
    const el = screen.getByTestId("row");
    expect(el.className).toContain("flex");
    expect(el.className).toContain("flex-row");
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("applies default align and justify", () => {
    render(<Row data-testid="row">Content</Row>);
    const el = screen.getByTestId("row");
    expect(el.className).toContain("items-center");
    expect(el.className).toContain("justify-start");
  });

  it("supports custom gap", () => {
    render(<Row gap="r2" data-testid="row">Content</Row>);
    expect(screen.getByTestId("row").className).toContain("gap-r2");
  });

  it("supports custom align", () => {
    render(<Row align="stretch" data-testid="row">Content</Row>);
    expect(screen.getByTestId("row").className).toContain("items-stretch");
  });

  it("supports custom justify", () => {
    render(<Row justify="between" data-testid="row">Content</Row>);
    expect(screen.getByTestId("row").className).toContain("justify-between");
  });

  it("supports wrap prop", () => {
    render(<Row wrap data-testid="row">Content</Row>);
    expect(screen.getByTestId("row").className).toContain("flex-wrap");
  });

  it("merges custom className", () => {
    render(<Row className="custom-class" data-testid="row">Styled</Row>);
    const el = screen.getByTestId("row");
    expect(el.className).toContain("custom-class");
    expect(el.className).toContain("flex-row");
  });
});
