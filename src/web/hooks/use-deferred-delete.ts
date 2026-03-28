import { useEffect, useRef } from "react";

const UNDO_DELAY_MS = 5000;

type PendingEntry<T> = {
  timerId: ReturnType<typeof setTimeout>;
  item: T;
  onRestore: (item: T) => void;
};

type DeferredDeleteOptions<T> = {
  /** Execute the actual delete API call */
  onDelete: (id: string, item: T) => Promise<void>;
  /** Called when the API call fails */
  onError: (id: string) => void;
  /** Show an undo toast; call undoFn to cancel the pending deletion and trigger onRestore */
  onToast: (message: string, undoFn: () => void) => void;
};

/**
 * Manages deferred deletions with undo support.
 *
 * Items are optimistically removed from the UI immediately but the actual API
 * call is delayed by 5 seconds. During that window the user can undo, which
 * cancels the API call and calls onRestore to put the item back.
 */
export function useDeferredDelete<T>(options: DeferredDeleteOptions<T>) {
  const pending = useRef<Map<string, PendingEntry<T>>>(new Map());
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  // Clean up all pending timeouts on unmount
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const [, entry] of map) {
        clearTimeout(entry.timerId);
      }
      map.clear();
    };
  }, []);

  function schedule(
    id: string,
    item: T,
    toastMessage: string,
    onRestore: (item: T) => void,
  ): void {
    // Cancel any existing pending deletion for this id (rapid delete/undo/delete)
    const existing = pending.current.get(id);
    if (existing) {
      clearTimeout(existing.timerId);
    }

    // Schedule actual API call after delay
    const timerId = setTimeout(() => {
      pending.current.delete(id);
      void optionsRef.current.onDelete(id, item).catch(() => {
        optionsRef.current.onError(id);
      });
    }, UNDO_DELAY_MS);

    pending.current.set(id, { timerId, item, onRestore });

    // Show toast with undo action
    optionsRef.current.onToast(toastMessage, () => {
      const entry = pending.current.get(id);
      if (entry) {
        clearTimeout(entry.timerId);
        pending.current.delete(id);
        entry.onRestore(entry.item);
      }
    });
  }

  return { schedule };
}
