import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach,describe, expect, it, vi } from "vitest";

import { DISMISS_ANIMATION_MS, ToastProvider, useToast } from "./ToastContext";

/** Helper component that exposes the toast API via buttons. */
function TestHarness() {
  const { toast, dismiss } = useToast();
  return (
    <>
      <button
        onClick={() => {
          const id = toast("Hello toast");
          // Stash the id so tests can access it
          document.body.dataset.lastToastId = id;
        }}
      >
        Add toast
      </button>
      <button
        onClick={() =>
          toast("Success toast", { variant: "success", title: "Done" })
        }
      >
        Add success toast
      </button>
      <button
        onClick={() =>
          toast("Short toast", { duration: 1000 })
        }
      >
        Add short toast
      </button>
      <button
        onClick={() => {
          const id = document.body.dataset.lastToastId;
          if (id) dismiss(id);
        }}
      >
        Dismiss last
      </button>
    </>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <TestHarness />
    </ToastProvider>,
  );
}

describe("ToastContext", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete document.body.dataset.lastToastId;
  });

  it("addToast adds a toast to the container", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "Add toast" }));

    expect(screen.getByText("Hello toast")).toBeInTheDocument();
  });

  it("toasts auto-dismiss after duration", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "Add short toast" }));
    expect(screen.getByText("Short toast")).toBeInTheDocument();

    // Advance past the duration (1000ms) + dismiss animation + buffer
    act(() => {
      vi.advanceTimersByTime(1000 + DISMISS_ANIMATION_MS + 100);
    });

    expect(screen.queryByText("Short toast")).not.toBeInTheDocument();
  });

  it("removeToast removes a specific toast", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "Add toast" }));
    expect(screen.getByText("Hello toast")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss last" }));

    // Advance past dismiss animation + buffer
    act(() => {
      vi.advanceTimersByTime(DISMISS_ANIMATION_MS + 100);
    });

    expect(screen.queryByText("Hello toast")).not.toBeInTheDocument();
  });

  it("multiple toasts render simultaneously", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "Add toast" }));
    await user.click(screen.getByRole("button", { name: "Add success toast" }));

    expect(screen.getByText("Hello toast")).toBeInTheDocument();
    expect(screen.getByText("Success toast")).toBeInTheDocument();
  });

  it("toast container has correct ARIA attributes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    // Add a toast so we can verify the toast itself has ARIA attributes
    await user.click(screen.getByRole("button", { name: "Add toast" }));

    // The individual toast should have role="status" (default info variant)
    const toast = screen.getByRole("status");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });

  it("renders toast with correct variant", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "Add success toast" }));

    const toast = screen.getByRole("status");
    expect(toast.className).toContain("bg-status-success-bg");
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("dismiss button on toast removes it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "Add toast" }));
    expect(screen.getByText("Hello toast")).toBeInTheDocument();

    // Click the dismiss button rendered inside the Toast component
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    act(() => {
      vi.advanceTimersByTime(DISMISS_ANIMATION_MS + 100);
    });

    expect(screen.queryByText("Hello toast")).not.toBeInTheDocument();
  });
});
