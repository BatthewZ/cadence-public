import { useEffect, useState } from "react";

/**
 * Register a global keyboard shortcut.
 *
 * @param key - The key to listen for (e.g. "k", "p")
 * @param handler - Callback when the shortcut is triggered
 * @param options.ctrlOrMeta - If true, requires Ctrl (Windows/Linux) or Cmd (Mac)
 * @param options.enabled - If false, the shortcut is disabled (default: true)
 */
function isInputElement(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useHotkey(
  key: string,
  handler: () => void,
  options?: { ctrlOrMeta?: boolean; enabled?: boolean },
): void {
  useEffect(() => {
    const enabled = options?.enabled ?? true;
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (!e.key) return;
      if (options?.ctrlOrMeta && !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      if (isInputElement(e.target)) return;

      e.preventDefault();
      handler();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [key, handler, options?.ctrlOrMeta, options?.enabled]);
}

/**
 * A shared ref for chord state so UI components can show an indicator.
 * When a chord prefix key is pressed, this is set to that key (e.g. "g").
 * It's cleared after the chord completes or times out.
 */
const chordListeners = new Set<(prefix: string | null) => void>();
let currentChordPrefix: string | null = null;

function setChordPrefix(prefix: string | null) {
  currentChordPrefix = prefix;
  for (const listener of chordListeners) {
    listener(prefix);
  }
}

/**
 * Subscribe to chord prefix state changes for UI indicators.
 */
export function useChordIndicator(): string | null {
  const [prefix, setPrefix] = useState<string | null>(() => currentChordPrefix);

  useEffect(() => {
    const listener = (p: string | null) => setPrefix(p);
    chordListeners.add(listener);
    return () => { chordListeners.delete(listener); };
  }, []);

  return prefix;
}

/**
 * Register a two-key chord shortcut (e.g. "g" then "d" to go to dashboard).
 *
 * @param firstKey - The prefix key that starts the chord
 * @param secondKey - The second key that completes the chord
 * @param handler - Callback when the full chord is triggered
 * @param options.enabled - If false, the chord is disabled (default: true)
 */
export function useHotkeyChord(
  firstKey: string,
  secondKey: string,
  handler: () => void,
  options?: { enabled?: boolean },
): void {
  useEffect(() => {
    const enabled = options?.enabled ?? true;
    if (!enabled) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function onKeyDown(e: KeyboardEvent) {
      if (!e.key) return;
      if (isInputElement(e.target)) return;
      // Don't trigger on modifier keys
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (currentChordPrefix === firstKey && e.key.toLowerCase() === secondKey.toLowerCase()) {
        e.preventDefault();
        if (timeoutId) clearTimeout(timeoutId);
        setChordPrefix(null);
        handler();
      } else if (!currentChordPrefix && e.key.toLowerCase() === firstKey.toLowerCase()) {
        // Only set prefix if no chord is currently active
        setChordPrefix(firstKey);
        timeoutId = setTimeout(() => {
          setChordPrefix(null);
        }, 1000);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [firstKey, secondKey, handler, options?.enabled]);
}
