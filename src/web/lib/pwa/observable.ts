/** A value React reads with `useSyncExternalStore`. */
export interface ExternalValue<T> {
  subscribe: (onChange: () => void) => () => void;
  get: () => T;
}

export interface Observable<T> extends ExternalValue<T> {
  set: (next: T) => void;
}

export function observable<T>(initial: T): Observable<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
