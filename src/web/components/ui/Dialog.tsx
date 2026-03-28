import { type ComponentPropsWithRef, forwardRef, useEffect, useMemo, useRef } from "react";

import { mergeRefs } from "@/web/util/merge-refs";
import { cn } from "@/web/util/style/style";

type DialogProps = {
  open: boolean;
  onClose: () => void;
} & Omit<ComponentPropsWithRef<"dialog">, "open">;

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  { open, onClose, className, children, ...props },
  forwardedRef
) {
  const innerRef = useRef<HTMLDialogElement>(null);
  const mergedRef = useMemo(() => mergeRefs(forwardedRef, innerRef), [forwardedRef]);

  useEffect(() => {
    const dialog = innerRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = innerRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("click", handleBackdropClick);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("click", handleBackdropClick);
    };
  }, [onClose]);

  return (
    <dialog
      ref={mergedRef}
      className={cn(
        "no-body-scroll bg-surface-0 rounded-lg shadow-lg p-r2 animate-fade-in max-w-[640px] w-full m-auto",
        "backdrop:bg-black/50",
        className
      )}
      {...props}
    >
      {children}
    </dialog>
  );
});
