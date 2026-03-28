import { type KeyboardEvent, useCallback, useRef, useState } from "react";

interface UseRovingFocusOptions {
  orientation: "horizontal" | "vertical";
  loop?: boolean;
}

interface RovingProps {
  tabIndex: number;
  onKeyDown: (e: KeyboardEvent) => void;
  ref: (el: HTMLElement | null) => void;
}

export function useRovingFocus(options: UseRovingFocusOptions): {
  getRovingProps: (index: number) => RovingProps;
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
} {
  const { orientation, loop = true } = options;
  const [focusedIndex, setFocusedIndex] = useState(0);
  const focusedIndexRef = useRef(focusedIndex);
  // eslint-disable-next-line react-hooks/refs -- intentional sync-ref pattern for stable callback closures
  focusedIndexRef.current = focusedIndex;

  const elementsRef = useRef<Map<number, HTMLElement>>(new Map());

  const prevKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";

  const getRovingProps = useCallback(
    (index: number): RovingProps => ({
      tabIndex: index === focusedIndexRef.current ? 0 : -1,
      onKeyDown: (e: KeyboardEvent) => {
        const count = elementsRef.current.size;
        if (count === 0) return;

        const current = focusedIndexRef.current;
        let nextIndex: number | undefined;

        switch (e.key) {
          case nextKey:
            nextIndex = loop
              ? (current + 1) % count
              : Math.min(current + 1, count - 1);
            break;
          case prevKey:
            nextIndex = loop
              ? (current - 1 + count) % count
              : Math.max(current - 1, 0);
            break;
          case "Home":
            nextIndex = 0;
            break;
          case "End":
            nextIndex = count - 1;
            break;
          default:
            return;
        }

        e.preventDefault();
        setFocusedIndex(nextIndex);
        elementsRef.current.get(nextIndex)?.focus();
      },
      ref: (el: HTMLElement | null) => {
        if (el) {
          elementsRef.current.set(index, el);
        } else {
          elementsRef.current.delete(index);
        }
      },
    }),
    [loop, nextKey, prevKey]
  );

  return { getRovingProps, focusedIndex, setFocusedIndex };
}
