import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState, EmptyStateActions, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "./EmptyState";

describe("EmptyState", () => {
  it("renders root with children", () => {
    render(
      <EmptyState>
        <EmptyStateTitle>No results</EmptyStateTitle>
      </EmptyState>,
    );
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("applies data-size for sm", () => {
    const { container } = render(
      <EmptyState size="sm">
        <EmptyStateTitle>Small</EmptyStateTitle>
      </EmptyState>,
    );
    expect(container.querySelector(".empty-state")).toHaveAttribute(
      "data-size",
      "sm",
    );
  });

  it("applies data-size for md", () => {
    const { container } = render(
      <EmptyState size="md">
        <EmptyStateTitle>Medium</EmptyStateTitle>
      </EmptyState>,
    );
    expect(container.querySelector(".empty-state")).toHaveAttribute(
      "data-size",
      "md",
    );
  });

  it("applies data-size for lg", () => {
    const { container } = render(
      <EmptyState size="lg">
        <EmptyStateTitle>Large</EmptyStateTitle>
      </EmptyState>,
    );
    expect(container.querySelector(".empty-state")).toHaveAttribute(
      "data-size",
      "lg",
    );
  });

  it("defaults to size md", () => {
    const { container } = render(
      <EmptyState>
        <EmptyStateTitle>Default</EmptyStateTitle>
      </EmptyState>,
    );
    expect(container.querySelector(".empty-state")).toHaveAttribute(
      "data-size",
      "md",
    );
  });

  it("EmptyState.Icon has aria-hidden true", () => {
    const { container } = render(
      <EmptyState>
        <EmptyStateIcon>
          <svg data-testid="icon" />
        </EmptyStateIcon>
      </EmptyState>,
    );
    const iconWrapper = container.querySelector("[aria-hidden='true']");
    expect(iconWrapper).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("EmptyState.Title renders text in a paragraph", () => {
    render(
      <EmptyState>
        <EmptyStateTitle>Nothing here</EmptyStateTitle>
      </EmptyState>,
    );
    const title = screen.getByText("Nothing here");
    expect(title).toBeInTheDocument();
    expect(title.tagName).toBe("P");
  });

  it("EmptyState.Description renders text in a paragraph", () => {
    render(
      <EmptyState>
        <EmptyStateDescription>Try adjusting filters</EmptyStateDescription>
      </EmptyState>,
    );
    const description = screen.getByText("Try adjusting filters");
    expect(description).toBeInTheDocument();
    expect(description.tagName).toBe("P");
  });

  it("EmptyState.Actions renders button children", () => {
    render(
      <EmptyState>
        <EmptyStateActions>
          <button>Retry</button>
          <button>Go back</button>
        </EmptyStateActions>
      </EmptyState>,
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByText("Go back")).toBeInTheDocument();
  });

  it("throws when EmptyState.Title is used outside root", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<EmptyStateTitle>Orphan</EmptyStateTitle>)).toThrow();
    spy.mockRestore();
  });

  it("forwards className on root", () => {
    const { container } = render(
      <EmptyState className="custom-class">
        <EmptyStateTitle>Styled</EmptyStateTitle>
      </EmptyState>,
    );
    expect(container.querySelector(".empty-state")).toHaveClass("custom-class");
  });
});
