import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  it("renders with search icon and input", () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
  });

  it("calls onChange when typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows clear button when value is non-empty", () => {
    render(<SearchInput value="test" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });

  it("hides clear button when value is empty", () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("calls onClear and clears input when clear button clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<SearchInput value="test" onChange={onChange} onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onClear).toHaveBeenCalled();
  });

  it("clears input on Escape key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput value="test" onChange={onChange} />);

    const input = screen.getByRole("searchbox", { name: "Search" });
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("has correct ARIA attributes", () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("aria-label", "Search");
  });

  it("applies size variant classes", () => {
    render(<SearchInput value="" onChange={vi.fn()} size="sm" />);
    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(input.className).toContain("search-input__input--sm");
  });

  it("uses default placeholder", () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("accepts custom placeholder", () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Filter items..." />);
    expect(screen.getByPlaceholderText("Filter items...")).toBeInTheDocument();
  });
});
