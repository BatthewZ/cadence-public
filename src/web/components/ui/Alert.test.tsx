import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Alert } from "./Alert";

describe("Alert", () => {
  it("renders with role='alert'", () => {
    render(<Alert>Something happened</Alert>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders children content", () => {
    render(<Alert>Alert message</Alert>);
    expect(screen.getByText("Alert message")).toBeInTheDocument();
  });

  it("applies success variant classes", () => {
    render(<Alert variant="success">Success</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-status-success-bg");
    expect(alert.className).toContain("text-status-success");
  });

  it("applies warning variant classes", () => {
    render(<Alert variant="warning">Warning</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-status-warning-bg");
    expect(alert.className).toContain("text-status-warning");
  });

  it("applies error variant classes", () => {
    render(<Alert variant="error">Error</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-status-error-bg");
    expect(alert.className).toContain("text-status-error");
  });

  it("applies info variant classes by default", () => {
    render(<Alert>Info</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-status-info-bg");
    expect(alert.className).toContain("text-status-info");
  });

  it("forwards className prop", () => {
    render(<Alert className="custom-alert">Styled</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("custom-alert");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Alert ref={ref}>Ref alert</Alert>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toBe(screen.getByRole("alert"));
  });

  it("has aria-live='polite'", () => {
    render(<Alert>Live region</Alert>);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
  });
});
