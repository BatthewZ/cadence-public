import { useEffect, useRef } from "react";

/**
 * Walks up the DOM from `node` (inclusive of `node` itself) and returns the
 * first ancestor satisfying `predicate`, or null if none do.
 *
 * Every click-outside exception below — a floating-ui portal, an enclosing open
 * dialog, the controlling toggle — is the same self-inclusive parent-chain walk
 * with a different match test. Centralising the walk here keeps each exception a
 * single declarative predicate and removes three near-identical loops. The
 * type-guard predicate also flows the matched node's type through, so callers
 * that need the element itself (e.g. the dialog) get it back without a cast.
 */
function findAncestorOrSelf<T extends Node>(
  node: Node,
  predicate: (n: Node) => n is T
): T | null {
  let current: Node | null = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * Checks whether a DOM node lives inside a floating-ui portal container.
 * Clicks on portaled content (popovers, tooltips, dropdowns) are logically
 * "inside" the component that triggered them, so they should not count as
 * outside clicks.
 */
function isInsideFloatingPortal(node: Node): boolean {
  return (
    findAncestorOrSelf(
      node,
      (n): n is HTMLElement =>
        n instanceof HTMLElement &&
        n.hasAttribute("data-floating-ui-portal")
    ) !== null
  );
}

/**
 * Walks up from `node` to find the nearest open native `<dialog>` ancestor.
 *
 * A modal dialog opened with `showModal()` paints in the browser's *top layer*,
 * escaping its DOM position. A confirmation/modal dialog that logically belongs
 * to a panel is therefore commonly mounted as a *sibling* (or portal) of that
 * panel rather than a descendant — so a plain `ref.contains(target)` check reads
 * a click inside the dialog as "outside" the panel and dismisses the panel out
 * from under the dialog. Surfacing the enclosing open dialog lets the listener
 * decide whether the click should count as outside (see its usage below).
 */
function getEnclosingOpenDialog(node: Node): HTMLDialogElement | null {
  return findAncestorOrSelf(
    node,
    (n): n is HTMLDialogElement => n instanceof HTMLDialogElement && n.open
  );
}

/**
 * Checks whether a click target lives inside the toggle that controls the
 * given element (identified by `aria-controls`). Clicks on the toggle are
 * not "outside" clicks — the toggle already manages open/close itself.
 */
function isInsideAriaController(node: Node, controlledId: string): boolean {
  return (
    findAncestorOrSelf(
      node,
      (n): n is HTMLElement =>
        n instanceof HTMLElement &&
        n.getAttribute("aria-controls") === controlledId
    ) !== null
  );
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
      // A modal <dialog> (showModal) paints in the top layer and is commonly
      // mounted as a sibling/portal of the element it overlays — e.g. a task
      // panel's delete-confirmation dialog. A click inside such a dialog must
      // not dismiss the element beneath it. We only skip when the dialog does
      // NOT contain `ref.current`: if the dialog *wraps* the ref (e.g. a
      // dropdown inside a form dialog), clicks elsewhere in the dialog are
      // genuinely outside the ref and should still close it.
      const enclosingDialog = getEnclosingOpenDialog(target);
      if (enclosingDialog && !enclosingDialog.contains(ref.current)) return;
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
