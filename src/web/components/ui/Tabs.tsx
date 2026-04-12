import {
  type AnimationEvent,
  type ComponentPropsWithRef,
  createContext,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";
import { mergeRefs } from "@/web/util/merge-refs";
import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type Variant = "underline" | "pill" | "enclosed";

type TabsContextValue = {
  activeValue: string;
  onValueChange: (value: string) => void;
  variant: Variant;
  baseId: string;
  exitingValue: string | null;
  onExitComplete: () => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound components must be used within <Tabs>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Tabs (root)                                                        */
/* ------------------------------------------------------------------ */

type TabsProps = {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  variant?: Variant;
} & Omit<ComponentPropsWithRef<"div">, "defaultValue">;

const TabsRoot = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    defaultValue,
    value: controlledValue,
    onValueChange,
    variant = "underline",
    className,
    children,
    ...props
  },
  ref
) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const baseId = useId();
  const reducedMotion = usePrefersReducedMotion();

  const isControlled = controlledValue !== undefined;
  const activeValue = isControlled ? controlledValue : uncontrolledValue;

  /* -- Exit coordination ------------------------------------------------ */
  const [exitingValue, setExitingValue] = useState<string | null>(null);
  const [prevActiveValue, setPrevActiveValue] = useState(activeValue);

  if (activeValue !== prevActiveValue) {
    setPrevActiveValue(activeValue);
    if (reducedMotion) {
      // Skip exit animation entirely — new panel shows instantly
      setExitingValue(null);
    } else if (exitingValue === null) {
      // No exit in progress — animate the old panel out
      setExitingValue(prevActiveValue);
    } else {
      // Rapid switch while an exit is in progress — skip the queued animation
      // and let the new active panel appear immediately
      setExitingValue(null);
    }
  }

  const onExitComplete = useCallback(() => {
    setExitingValue(null);
  }, []);

  const handleValueChange = useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setUncontrolledValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [isControlled, onValueChange]
  );

  return (
    <TabsContext.Provider
      value={{
        activeValue,
        onValueChange: handleValueChange,
        variant,
        baseId,
        exitingValue,
        onExitComplete,
      }}
    >
      <div ref={ref} className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
});

/* ------------------------------------------------------------------ */
/*  Tabs.List                                                          */
/* ------------------------------------------------------------------ */

type TabsListProps = ComponentPropsWithRef<"div">;

const variantListClass: Record<Variant, string> = {
  underline: "tabs-list--underline",
  pill: "tabs-list--pill",
  enclosed: "tabs-list--enclosed",
};

const variantIndicatorClass: Record<Variant, string> = {
  underline: "tabs-indicator--underline",
  pill: "tabs-indicator--pill",
  enclosed: "tabs-indicator--enclosed",
};

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { className, children, ...props },
  forwardedRef
) {
  const { activeValue, variant, baseId } = useTabsContext();
  const listRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    transform: string;
    width: string;
  }>({ transform: "translateX(0px)", width: "0px" });

  /* -- Scroll overflow detection for fade indicators ------------------- */
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const { scrollLeft, scrollWidth, clientWidth } = list;
    setCanScrollLeft(scrollLeft > 1);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  const updateIndicator = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const activeTab = list.querySelector<HTMLButtonElement>(
      `#${CSS.escape(`${baseId}-tab-${activeValue}`)}`
    );
    if (!activeTab) return;

    setIndicatorStyle({
      transform: `translateX(${activeTab.offsetLeft}px)`,
      width: `${activeTab.offsetWidth}px`,
    });
  }, [activeValue, baseId]);

  useLayoutEffect(() => {
    updateIndicator();
    updateScrollState();
  }, [updateIndicator, updateScrollState]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const observer = new ResizeObserver(() => {
      updateIndicator();
      updateScrollState();
    });
    observer.observe(list);
    // Observe individual tab buttons so the indicator repositions when
    // their content changes size (e.g., count badges loading in async).
    for (const tab of list.querySelectorAll('[role="tab"]')) {
      observer.observe(tab);
    }

    list.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", updateScrollState);
    };
  }, [updateIndicator, updateScrollState]);

  return (
    <div className="tabs-list-wrapper">
      <div
        ref={mergeRefs(forwardedRef, listRef)}
        role="tablist"
        className={cn("tabs-list", variantListClass[variant], className)}
        data-scroll-left={canScrollLeft}
        data-scroll-right={canScrollRight}
        {...props}
      >
        {children}
        <span
          className={cn("tabs-indicator", variantIndicatorClass[variant])}
          style={indicatorStyle}
          aria-hidden="true"
        />
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Tabs.Tab                                                           */
/* ------------------------------------------------------------------ */

type TabsTabProps = {
  value: string;
  disabled?: boolean;
} & Omit<ComponentPropsWithRef<"button">, "value">;

const TabsTab = forwardRef<HTMLButtonElement, TabsTabProps>(function TabsTab(
  { value, disabled = false, className, ...props },
  ref
) {
  const { activeValue, onValueChange, baseId } = useTabsContext();
  const isSelected = activeValue === value;

  function handleClick() {
    if (!disabled) {
      onValueChange(value);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const tablist = e.currentTarget.closest('[role="tablist"]');
    if (!tablist) return;

    const tabs = Array.from(
      tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')
    );
    const currentIndex = tabs.indexOf(e.currentTarget);
    if (currentIndex === -1) return;

    let nextIndex: number | undefined;

    switch (e.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const nextTab = tabs[nextIndex];
    nextTab.focus();
    // Auto-activate on focus (WAI-ARIA recommended)
    const nextValue = nextTab.dataset.value;
    if (nextValue) {
      onValueChange(nextValue);
    }
  }

  return (
    <button
      ref={ref}
      id={`${baseId}-tab-${value}`}
      role="tab"
      type="button"
      data-value={value}
      aria-selected={isSelected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      className={cn("tabs-tab", className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ */
/*  Tabs.Panel                                                         */
/* ------------------------------------------------------------------ */

type TabsPanelProps = {
  value: string;
} & Omit<ComponentPropsWithRef<"div">, "value">;

const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(function TabsPanel(
  { value, className, children, ...props },
  ref
) {
  const { activeValue, baseId, exitingValue, onExitComplete } = useTabsContext();
  const reducedMotion = usePrefersReducedMotion();

  const isActive = activeValue === value;
  const isExiting = exitingValue === value;

  // Render if: exiting (fade-out), or active with no pending exit (fade-in)
  const shouldRender = isExiting || (isActive && exitingValue === null);
  if (!shouldRender) return null;

  const animClass = reducedMotion
    ? undefined
    : isExiting
      ? "fade-out"
      : "fade-in";

  function handleAnimationEnd(e: AnimationEvent) {
    // Ignore bubbled animation events from children
    if (e.target !== e.currentTarget) return;
    if (isExiting) {
      onExitComplete();
    }
  }

  return (
    <div
      ref={ref}
      id={`${baseId}-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn(animClass, "tabs-panel", className)}
      onAnimationEnd={handleAnimationEnd}
      {...props}
    >
      {children}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanel,
});
