import { type ComponentPropsWithRef, forwardRef, useCallback } from "react";

import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TaskCheckboxProps = {
  /** Whether the checkbox is checked (task completed). */
  checked?: boolean;
  /** Called when the checked state changes. */
  onChange?: (checked: boolean) => void;
  /** Disables interaction. */
  disabled?: boolean;
  /** Visual size of the circular checkbox. */
  size?: "sm" | "md";
} & Omit<ComponentPropsWithRef<"input">, "type" | "onChange" | "size">;

/* ------------------------------------------------------------------ */
/*  Size configuration                                                 */
/* ------------------------------------------------------------------ */

const sizeConfig = {
  sm: { svg: 20, radius: 8, center: 10 },
  md: { svg: 24, radius: 10, center: 12 },
} as const;

/**
 * Checkmark path data. Designed for a 24x24 viewBox but scaled via
 * the SVG viewBox so it works at both sizes.
 */
const CHECK_PATH = "M7 12.5l3 3 7-7";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Animated circular checkbox for task and subtask completion.
 *
 * Uses a hidden native <input type="checkbox"> for form semantics and
 * accessibility, overlaid with an SVG that animates the circle fill
 * and checkmark stroke on toggle. The animation uses stroke-dasharray /
 * stroke-dashoffset for the checkmark draw-in and a CSS scale pulse
 * on the circle, respecting prefers-reduced-motion.
 */
export const TaskCheckbox = forwardRef<HTMLInputElement, TaskCheckboxProps>(
  function TaskCheckbox(
    { checked = false, onChange, disabled = false, size = "md", className, ...props },
    ref
  ) {
    const { svg } = sizeConfig[size];

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange?.(e.target.checked);
      },
      [onChange]
    );

    return (
      <label
        className={cn(
          "task-checkbox",
          checked && "task-checkbox--checked",
          disabled && "task-checkbox--disabled",
          className
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          className="task-checkbox__input"
          {...props}
        />
        <svg
          className="task-checkbox__svg"
          width={svg}
          height={svg}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="task-checkbox__circle"
            cx={12}
            cy={12}
            r={10}
          />
          <path
            className="task-checkbox__check"
            d={CHECK_PATH}
          />
        </svg>
      </label>
    );
  }
);
