import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MasonryGrid } from "./MasonryGrid";

describe("MasonryGrid", () => {
  it("renders a grid container with masonry-grid class", () => {
    const { container } = render(
      <MasonryGrid animate={false}>
        <MasonryGrid.Item>A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    expect(container.querySelector(".masonry-grid")).toBeInTheDocument();
  });

  it("renders children as items", () => {
    render(
      <MasonryGrid animate={false}>
        <MasonryGrid.Item>Item 1</MasonryGrid.Item>
        <MasonryGrid.Item>Item 2</MasonryGrid.Item>
        <MasonryGrid.Item>Item 3</MasonryGrid.Item>
      </MasonryGrid>,
    );
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
    expect(screen.getByText("Item 3")).toBeInTheDocument();
  });

  it("applies responsive column classes from a breakpoints object", () => {
    const { container } = render(
      <MasonryGrid columns={{ sm: 2, md: 3, lg: 4 }} animate={false}>
        <MasonryGrid.Item>A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    const grid = container.querySelector(".masonry-grid");
    expect(grid?.className).toContain("masonry-grid--sm-2");
    expect(grid?.className).toContain("masonry-grid--md-3");
    expect(grid?.className).toContain("masonry-grid--lg-4");
  });

  it("applies base column class from a number", () => {
    const { container } = render(
      <MasonryGrid columns={3} animate={false}>
        <MasonryGrid.Item>A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    const grid = container.querySelector(".masonry-grid");
    expect(grid?.className).toContain("masonry-grid--base-3");
  });

  it("sets gap as a CSS variable", () => {
    const { container } = render(
      <MasonryGrid gap="1.5rem" animate={false}>
        <MasonryGrid.Item>A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    const grid = container.querySelector(".masonry-grid") as HTMLElement;
    expect(grid.style.getPropertyValue("--masonry-gap")).toBe("1.5rem");
  });

  it("does not set gap CSS variable when gap is not provided", () => {
    const { container } = render(
      <MasonryGrid animate={false}>
        <MasonryGrid.Item>A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    const grid = container.querySelector(".masonry-grid") as HTMLElement;
    expect(grid.style.getPropertyValue("--masonry-gap")).toBe("");
  });

  it("applies masonry-grid__item class to items", () => {
    const { container } = render(
      <MasonryGrid animate={false}>
        <MasonryGrid.Item>A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    expect(container.querySelector(".masonry-grid__item")).toBeInTheDocument();
  });

  it("forwards className to the root container", () => {
    const { container } = render(
      <MasonryGrid className="custom-grid" animate={false}>
        <MasonryGrid.Item>A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    const grid = container.querySelector(".masonry-grid");
    expect(grid?.className).toContain("custom-grid");
  });

  it("forwards className to an item", () => {
    const { container } = render(
      <MasonryGrid animate={false}>
        <MasonryGrid.Item className="item-extra">A</MasonryGrid.Item>
      </MasonryGrid>,
    );
    const item = container.querySelector(".masonry-grid__item");
    expect(item?.className).toContain("item-extra");
  });
});
