import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders text content", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("default variant applies correct styling", () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText("Default");
    expect(badge.className).toContain("bg-surface-2");
    expect(badge.className).toContain("text-fg-secondary");
  });

  it("success variant applies correct styling", () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText("Success");
    expect(badge.className).toContain("bg-status-success-bg");
    expect(badge.className).toContain("text-status-success");
  });

  it("warning variant applies correct styling", () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText("Warning");
    expect(badge.className).toContain("bg-status-warning-bg");
    expect(badge.className).toContain("text-status-warning");
  });

  it("error variant applies correct styling", () => {
    render(<Badge variant="error">Error</Badge>);
    const badge = screen.getByText("Error");
    expect(badge.className).toContain("bg-status-error-bg");
    expect(badge.className).toContain("text-status-error");
  });

  it("info variant applies correct styling", () => {
    render(<Badge variant="info">Info</Badge>);
    const badge = screen.getByText("Info");
    expect(badge.className).toContain("bg-status-info-bg");
    expect(badge.className).toContain("text-status-info");
  });

  it("forwards className prop", () => {
    render(<Badge className="custom-class">Styled</Badge>);
    expect(screen.getByText("Styled").className).toContain("custom-class");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Badge ref={ref}>Ref</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    expect(ref.current).toBe(screen.getByText("Ref"));
  });
});
