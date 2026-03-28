import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Breadcrumbs } from "./Breadcrumbs";

function renderWithRouter(ui: React.ReactElement) {
  return render(ui, { wrapper: MemoryRouter });
}

describe("Breadcrumbs", () => {
  it("renders nav with aria-label and ol", () => {
    renderWithRouter(
      <Breadcrumbs>
        <Breadcrumbs.Item>Home</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toBeInTheDocument();
    expect(nav.querySelector("ol")).toBeInTheDocument();
  });

  it("renders separators between items", () => {
    const { container } = renderWithRouter(
      <Breadcrumbs>
        <Breadcrumbs.Item href="/">Home</Breadcrumbs.Item>
        <Breadcrumbs.Item href="/products">Products</Breadcrumbs.Item>
        <Breadcrumbs.Item current>Widget</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const separators = container.querySelectorAll("[aria-hidden='true']");
    expect(separators.length).toBeGreaterThanOrEqual(2);
    // Default separator is a ChevronRight SVG icon, not text
    const hasSvg = Array.from(separators).some(
      (el) => el.querySelector("svg") !== null,
    );
    expect(hasSvg).toBe(true);
  });

  it("renders custom separator", () => {
    const { container } = renderWithRouter(
      <Breadcrumbs separator="›">
        <Breadcrumbs.Item href="/">Home</Breadcrumbs.Item>
        <Breadcrumbs.Item current>Page</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const separators = container.querySelectorAll("[aria-hidden='true']");
    const texts = Array.from(separators).map((el) => el.textContent);
    expect(texts).toContain("›");
  });

  it("item with href renders a link", () => {
    renderWithRouter(
      <Breadcrumbs>
        <Breadcrumbs.Item href="/home">Home</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const link = screen.getByRole("link", { name: "Home" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/home");
  });

  it("item with current renders span with aria-current page", () => {
    renderWithRouter(
      <Breadcrumbs>
        <Breadcrumbs.Item current>Current Page</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const current = screen.getByText("Current Page");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).toBe("SPAN");
  });

  it("item without href or current renders plain span", () => {
    renderWithRouter(
      <Breadcrumbs>
        <Breadcrumbs.Item>Plain</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const plain = screen.getByText("Plain");
    expect(plain.tagName).toBe("SPAN");
    expect(plain).not.toHaveAttribute("aria-current");
  });

  it("collapses items when maxItems is exceeded", () => {
    renderWithRouter(
      <Breadcrumbs maxItems={3}>
        <Breadcrumbs.Item href="/a">A</Breadcrumbs.Item>
        <Breadcrumbs.Item href="/b">B</Breadcrumbs.Item>
        <Breadcrumbs.Item href="/c">C</Breadcrumbs.Item>
        <Breadcrumbs.Item href="/d">D</Breadcrumbs.Item>
        <Breadcrumbs.Item current>E</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    expect(
      screen.getByRole("button", { name: "Show more breadcrumbs" }),
    ).toBeInTheDocument();
  });

  it("ellipsis button has correct aria-label", () => {
    renderWithRouter(
      <Breadcrumbs maxItems={2}>
        <Breadcrumbs.Item href="/a">A</Breadcrumbs.Item>
        <Breadcrumbs.Item href="/b">B</Breadcrumbs.Item>
        <Breadcrumbs.Item current>C</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const ellipsis = screen.getByRole("button", {
      name: "Show more breadcrumbs",
    });
    expect(ellipsis).toHaveAttribute("aria-label", "Show more breadcrumbs");
  });

  it("clicking ellipsis expands all items", async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <Breadcrumbs maxItems={2}>
        <Breadcrumbs.Item href="/a">A</Breadcrumbs.Item>
        <Breadcrumbs.Item href="/b">B</Breadcrumbs.Item>
        <Breadcrumbs.Item href="/c">C</Breadcrumbs.Item>
        <Breadcrumbs.Item current>D</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const ellipsis = screen.getByRole("button", {
      name: "Show more breadcrumbs",
    });
    await user.click(ellipsis);

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show more breadcrumbs" }),
    ).not.toBeInTheDocument();
  });

  it("throws when Item is used outside root", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      renderWithRouter(<Breadcrumbs.Item>Orphan</Breadcrumbs.Item>),
    ).toThrow();
    spy.mockRestore();
  });
});
