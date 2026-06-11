import { forwardRef } from "react";

import { cn } from "@/web/util/style/style";

/**
 * Accessible toggle switch (button + role="switch") primitive.
 *
 * ## Why a button, not a styled checkbox
 *
 * A checkbox communicates "select one of many" or "agree to terms". A toggle
 * communicates "this setting is on/off and the change takes effect now".
 * Screen readers announce `role="switch"` with the correct "on"/"off" cue
 * (rather than "checked/unchecked"), and `aria-checked` reflects state for
 * assistive tech without us depending on the underlying input element's
 * implicit semantics.
 *
 * ## Why a shared primitive
 *
 * Before this component, every place that wanted a switch (TaskGroupsTab's
 * "Completion Group" toggle, ApiTokensTab's "Show revoked" toggle) inlined
 * the same Tailwind classes with subtle drift. A single source of truth (per
 * CLAUDE.md Rule 4) means a future design-token rename or motion tweak
 * touches one file rather than N divergent copies.
 *
 * ## Variants
 *
 * - **tone**: `"accent"` (default) for neutral preferences; `"success"` for
 *   confirmation-style toggles where green carries semantic weight (e.g.
 *   "this group marks tasks as completed"). We intentionally don't expose
 *   the full status palette — adding more tones tends to dilute the signal.
 * - **size**: `"md"` (default, 24×44px) matches the rest of the form
 *   controls; `"sm"` (20×36px) for dense rows.
 */
export type ToggleProps = {
  /** Current on/off state. Controlled — callers own the value. */
  checked: boolean;
  /**
   * Called with the next state when the user toggles. Mirrors the
   * Radix / shadcn naming so consumers don't need to adapt React's `onChange`
   * event shape.
   */
  onCheckedChange: (next: boolean) => void;
  /** Native disabled — pointer events off, opacity dimmed, no state changes fire. */
  disabled?: boolean;
  /**
   * Either pass an `aria-label` (for unlabeled toggles) or wrap the toggle
   * with a `<label htmlFor={id}>` and pass the same `id` here. We don't
   * enforce either at the type level (some consumers use `aria-labelledby`)
   * but a toggle with neither will fail axe.
   */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** See JSDoc on the type. */
  tone?: "accent" | "success";
  /** See JSDoc on the type. */
  size?: "sm" | "md";
  /** Escape hatch for one-off layout tweaks; merged via `cn`. */
  className?: string;
};

const SIZES = {
  sm: {
    track: "h-5 w-9",
    thumb: "size-3.5",
    // Thumb travel = track width − thumb width − (2 × inset). Sub-pixel
    // arithmetic is fine here because translate is GPU-rasterised; what
    // matters is that the off and on positions are visually symmetric.
    thumbOn: "translate-x-[18px]",
    thumbOff: "translate-x-0.5",
  },
  md: {
    track: "h-6 w-11",
    thumb: "size-4",
    thumbOn: "translate-x-6",
    thumbOff: "translate-x-1",
  },
} as const;

const TONES = {
  // `bg-accent` follows the active workspace theme — keeping settings
  // toggles colour-coordinated with the rest of the surface chrome.
  accent: "bg-accent",
  // Reserved for toggles where green is the semantic signal, not just the
  // active colour (e.g. "this group marks tasks completed").
  success: "bg-status-success",
} as const;

/**
 * Render a controlled toggle switch. Forwarded ref points at the underlying
 * button so consumers can focus / measure it without reaching for a DOM
 * query.
 */
export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  {
    checked,
    onCheckedChange,
    disabled,
    id,
    tone = "accent",
    size = "md",
    className,
    ...aria
  },
  ref,
) {
  const sz = SIZES[size];
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sz.track,
        checked ? TONES[tone] : "bg-border-default",
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          "inline-block transform rounded-full bg-white shadow-sm transition-transform",
          sz.thumb,
          checked ? sz.thumbOn : sz.thumbOff,
        )}
      />
    </button>
  );
});
