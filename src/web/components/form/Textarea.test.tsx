import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea aria-label="Bio" />);
    expect(screen.getByRole("textbox", { name: "Bio" })).toBeInTheDocument();
  });

  it("passes custom props to the underlying textarea", () => {
    render(<Textarea placeholder="Enter bio" aria-label="Bio" />);
    expect(screen.getByPlaceholderText("Enter bio")).toBeInTheDocument();
  });

  it("applies base text classes", () => {
    render(<Textarea aria-label="Bio" />);
    const textarea = screen.getByRole("textbox", { name: "Bio" });
    expect(textarea.className).toContain("text-body-2");
  });

  it("applies resize and min-height classes", () => {
    render(<Textarea aria-label="Bio" />);
    const textarea = screen.getByRole("textbox", { name: "Bio" });
    expect(textarea.className).toContain("resize-y");
    expect(textarea.className).toContain("min-h-[100px]");
  });

  it("applies error styling when error is true", () => {
    render(<Textarea error aria-label="Bio" />);
    const textarea = screen.getByRole("textbox", { name: "Bio" });
    expect(textarea.className).toContain("border-status-error");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
  });

  it("does not apply error styling when error is false", () => {
    render(<Textarea aria-label="Bio" />);
    const textarea = screen.getByRole("textbox", { name: "Bio" });
    expect(textarea.className).not.toContain("border-status-error");
    expect(textarea).not.toHaveAttribute("aria-invalid");
  });

  it("renders as disabled", () => {
    render(<Textarea disabled aria-label="Bio" />);
    expect(screen.getByRole("textbox", { name: "Bio" })).toBeDisabled();
  });

  it("forwards ref to the textarea element", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="Bio" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current).toBe(screen.getByRole("textbox", { name: "Bio" }));
  });

  it("merges custom className with default classes", () => {
    render(<Textarea className="custom-textarea" aria-label="Bio" />);
    const textarea = screen.getByRole("textbox", { name: "Bio" });
    expect(textarea.className).toContain("custom-textarea");
    expect(textarea.className).toContain("text-body-2");
  });

  it("handles value changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Textarea aria-label="Bio" onChange={onChange} />);

    await user.type(screen.getByRole("textbox", { name: "Bio" }), "hello");
    expect(onChange).toHaveBeenCalled();
  });

  it("supports rows attribute", () => {
    render(<Textarea rows={5} aria-label="Bio" />);
    expect(screen.getByRole("textbox", { name: "Bio" })).toHaveAttribute("rows", "5");
  });
});
