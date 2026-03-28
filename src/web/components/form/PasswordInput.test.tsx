import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
  it("renders as a password input by default", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
  });

  it("toggles to text type when the show button is clicked", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);

    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
  });

  it("toggles back to password type on second click", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);

    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");

    const hideToggle = screen.getByRole("button", { name: "Hide password" });
    await user.click(hideToggle);
    expect(input).toHaveAttribute("type", "password");
  });

  it("updates aria-label on the toggle button based on state", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);

    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  it("forwards ref to the input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<PasswordInput ref={ref} aria-label="Password" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByLabelText("Password"));
  });

  it("passes props through to the underlying input", () => {
    render(
      <PasswordInput
        id="my-password"
        placeholder="Enter password"
        aria-label="Password"
      />
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("id", "my-password");
    expect(input).toHaveAttribute("placeholder", "Enter password");
  });

  it("applies error styling when error is true", () => {
    render(<PasswordInput error aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input.className).toContain("border-status-error");
  });

  it("handles value changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PasswordInput aria-label="Password" onChange={onChange} />);

    await user.type(screen.getByLabelText("Password"), "secret");
    expect(onChange).toHaveBeenCalled();
  });

  it("toggle button has type=button to prevent form submission", () => {
    render(<PasswordInput aria-label="Password" />);
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("type", "button");
  });

  it("toggle button has tabIndex=-1 to keep focus flow on input", () => {
    render(<PasswordInput aria-label="Password" />);
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("tabindex", "-1");
  });

  it("renders as disabled when disabled prop is passed", () => {
    render(<PasswordInput disabled aria-label="Password" />);
    expect(screen.getByLabelText("Password")).toBeDisabled();
  });

  it("merges custom className", () => {
    render(<PasswordInput className="custom-class" aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input.className).toContain("custom-class");
    expect(input.className).toContain("password-input__input");
  });
});
