import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders image when src is provided", () => {
    render(<Avatar src="/photo.jpg" alt="Jane Doe" />);
    const imgs = screen.getAllByRole("img", { name: "Jane Doe" });
    // Outer span[role="img"] and inner <img> both match
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    const innerImg = imgs.find((el) => el.tagName === "IMG");
    expect(innerImg).toBeDefined();
    expect(innerImg).toHaveAttribute("src", "/photo.jpg");
  });

  it("shows fallback initials when no src is provided", () => {
    render(<Avatar name="Jane Doe" />);
    const avatar = screen.getByRole("img", { name: "Jane Doe" });
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveTextContent("JD");
  });

  it("shows single initial for single-word name", () => {
    render(<Avatar name="Jane" />);
    expect(screen.getByRole("img", { name: "Jane" })).toHaveTextContent("J");
  });

  it("size variants apply correct classes", () => {
    const { rerender } = render(<Avatar name="A B" size="xs" />);
    expect(screen.getByRole("img").className).toContain("size-6");

    rerender(<Avatar name="A B" size="sm" />);
    expect(screen.getByRole("img").className).toContain("size-8");

    rerender(<Avatar name="A B" size="md" />);
    expect(screen.getByRole("img").className).toContain("size-10");

    rerender(<Avatar name="A B" size="lg" />);
    expect(screen.getByRole("img").className).toContain("size-12");

    rerender(<Avatar name="A B" size="xl" />);
    expect(screen.getByRole("img").className).toContain("size-16");
  });

  it("forwards className prop", () => {
    render(<Avatar name="Test" className="custom-class" />);
    expect(screen.getByRole("img").className).toContain("custom-class");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Avatar name="Test" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    expect(ref.current).toBe(screen.getByRole("img"));
  });
});
