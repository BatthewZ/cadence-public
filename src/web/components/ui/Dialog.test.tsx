import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

// jsdom does not implement HTMLDialogElement.showModal / close, so we polyfill them.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

function renderDialog(props: { open?: boolean; onClose?: () => void; className?: string } = {}) {
  const { open = false, onClose = vi.fn(), ...rest } = props;
  return {
    onClose,
    ...render(
      <Dialog open={open} onClose={onClose} {...rest}>
        <h2>Dialog Title</h2>
        <p>Dialog description text</p>
      </Dialog>,
    ),
  };
}

describe("Dialog", () => {
  it("does not render content when open is false", () => {
    renderDialog({ open: false });

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).not.toHaveAttribute("open");
  });

  it("renders content when open is true", () => {
    renderDialog({ open: true });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("Dialog Title")).toBeInTheDocument();
    expect(screen.getByText("Dialog description text")).toBeInTheDocument();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();

    renderDialog({ open: true, onClose });

    const dialog = screen.getByRole("dialog");

    // Dispatch a cancel event, which is what native dialog emits on Escape
    const cancelEvent = new Event("cancel", { bubbles: false, cancelable: true });
    dialog.dispatchEvent(cancelEvent);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has role='dialog' (native dialog element)", () => {
    renderDialog({ open: true });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("forwards className to dialog element", () => {
    renderDialog({ open: true, className: "custom-dialog" });

    expect(screen.getByRole("dialog")).toHaveClass("custom-dialog");
  });

  it("opens and closes when open prop changes", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open={false} onClose={onClose}>
        <p>Content</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).not.toHaveAttribute("open");

    rerender(
      <Dialog open={true} onClose={onClose}>
        <p>Content</p>
      </Dialog>,
    );

    expect(dialog).toHaveAttribute("open");

    rerender(
      <Dialog open={false} onClose={onClose}>
        <p>Content</p>
      </Dialog>,
    );

    expect(dialog).not.toHaveAttribute("open");
  });

  it("renders children inside the dialog", () => {
    render(
      <Dialog open={true} onClose={vi.fn()}>
        <h2>My Title</h2>
        <p>Some description</p>
        <button>Close</button>
      </Dialog>,
    );

    expect(screen.getByRole("heading", { name: "My Title" })).toBeInTheDocument();
    expect(screen.getByText("Some description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("prevents default on cancel event so browser does not close dialog", () => {
    renderDialog({ open: true });

    const dialog = screen.getByRole("dialog");
    const cancelEvent = new Event("cancel", { bubbles: false, cancelable: true });
    dialog.dispatchEvent(cancelEvent);

    // The cancel event should have been preventDefault'd
    expect(cancelEvent.defaultPrevented).toBe(true);
  });
});
