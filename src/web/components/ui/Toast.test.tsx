import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Toast } from "./Toast";

describe("Toast", () => {
  it("renders message text", () => {
    render(<Toast onDismiss={vi.fn()}>Something happened</Toast>);
    expect(screen.getByText("Something happened")).toBeInTheDocument();
  });

  it("renders title when provided", () => {
    render(
      <Toast onDismiss={vi.fn()} title="Heads up">
        Details here
      </Toast>,
    );
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Details here")).toBeInTheDocument();
  });

  it("applies success variant classes", () => {
    render(
      <Toast variant="success" onDismiss={vi.fn()}>
        Success
      </Toast>,
    );
    const toast = screen.getByRole("status");
    expect(toast.className).toContain("bg-status-success-bg");
  });

  it("applies warning variant classes", () => {
    render(
      <Toast variant="warning" onDismiss={vi.fn()}>
        Warning
      </Toast>,
    );
    const toast = screen.getByRole("status");
    expect(toast.className).toContain("bg-status-warning-bg");
  });

  it("applies error variant classes", () => {
    render(
      <Toast variant="error" onDismiss={vi.fn()}>
        Error
      </Toast>,
    );
    const toast = screen.getByRole("alert");
    expect(toast.className).toContain("bg-status-error-bg");
  });

  it("applies info variant classes", () => {
    render(
      <Toast variant="info" onDismiss={vi.fn()}>
        Info
      </Toast>,
    );
    const toast = screen.getByRole("status");
    expect(toast.className).toContain("bg-status-info-bg");
  });

  it("shows dismiss button", () => {
    render(<Toast onDismiss={vi.fn()}>Message</Toast>);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("clicking dismiss calls onDismiss", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss}>Message</Toast>);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("has role='alert' for error variant", () => {
    render(
      <Toast variant="error" onDismiss={vi.fn()}>
        Error toast
      </Toast>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("has role='status' for non-error variants", () => {
    const { rerender } = render(
      <Toast variant="success" onDismiss={vi.fn()}>
        Toast
      </Toast>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      <Toast variant="warning" onDismiss={vi.fn()}>
        Toast
      </Toast>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      <Toast variant="info" onDismiss={vi.fn()}>
        Toast
      </Toast>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has aria-live='assertive' for error variant", () => {
    render(
      <Toast variant="error" onDismiss={vi.fn()}>
        Error
      </Toast>,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("has aria-live='polite' for non-error variants", () => {
    render(
      <Toast variant="success" onDismiss={vi.fn()}>
        Success
      </Toast>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("defaults to info variant", () => {
    render(<Toast onDismiss={vi.fn()}>Default</Toast>);
    const toast = screen.getByRole("status");
    expect(toast.className).toContain("bg-status-info-bg");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });
});
