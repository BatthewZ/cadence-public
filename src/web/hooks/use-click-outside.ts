import { useEffect, useRef } from "react";

/**
 * Checks whether a DOM node lives inside a floating-ui portal container.
 * Clicks on portaled content (popovers, tooltips, dropdowns) are logically
 * "inside" the component that triggered them, so they should not count as
 * outside clicks.
 */
function isInsideFloatingPortal(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (
      current instanceof HTMLElement &&
      current.hasAttribute("data-floating-ui-portal")
    ) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Checks whether a click target lives inside the toggle that controls the
 * given element (identified by `aria-controls`). Clicks on the toggle are
 * not "outside" clicks — the toggle already manages open/close itself.
 */
function isInsideAriaController(node: Node, controlledId: string): boolean {
  let current: Node | null = node;
  while (current) {
    if (
      current instanceof HTMLElement &&
      current.getAttribute("aria-controls") === controlledId
    ) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

export function useClickOutside(
  ref: React.RefObject<Element | null>,
  handler: () => void,
  enabled = true
) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    // Where the press that produced the upcoming click/touchend began. A
    // browser `click` fires on the *common ancestor* of the mousedown and
    // mouseup targets, so a press that starts inside the ref but releases
    // outside it (e.g. selecting text in the panel and dragging the cursor
    // past its edge before letting go) reports a target outside the ref.
    // Tracking the press origin lets us recognise that interaction as one
    // that began inside, so we don't close mid-selection and lose the user's
    // edit. Reset to null on each new press to avoid stale carry-over.
    let pressStartTarget: Node | null = null;
    const recordPressStart = (event: MouseEvent | TouchEvent) => {
      pressStartTarget = event.target as Node;
    };

    const listener = (event: MouseEvent | TouchEvent) => {
      const downTarget = pressStartTarget;
      pressStartTarget = null;

      const target = event.target as Node;
      if (!ref.current || ref.current.contains(target)) return;
      // The press began inside the ref — treat the whole interaction as
      // inside even though the cursor was released outside (drag-to-select
      // past the panel edge). Closing here would discard in-progress edits.
      if (downTarget && ref.current.contains(downTarget)) return;
      // If the target was removed from the DOM during event processing
      // (e.g. optimistic UI delete), it was originally inside the ref —
      // don't treat it as an outside click.
      if (!target.isConnected) return;
      if (isInsideFloatingPortal(target)) return;
      // Ignore clicks on the toggle that controls this element — it has its
      // own open/close logic and firing both causes a close-then-reopen race.
      const panelId = ref.current.id;
      if (panelId && isInsideAriaController(target, panelId)) return;
      handlerRef.current();
    };

    // Defer registration so the click that caused `enabled` to become true
    // (e.g. a toggle button opening the sidebar) has fully propagated before
    // we start listening — otherwise it immediately fires as an outside click.
    const frameId = requestAnimationFrame(() => {
      document.addEventListener("mousedown", recordPressStart);
      document.addEventListener("touchstart", recordPressStart);
      document.addEventListener("click", listener);
      document.addEventListener("touchend", listener);
    });

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("mousedown", recordPressStart);
      document.removeEventListener("touchstart", recordPressStart);
      document.removeEventListener("click", listener);
      document.removeEventListener("touchend", listener);
    };
  }, [ref, enabled]);
}
