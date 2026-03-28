import { type ComponentPropsWithRef, createContext, forwardRef, useContext } from "react";

import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type Size = "sm" | "md" | "lg";

type EmptyStateContextValue = { size: Size };

const EmptyStateContext = createContext<EmptyStateContextValue | null>(null);

function useEmptyStateContext() {
  const ctx = useContext(EmptyStateContext);
  if (!ctx) throw new Error("EmptyState compound components must be used within <EmptyState>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  EmptyState (root)                                                  */
/* ------------------------------------------------------------------ */

type EmptyStateProps = {
  size?: Size;
} & ComponentPropsWithRef<"div">;

const EmptyStateRoot = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { size = "md", className, children, ...props },
  ref
) {
  return (
    <EmptyStateContext.Provider value={{ size }}>
      <div ref={ref} className={cn("empty-state", className)} data-size={size} {...props}>
        {children}
      </div>
    </EmptyStateContext.Provider>
  );
});

/* ------------------------------------------------------------------ */
/*  EmptyState.Icon                                                    */
/* ------------------------------------------------------------------ */

type EmptyStateIconProps = ComponentPropsWithRef<"div">;

const EmptyStateIcon = forwardRef<HTMLDivElement, EmptyStateIconProps>(function EmptyStateIcon(
  { className, children, ...props },
  ref
) {
  useEmptyStateContext();

  return (
    <div ref={ref} className={cn("empty-state__icon", className)} aria-hidden="true" {...props}>
      {children}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  EmptyState.Title                                                   */
/* ------------------------------------------------------------------ */

type EmptyStateTitleProps = ComponentPropsWithRef<"p">;

const EmptyStateTitle = forwardRef<HTMLParagraphElement, EmptyStateTitleProps>(
  function EmptyStateTitle({ className, children, ...props }, ref) {
    useEmptyStateContext();

    return (
      <p ref={ref} className={cn("empty-state__title", className)} {...props}>
        {children}
      </p>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  EmptyState.Description                                             */
/* ------------------------------------------------------------------ */

type EmptyStateDescriptionProps = ComponentPropsWithRef<"p">;

const EmptyStateDescription = forwardRef<HTMLParagraphElement, EmptyStateDescriptionProps>(
  function EmptyStateDescription({ className, children, ...props }, ref) {
    useEmptyStateContext();

    return (
      <p ref={ref} className={cn("empty-state__description", className)} {...props}>
        {children}
      </p>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  EmptyState.Actions                                                 */
/* ------------------------------------------------------------------ */

type EmptyStateActionsProps = ComponentPropsWithRef<"div">;

const EmptyStateActions = forwardRef<HTMLDivElement, EmptyStateActionsProps>(
  function EmptyStateActions({ className, children, ...props }, ref) {
    useEmptyStateContext();

    return (
      <div ref={ref} className={cn("empty-state__actions", className)} {...props}>
        {children}
      </div>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export {
  EmptyStateRoot as EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
};
