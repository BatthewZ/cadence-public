import {
  type ComponentPropsWithRef,
  createContext,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";

import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type Mode = "single" | "multiple";

type AccordionContextValue = {
  openValues: string[];
  toggle: (value: string) => void;
  mode: Mode;
  baseId: string;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext() {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error("Accordion compound components must be used within <Accordion>");
  return ctx;
}

type ItemContextValue = {
  value: string;
  isOpen: boolean;
  disabled: boolean;
  triggerId: string;
  contentId: string;
};

const ItemContext = createContext<ItemContextValue | null>(null);

function useItemContext() {
  const ctx = useContext(ItemContext);
  if (!ctx) throw new Error("Accordion.Trigger/Content must be used within <Accordion.Item>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Accordion (root)                                                   */
/* ------------------------------------------------------------------ */

type AccordionProps = {
  mode?: Mode;
  defaultValue?: string | string[];
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
} & Omit<ComponentPropsWithRef<"div">, "defaultValue">;

function normalizeValues(val: string | string[] | undefined): string[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

const AccordionRoot = forwardRef<HTMLDivElement, AccordionProps>(function Accordion(
  {
    mode = "single",
    defaultValue,
    value: controlledValue,
    onValueChange,
    className,
    children,
    ...props
  },
  ref
) {
  const [uncontrolledValue, setUncontrolledValue] = useState(() => normalizeValues(defaultValue));
  const baseId = useId();

  const isControlled = controlledValue !== undefined;
  const openValues = isControlled ? normalizeValues(controlledValue) : uncontrolledValue;

  const toggle = useCallback(
    (itemValue: string) => {
      let next: string[];

      if (mode === "single") {
        next = openValues.includes(itemValue) ? [] : [itemValue];
      } else {
        next = openValues.includes(itemValue)
          ? openValues.filter((v) => v !== itemValue)
          : [...openValues, itemValue];
      }

      if (!isControlled) {
        setUncontrolledValue(next);
      }
      onValueChange?.(mode === "single" ? (next[0] ?? "") : next);
    },
    [mode, openValues, isControlled, onValueChange]
  );

  return (
    <AccordionContext.Provider value={{ openValues, toggle, mode, baseId }}>
      <div ref={ref} className={cn("accordion", className)} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
});

/* ------------------------------------------------------------------ */
/*  Accordion.Item                                                     */
/* ------------------------------------------------------------------ */

type AccordionItemProps = {
  value: string;
  disabled?: boolean;
} & Omit<ComponentPropsWithRef<"div">, "value">;

const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(function AccordionItem(
  { value, disabled = false, className, children, ...props },
  ref
) {
  const { openValues, baseId } = useAccordionContext();
  const isOpen = openValues.includes(value);
  const triggerId = `${baseId}-trigger-${value}`;
  const contentId = `${baseId}-content-${value}`;

  return (
    <ItemContext.Provider value={{ value, isOpen, disabled, triggerId, contentId }}>
      <div
        ref={ref}
        className={cn("accordion-item", className)}
        data-state={isOpen ? "open" : "closed"}
        data-disabled={disabled || undefined}
        {...props}
      >
        {children}
      </div>
    </ItemContext.Provider>
  );
});

/* ------------------------------------------------------------------ */
/*  Accordion.Trigger                                                  */
/* ------------------------------------------------------------------ */

type AccordionTriggerProps = ComponentPropsWithRef<"button">;

const AccordionTrigger = forwardRef<HTMLButtonElement, AccordionTriggerProps>(
  function AccordionTrigger({ className, children, ...props }, ref) {
    const { toggle } = useAccordionContext();
    const { value, isOpen, disabled, triggerId, contentId } = useItemContext();

    function handleClick() {
      if (!disabled) {
        toggle(value);
      }
    }

    function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
      const accordion = e.currentTarget.closest(".accordion");
      if (!accordion) return;

      const triggers = Array.from(
        accordion.querySelectorAll<HTMLButtonElement>(".accordion-trigger:not(:disabled)")
      );
      const currentIndex = triggers.indexOf(e.currentTarget);
      if (currentIndex === -1) return;

      let nextIndex: number | undefined;

      switch (e.key) {
        case "ArrowDown":
          nextIndex = (currentIndex + 1) % triggers.length;
          break;
        case "ArrowUp":
          nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = triggers.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      triggers[nextIndex].focus();
    }

    return (
      <button
        ref={ref}
        id={triggerId}
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        disabled={disabled}
        className={cn("accordion-trigger", className)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...props}
      >
        <span className="accordion-trigger-text">{children}</span>
        <svg
          className="accordion-chevron"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Accordion.Content                                                  */
/* ------------------------------------------------------------------ */

type AccordionContentProps = ComponentPropsWithRef<"div">;

const AccordionContent = forwardRef<HTMLDivElement, AccordionContentProps>(
  function AccordionContent({ className, children, ...props }, ref) {
    const { isOpen, triggerId, contentId } = useItemContext();

    return (
      <div
        ref={ref}
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        data-state={isOpen ? "open" : "closed"}
        className={cn("accordion-content", className)}
        {...props}
      >
        <div className="accordion-content-inner">{children}</div>
      </div>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const Accordion = Object.assign(AccordionRoot, {
  Item: AccordionItem,
  Trigger: AccordionTrigger,
  Content: AccordionContent,
});
