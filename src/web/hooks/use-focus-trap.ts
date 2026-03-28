import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusFirstOrContainer(container: HTMLElement) {
  const focusable =
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  if (focusable.length > 0) {
    focusable[0].focus();
  } else {
    container.focus();
  }
}

export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!enabled || !ref.current) return;

    previousFocusRef.current = document.activeElement;

    const container = ref.current;
    focusFirstOrContainer(container);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function handleFocusIn(e: FocusEvent) {
      if (!container.contains(e.target as Node)) {
        focusFirstOrContainer(container);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [ref, enabled]);
}
