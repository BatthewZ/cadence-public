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

// Models a floating element (e.g. a dropdown) that lives *inside* a modal
// dialog. Clicks elsewhere in the dialog are genuinely outside the dropdown and
// must still close it — the dialog wraps the ref, so it must NOT be treated as
// an overlay that protects the ref from outside clicks.
function DialogWrappedComponent({ handler }: { handler: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, handler, true);
  return (
    <dialog open>
      <div ref={ref} data-testid="dropdown">
        Dropdown
      </div>
      <div data-testid="dialog-elsewhere">Elsewhere in dialog</div>
    </dialog>
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

  it("does not call handler when clicking inside an open dialog mounted outside the ref", () => {
    // Reproduces the bug where a delete-confirmation <dialog> (showModal paints
    // it in the top layer, so it is mounted as a sibling of the panel it
    // overlays) closed the panel out from under itself: a click on the dialog's
    // own text resolves to a target outside the panel ref, which a naive
    // contains() check reads as an outside click. The dialog floats *over* the
    // panel and does not contain it, so its clicks must be ignored.
    const handler = vi.fn();
    render(<TestComponent handler={handler} />);

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const dialogText = document.createElement("p");
    dialogText.textContent = "Are you sure? This cannot be undone.";
    dialog.appendChild(dialogText);
    document.body.appendChild(dialog);

    fireEvent.click(dialogText);

    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(dialog);
  });

  it("still calls handler when clicking elsewhere in a dialog that wraps the ref", () => {
    // Guards the inverse: when the ref (e.g. a dropdown) lives *inside* a modal
    // dialog, a click on other dialog content is a real outside click for the
    // dropdown and must still close it. The dialog contains the ref, so the
    // overlay exception must not apply.
    const handler = vi.fn();
    render(<DialogWrappedComponent handler={handler} />);

    fireEvent.click(screen.getByTestId("dialog-elsewhere"));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
