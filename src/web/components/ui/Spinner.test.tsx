import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders with role='status'", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has an accessible 'Loading' label via sr-only text", () => {
    render(<Spinner />);
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.getByText("Loading").className).toContain("sr-only");
  });

  it("applies the default md size class", () => {
    render(<Spinner />);
    expect(screen.getByRole("status").className).toContain("size-6");
  });

  it("applies the sm size class", () => {
    render(<Spinner size="sm" />);
    expect(screen.getByRole("status").className).toContain("size-4");
  });

  it("applies the lg size class", () => {
    render(<Spinner size="lg" />);
    expect(screen.getByRole("status").className).toContain("size-8");
  });

  it("applies base animation classes", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("animate-spin");
    expect(el.className).toContain("rounded-full");
  });

  it("merges custom className", () => {
    render(<Spinner className="my-spinner" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("my-spinner");
    expect(el.className).toContain("animate-spin");
  });

  it("forwards ref to the div element", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Spinner ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.getAttribute("role")).toBe("status");
  });

  it("passes through additional HTML attributes", () => {
    render(<Spinner data-testid="my-spinner" id="spinner-1" />);
    const el = screen.getByTestId("my-spinner");
    expect(el.id).toBe("spinner-1");
  });
});
