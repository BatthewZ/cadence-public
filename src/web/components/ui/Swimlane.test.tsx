import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Swimlane } from "./Swimlane";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Swimlane", () => {
  it("renders a scrollable container with the swimlane class", () => {
    const { container } = render(
      <Swimlane title="Popular">
        <div>Item 1</div>
      </Swimlane>,
    );
    expect(container.querySelector(".swimlane")).toBeInTheDocument();
  });

  it("renders a header with a title", () => {
    render(
      <Swimlane title="Trending">
        <div>Content</div>
      </Swimlane>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Trending" })).toBeInTheDocument();
  });

  it("renders a subtitle when provided", () => {
    render(
      <Swimlane title="Featured" subtitle="Hand-picked for you">
        <div>Content</div>
      </Swimlane>,
    );
    expect(screen.getByText("Hand-picked for you")).toBeInTheDocument();
  });

  it("renders a 'View all' link when viewAllHref is provided", () => {
    render(
      <Swimlane title="Recent" viewAllHref="/all">
        <div>Content</div>
      </Swimlane>,
    );
    const link = screen.getByRole("link", { name: "View all" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/all");
  });

  it("does not render a 'View all' link when viewAllHref is omitted", () => {
    render(
      <Swimlane title="Recent">
        <div>Content</div>
      </Swimlane>,
    );
    expect(screen.queryByRole("link", { name: "View all" })).not.toBeInTheDocument();
  });

  it("renders children inside the body", () => {
    const { container } = render(
      <Swimlane title="Items">
        <div data-testid="child-1">Child 1</div>
        <div data-testid="child-2">Child 2</div>
      </Swimlane>,
    );
    const body = container.querySelector(".swimlane__body");
    expect(body).toBeInTheDocument();
    expect(screen.getByTestId("child-1")).toBeInTheDocument();
    expect(screen.getByTestId("child-2")).toBeInTheDocument();
  });

  it("forwards className to the root container", () => {
    const { container } = render(
      <Swimlane title="Styled" className="extra-class">
        <div>Content</div>
      </Swimlane>,
    );
    const root = container.querySelector(".swimlane");
    expect(root?.className).toContain("extra-class");
  });
});
