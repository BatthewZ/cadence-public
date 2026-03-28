import {
  cloneElement,
  type ComponentPropsWithRef,
  createContext,
  forwardRef,
  isValidElement,
  type ReactElement,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";

import {
  FloatingFocusManager,
  FloatingPortal,
  type Placement,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@/web/hooks/use-floating";
import { mergeRefs } from "@/web/util/merge-refs";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

interface PopoverContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  refs: ReturnType<typeof useFloating>["refs"];
  floatingStyles: React.CSSProperties;
  context: ReturnType<typeof useFloating>["context"];
  getReferenceProps: ReturnType<typeof useInteractions>["getReferenceProps"];
  getFloatingProps: ReturnType<typeof useInteractions>["getFloatingProps"];
  contentId: string;
  portal: boolean;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error("Popover compound components must be used within <Popover>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Root                                                              */
/* ------------------------------------------------------------------ */

interface PopoverRootProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  placement?: Placement;
  offset?: number;
  /** When false, renders content inline instead of portaling to document.body.
   *  Use this when the popover is inside a native `<dialog>` (top-layer). */
  portal?: boolean;
  children: React.ReactNode;
}

function PopoverRoot({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  placement = "bottom",
  offset: offsetPx = 8,
  portal = true,
  children,
}: PopoverRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const contentId = useId();

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!isControlled) setUncontrolledOpen(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange]
  );

  const { refs, floatingStyles, context } = useFloating({
    placement,
    offsetPx,
    open,
    onOpenChange: handleOpenChange,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  const value = useMemo(
    () => ({
      open,
      setOpen: handleOpenChange,
      refs,
      floatingStyles,
      context,
      getReferenceProps,
      getFloatingProps,
      contentId,
      portal,
    }),
    [
      open,
      handleOpenChange,
      refs,
      floatingStyles,
      context,
      getReferenceProps,
      getFloatingProps,
      contentId,
      portal,
    ]
  );

  return (
    <PopoverContext.Provider value={value}>{children}</PopoverContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Trigger                                                           */
/* ------------------------------------------------------------------ */

type PopoverTriggerProps = ComponentPropsWithRef<"button"> & {
  /** When true, merges trigger props onto the single child element instead of wrapping in a <button>. */
  asChild?: boolean;
};

const PopoverTrigger = forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  function PopoverTrigger({ children, className, asChild = false, ...props }, ref) {
    const { open, refs, getReferenceProps, contentId } = usePopoverContext();
    const triggerProps = {
      // eslint-disable-next-line react-hooks/refs -- mergeRefs defers ref assignment to the returned callback
      ref: mergeRefs(ref, refs.setReference),
      "aria-expanded": open,
      "aria-haspopup": "dialog" as const,
      "aria-controls": open ? contentId : undefined,
      ...getReferenceProps(props),
    };

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<Record<string, unknown>>, {
        ...triggerProps,
        className: cn(
          (children.props as Record<string, unknown>).className as string | undefined,
          className
        ),
      });
    }

    return (
      <button className={cn("popover-trigger", className)} {...triggerProps}>
        {children}
      </button>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Content                                                           */
/* ------------------------------------------------------------------ */

type PopoverContentProps = ComponentPropsWithRef<"div">;

const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent({ children, className, style, ...props }, ref) {
    const { refs, floatingStyles, context, getFloatingProps, contentId, portal } =
      usePopoverContext();

    const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
      duration: 150,
      initial: { opacity: 0 },
    });

    if (!isMounted) return null;

    const content = (
      <FloatingFocusManager context={context}>
        <div
          ref={mergeRefs(ref, refs.setFloating)}
          id={contentId}
          className={cn("popover-content", className)}
          style={{ ...floatingStyles, ...transitionStyles, ...style }}
          {...getFloatingProps(props)}
        >
          {children}
        </div>
      </FloatingFocusManager>
    );

    if (portal) {
      return <FloatingPortal>{content}</FloatingPortal>;
    }

    return content;
  }
);

/* ------------------------------------------------------------------ */
/*  Export                                                            */
/* ------------------------------------------------------------------ */

export const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverTrigger,
  Content: PopoverContent,
});
