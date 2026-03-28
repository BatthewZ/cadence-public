import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./Input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });

  it("passes custom props to the underlying input", () => {
    render(<Input placeholder="Enter name" aria-label="Name" />);
    expect(screen.getByPlaceholderText("Enter name")).toBeInTheDocument();
  });

  it("applies base text classes", () => {
    render(<Input aria-label="Name" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.className).toContain("text-body-2");
  });

  it("applies error styling when error is true", () => {
    render(<Input error aria-label="Name" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.className).toContain("border-status-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not apply error styling when error is false", () => {
    render(<Input aria-label="Name" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.className).not.toContain("border-status-error");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("renders as disabled", () => {
    render(<Input disabled aria-label="Name" />);
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
  });

  it("forwards ref to the input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Name" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByRole("textbox", { name: "Name" }));
  });

  it("merges custom className with default classes", () => {
    render(<Input className="custom-input" aria-label="Name" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.className).toContain("custom-input");
    expect(input.className).toContain("text-body-2");
  });

  it("supports different input types", () => {
    render(<Input type="email" aria-label="Email" />);
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("type", "email");
  });

  it("handles value changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input aria-label="Name" onChange={onChange} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "hello");
    expect(onChange).toHaveBeenCalled();
  });

  it("supports password type", () => {
    render(<Input type="password" placeholder="Password" />);
    const input = screen.getByPlaceholderText("Password");
    expect(input).toHaveAttribute("type", "password");
  });
});
