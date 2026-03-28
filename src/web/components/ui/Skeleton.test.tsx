import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a placeholder element with status role", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has accessible loading label", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("width prop applies correctly via inline style", () => {
    render(<Skeleton width={200} />);
    expect(screen.getByRole("status").style.width).toBe("200px");
  });

  it("height prop applies correctly via inline style", () => {
    render(<Skeleton height="3rem" />);
    expect(screen.getByRole("status").style.height).toBe("3rem");
  });

  it("defaults width to 100%", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status").style.width).toBe("100%");
  });

  it("text variant applies correct class", () => {
    render(<Skeleton variant="text" />);
    expect(screen.getByRole("status").className).toContain("skeleton--text");
  });

  it("circular variant applies correct class", () => {
    render(<Skeleton variant="circular" />);
    expect(screen.getByRole("status").className).toContain("skeleton--circular");
  });

  it("rectangular variant applies base skeleton class", () => {
    render(<Skeleton variant="rectangular" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("skeleton");
  });

  it("rounded variant applies correct class", () => {
    render(<Skeleton variant="rounded" />);
    expect(screen.getByRole("status").className).toContain("skeleton--rounded");
  });

  it("forwards className prop", () => {
    render(<Skeleton className="custom-class" />);
    expect(screen.getByRole("status").className).toContain("custom-class");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Skeleton ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    expect(ref.current).toBe(screen.getByRole("status"));
  });
});
