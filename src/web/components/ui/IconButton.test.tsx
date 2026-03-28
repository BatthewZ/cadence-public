import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./IconButton";

const SearchIcon = () => (
  <svg data-testid="search-icon" aria-hidden="true">
    <circle cx="10" cy="10" r="8" />
  </svg>
);

describe("IconButton", () => {
  it("renders a button element", () => {
    render(<IconButton aria-label="Search"><SearchIcon /></IconButton>);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("renders the icon child", () => {
    render(<IconButton aria-label="Search"><SearchIcon /></IconButton>);
    expect(screen.getByTestId("search-icon")).toBeInTheDocument();
  });

  it("has the aria-label attribute", () => {
    render(<IconButton aria-label="Close menu"><SearchIcon /></IconButton>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Close menu");
  });

  it("applies base classes", () => {
    render(<IconButton aria-label="Action"><SearchIcon /></IconButton>);
    const button = screen.getByRole("button");
    expect(button.className).toContain("inline-flex");
    expect(button.className).toContain("items-center");
    expect(button.className).toContain("justify-center");
  });

  it("merges custom className", () => {
    render(<IconButton aria-label="Action" className="my-class"><SearchIcon /></IconButton>);
    const button = screen.getByRole("button");
    expect(button.className).toContain("my-class");
    expect(button.className).toContain("inline-flex");
  });

  it("renders as disabled", () => {
    render(<IconButton aria-label="Disabled" disabled><SearchIcon /></IconButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("handles click events", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton aria-label="Click me" onClick={onClick}><SearchIcon /></IconButton>);

    await user.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire click when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton aria-label="No click" disabled onClick={onClick}>
        <SearchIcon />
      </IconButton>
    );

    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards ref to the button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} aria-label="Ref test"><SearchIcon /></IconButton>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.tagName).toBe("BUTTON");
  });

  it("supports type attribute", () => {
    render(<IconButton aria-label="Submit" type="submit"><SearchIcon /></IconButton>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});
