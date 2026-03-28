import { fireEvent,render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { useFocusTrap } from "./use-focus-trap";

function TrapComponent({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, enabled);
  return (
    <div ref={ref} tabIndex={-1} data-testid="trap">
      <button data-testid="first">First</button>
      <button data-testid="second">Second</button>
      <button data-testid="last">Last</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("focuses first focusable element when enabled", () => {
    render(<TrapComponent enabled={true} />);

    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("wraps focus from last to first on Tab", () => {
    render(<TrapComponent enabled={true} />);

    const lastButton = screen.getByTestId("last");
    lastButton.focus();
    expect(document.activeElement).toBe(lastButton);

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("wraps focus from first to last on Shift+Tab", () => {
    render(<TrapComponent enabled={true} />);

    const firstButton = screen.getByTestId("first");
    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(screen.getByTestId("last"));
  });

  it("does not trap focus when disabled", () => {
    const externalButton = document.createElement("button");
    document.body.appendChild(externalButton);
    externalButton.focus();

    render(<TrapComponent enabled={false} />);

    expect(document.activeElement).not.toBe(screen.getByTestId("first"));

    document.body.removeChild(externalButton);
  });

  it("restores previous focus on unmount", () => {
    const externalButton = document.createElement("button");
    document.body.appendChild(externalButton);
    externalButton.focus();
    expect(document.activeElement).toBe(externalButton);

    const { unmount } = render(<TrapComponent enabled={true} />);

    // Focus should have moved into the trap
    expect(document.activeElement).toBe(screen.getByTestId("first"));

    unmount();

    // Focus should be restored to the external button
    expect(document.activeElement).toBe(externalButton);

    document.body.removeChild(externalButton);
  });
});
