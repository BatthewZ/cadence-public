import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { FieldError } from "./FieldError";

describe("FieldError", () => {
  it("renders the error message", () => {
    render(<FieldError>Email is required</FieldError>);
    expect(screen.getByText("Email is required")).toBeInTheDocument();
  });

  it("renders with role alert", () => {
    render(<FieldError>Something went wrong</FieldError>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("renders nothing when children is undefined", () => {
    const { container } = render(<FieldError />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when children is null", () => {
    const { container } = render(<FieldError>{null}</FieldError>);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when children is empty string", () => {
    const { container } = render(<FieldError>{""}</FieldError>);
    expect(container.innerHTML).toBe("");
  });

  it("applies error styling classes", () => {
    render(<FieldError>Error</FieldError>);
    const error = screen.getByRole("alert");
    expect(error.className).toContain("text-status-error");
    expect(error.className).toContain("text-body-3");
  });

  it("merges custom className with default classes", () => {
    render(<FieldError className="custom-error">Error</FieldError>);
    const error = screen.getByRole("alert");
    expect(error.className).toContain("custom-error");
    expect(error.className).toContain("text-status-error");
  });

  it("renders as a p element", () => {
    render(<FieldError>Error</FieldError>);
    expect(screen.getByRole("alert").tagName).toBe("P");
  });

  it("forwards ref to the p element", () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<FieldError ref={ref}>Error</FieldError>);
    expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
    expect(ref.current).toBe(screen.getByRole("alert"));
  });

  it("accepts an explicit id prop", () => {
    render(<FieldError id="custom-id">Error</FieldError>);
    expect(screen.getByRole("alert")).toHaveAttribute("id", "custom-id");
  });

  it("renders without id when outside Field context", () => {
    render(<FieldError>Error</FieldError>);
    expect(screen.getByRole("alert")).not.toHaveAttribute("id");
  });

  it("passes additional HTML props", () => {
    render(<FieldError data-testid="field-err">Error</FieldError>);
    expect(screen.getByTestId("field-err")).toBeInTheDocument();
  });
});
