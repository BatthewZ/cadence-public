import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useClickOutside } from "./use-click-outside";

function TestComponent({
  handler,
  enabled = true,
}: {
  handler: () => void;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, handler, enabled);
  return (
    <div>
      <div ref={ref} data-testid="inside">
        Inside
      </div>
      <div data-testid="outside">Outside</div>
    </div>
  );
}

describe("useClickOutside", () => {
  // The hook defers listener registration via requestAnimationFrame to avoid
  // the toggle-click that opens a panel from immediately closing it again.
  // We stub rAF to fire synchronously so tests can assert without waiting.
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls handler when clicking outside the ref element", () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    fireEvent.click(screen.getByTestId("outside"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call handler when clicking inside the ref element", () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    fireEvent.click(screen.getByTestId("inside"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call handler when enabled is false", () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} enabled={false} />);

    fireEvent.click(screen.getByTestId("outside"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", () => {
    const handler = vi.fn();
    const { unmount } = render(<TestComponent handler={handler} />);

    unmount();

    fireEvent.click(document.body);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call handler when click target is removed from DOM during event", () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    // Create an element inside the ref, then remove it before the document listener runs
    const inside = screen.getByTestId("inside");
    const ephemeral = document.createElement("button");
    inside.appendChild(ephemeral);

    // Simulate: element is clicked but removed from DOM (e.g. optimistic delete)
    // by removing it before firing the click on document
    inside.removeChild(ephemeral);
    fireEvent.click(ephemeral);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call handler when a press starts inside and releases outside (drag-to-select)", () => {
    // Reproduces the UX bug where selecting text inside the panel and dragging
    // the cursor past its edge before releasing the mouse closed the panel and
    // discarded the in-progress edit. A browser `click` fires on the common
    // ancestor of mousedown/mouseup, so the click target is outside the ref
    // even though the interaction began inside it.
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    // Press begins inside the ref...
    fireEvent.mouseDown(screen.getByTestId("inside"));
    // ...but the resulting click resolves to an element outside the ref.
    fireEvent.click(screen.getByTestId("outside"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("still calls handler for a genuine outside press-and-click", () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    fireEvent.mouseDown(screen.getByTestId("outside"));
    fireEvent.click(screen.getByTestId("outside"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call handler when clicking inside a floating-ui portal", () => {
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    // Simulate a floating-ui portal container outside the ref element
    const portal = document.createElement("div");
    portal.setAttribute("data-floating-ui-portal", "");
    const portalChild = document.createElement("button");
    portal.appendChild(portalChild);
    document.body.appendChild(portal);

    fireEvent.click(portalChild);

    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(portal);
  });
});
