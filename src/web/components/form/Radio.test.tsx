import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Radio } from "./Radio";

describe("Radio", () => {
  it("renders a radio input", () => {
    render(<Radio aria-label="Option A" />);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeInTheDocument();
  });

  it("always renders with type radio", () => {
    render(<Radio aria-label="Option A" />);
    expect(screen.getByRole("radio", { name: "Option A" })).toHaveAttribute("type", "radio");
  });

  it("renders as checked when checked prop is true", () => {
    render(<Radio checked aria-label="Option A" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeChecked();
  });

  it("renders as unchecked when checked prop is false", () => {
    render(<Radio checked={false} aria-label="Option A" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeChecked();
  });

  it("calls onChange when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Radio aria-label="Option A" onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Option A" }));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("renders as disabled", () => {
    render(<Radio disabled aria-label="Option A" />);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
  });

  it("does not fire onChange when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Radio disabled aria-label="Option A" onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Option A" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("associates with a label via id", () => {
    render(
      <div>
        <label htmlFor="opt-a">Option A Label</label>
        <Radio id="opt-a" />
      </div>
    );
    expect(screen.getByRole("radio", { name: "Option A Label" })).toBeInTheDocument();
  });

  it("forwards ref to the input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Radio ref={ref} aria-label="Option A" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByRole("radio", { name: "Option A" }));
  });

  it("merges custom className with default classes", () => {
    render(<Radio className="custom-radio" aria-label="Option A" />);
    const radio = screen.getByRole("radio", { name: "Option A" });
    expect(radio.className).toContain("custom-radio");
    expect(radio.className).toContain("size-4");
  });

  it("applies size-4 class for radio sizing", () => {
    render(<Radio aria-label="Option A" />);
    const radio = screen.getByRole("radio", { name: "Option A" });
    expect(radio.className).toContain("size-4");
  });

  it("supports name attribute for radio groups", () => {
    render(
      <div>
        <Radio name="color" value="red" aria-label="Red" />
        <Radio name="color" value="blue" aria-label="Blue" />
      </div>
    );
    expect(screen.getByRole("radio", { name: "Red" })).toHaveAttribute("name", "color");
    expect(screen.getByRole("radio", { name: "Blue" })).toHaveAttribute("name", "color");
  });
});
