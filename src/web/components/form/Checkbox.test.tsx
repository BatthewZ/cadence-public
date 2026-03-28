import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("renders a checkbox input", () => {
    render(<Checkbox aria-label="Agree" />);
    expect(screen.getByRole("checkbox", { name: "Agree" })).toBeInTheDocument();
  });

  it("always renders with type checkbox", () => {
    render(<Checkbox aria-label="Agree" />);
    expect(screen.getByRole("checkbox", { name: "Agree" })).toHaveAttribute("type", "checkbox");
  });

  it("renders as checked when checked prop is true", () => {
    render(<Checkbox checked aria-label="Agree" onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Agree" })).toBeChecked();
  });

  it("renders as unchecked when checked prop is false", () => {
    render(<Checkbox checked={false} aria-label="Agree" onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Agree" })).not.toBeChecked();
  });

  it("calls onChange when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox aria-label="Agree" onChange={onChange} />);

    await user.click(screen.getByRole("checkbox", { name: "Agree" }));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("renders as disabled", () => {
    render(<Checkbox disabled aria-label="Agree" />);
    expect(screen.getByRole("checkbox", { name: "Agree" })).toBeDisabled();
  });

  it("does not fire onChange when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox disabled aria-label="Agree" onChange={onChange} />);

    await user.click(screen.getByRole("checkbox", { name: "Agree" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("associates with a label via id", () => {
    render(
      <div>
        <label htmlFor="terms">I agree to terms</label>
        <Checkbox id="terms" />
      </div>
    );
    expect(screen.getByRole("checkbox", { name: "I agree to terms" })).toBeInTheDocument();
  });

  it("forwards ref to the input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} aria-label="Agree" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByRole("checkbox", { name: "Agree" }));
  });

  it("merges custom className with default classes", () => {
    render(<Checkbox className="custom-checkbox" aria-label="Agree" />);
    const checkbox = screen.getByRole("checkbox", { name: "Agree" });
    expect(checkbox.className).toContain("custom-checkbox");
    expect(checkbox.className).toContain("size-4");
  });

  it("applies rounded-sm class for checkbox shape", () => {
    render(<Checkbox aria-label="Agree" />);
    const checkbox = screen.getByRole("checkbox", { name: "Agree" });
    expect(checkbox.className).toContain("rounded-sm");
  });
});
