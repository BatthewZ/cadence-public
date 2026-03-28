import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Toast, type ToastAction, type ToastVariant } from "./Toast";

type ToastOptions = {
  variant?: ToastVariant;
  title?: string;
  duration?: number;
  action?: ToastAction;
};

type ToastApi = {
  toast: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

type ToastEntry = {
  id: string;
  message: string;
  variant: ToastVariant;
  title?: string;
  action?: ToastAction;
  dismissing: boolean;
};

export const DISMISS_ANIMATION_MS = 300;
const DEFAULT_DURATION_MS = 5000;
const MAX_VISIBLE = 5;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const startDismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
    const removeTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, DISMISS_ANIMATION_MS);
    timersRef.current.set(`${id}-remove`, removeTimer);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const existing = timersRef.current.get(id);
      if (existing) {
        clearTimeout(existing);
        timersRef.current.delete(id);
      }
      startDismiss(id);
    },
    [startDismiss]
  );

  const dismissAll = useCallback(() => {
    for (const [, timer] of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setToasts((prev) => prev.map((t) => ({ ...t, dismissing: true })));
    setTimeout(() => setToasts([]), DISMISS_ANIMATION_MS);
  }, []);

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = crypto.randomUUID();
      const variant = options?.variant ?? "info";
      const duration = options?.duration ?? DEFAULT_DURATION_MS;

      const entry: ToastEntry = {
        id,
        message,
        variant,
        title: options?.title,
        action: options?.action,
        dismissing: false,
      };

      setToasts((prev) => {
        const next = [entry, ...prev];
        // Dismiss oldest if exceeding max
        if (next.length > MAX_VISIBLE) {
          const oldest = next[next.length - 1];
          setTimeout(() => startDismiss(oldest.id), 0);
        }
        return next;
      });

      if (duration > 0) {
        const timer = setTimeout(() => {
          timersRef.current.delete(id);
          startDismiss(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [startDismiss]
  );

  // Clean up all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const [, timer] of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const api: ToastApi = { toast, dismiss, dismissAll };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="fixed bottom-r4 right-r4 z-50 flex flex-col gap-r5 pointer-events-none">
          {toasts.map((t) => (
            <Toast
              key={t.id}
              variant={t.variant}
              title={t.title}
              action={t.action}
              dismissing={t.dismissing}
              onDismiss={() => dismiss(t.id)}
            >
              {t.message}
            </Toast>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
