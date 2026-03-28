import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Divider } from "./Divider";

describe("Divider", () => {
  it("renders a horizontal hr element by default", () => {
    render(<Divider data-testid="divider" />);
    const el = screen.getByTestId("divider");
    expect(el.tagName).toBe("HR");
  });

  it("applies horizontal border class", () => {
    render(<Divider data-testid="divider" />);
    const el = screen.getByTestId("divider");
    expect(el.className).toContain("border-t");
  });

  it("renders a vertical div element", () => {
    render(<Divider orientation="vertical" data-testid="divider" />);
    const el = screen.getByTestId("divider");
    expect(el.tagName).toBe("DIV");
  });

  it("applies vertical styling and semantics", () => {
    render(<Divider orientation="vertical" data-testid="divider" />);
    const el = screen.getByTestId("divider");
    expect(el.className).toContain("border-l");
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("merges custom className for horizontal", () => {
    render(<Divider className="custom-class" data-testid="divider" />);
    const el = screen.getByTestId("divider");
    expect(el.className).toContain("custom-class");
    expect(el.className).toContain("border-t");
  });

  it("merges custom className for vertical", () => {
    render(<Divider orientation="vertical" className="custom-class" data-testid="divider" />);
    const el = screen.getByTestId("divider");
    expect(el.className).toContain("custom-class");
    expect(el.className).toContain("border-l");
  });
});
