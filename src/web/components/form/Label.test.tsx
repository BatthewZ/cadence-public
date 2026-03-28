import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Label } from "./Label";

describe("Label", () => {
  it("renders a label element", () => {
    render(<Label>Name</Label>);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Name").tagName).toBe("LABEL");
  });

  it("renders children content", () => {
    render(
      <Label>
        <span>Email Address</span>
      </Label>
    );
    expect(screen.getByText("Email Address")).toBeInTheDocument();
  });

  it("renders a required indicator as children", () => {
    render(
      <Label>
        Name <span aria-hidden="true">*</span>
      </Label>
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("applies htmlFor attribute", () => {
    render(<Label htmlFor="name-input">Name</Label>);
    expect(screen.getByText("Name")).toHaveAttribute("for", "name-input");
  });

  it("associates with an input via htmlFor", () => {
    render(
      <div>
        <Label htmlFor="email-field">Email</Label>
        <input id="email-field" type="email" />
      </div>
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("merges custom className with default classes", () => {
    render(<Label className="custom-label">Name</Label>);
    const label = screen.getByText("Name");
    expect(label.className).toContain("custom-label");
    expect(label.className).toContain("font-semibold");
  });

  it("applies default styling classes", () => {
    render(<Label>Name</Label>);
    const label = screen.getByText("Name");
    expect(label.className).toContain("text-body-2");
    expect(label.className).toContain("font-semibold");
    expect(label.className).toContain("text-fg-primary");
  });

  it("forwards ref to the label element", () => {
    const ref = createRef<HTMLLabelElement>();
    render(<Label ref={ref}>Name</Label>);
    expect(ref.current).toBeInstanceOf(HTMLLabelElement);
    expect(ref.current).toBe(screen.getByText("Name"));
  });

  it("passes additional HTML props", () => {
    render(<Label data-testid="my-label">Name</Label>);
    expect(screen.getByTestId("my-label")).toBeInTheDocument();
  });
});
