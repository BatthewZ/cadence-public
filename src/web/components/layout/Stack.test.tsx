import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Stack } from "./Stack";

describe("Stack", () => {
  it("renders children in a vertical stack", () => {
    render(<Stack data-testid="stack"><span>A</span><span>B</span></Stack>);
    const el = screen.getByTestId("stack");
    expect(el.className).toContain("flex");
    expect(el.className).toContain("flex-col");
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("applies default gap", () => {
    render(<Stack data-testid="stack">Content</Stack>);
    expect(screen.getByTestId("stack").className).toContain("gap-r4");
  });

  it("supports custom gap", () => {
    render(<Stack gap="r2" data-testid="stack">Content</Stack>);
    expect(screen.getByTestId("stack").className).toContain("gap-r2");
  });

  it("merges custom className", () => {
    render(<Stack className="custom-class" data-testid="stack">Styled</Stack>);
    const el = screen.getByTestId("stack");
    expect(el.className).toContain("custom-class");
    expect(el.className).toContain("flex-col");
  });

  it("renders as a div by default", () => {
    render(<Stack data-testid="stack">Content</Stack>);
    expect(screen.getByTestId("stack").tagName).toBe("DIV");
  });
});
