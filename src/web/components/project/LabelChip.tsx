import type { MouseEventHandler, PointerEventHandler, TouchEventHandler } from "react";

import type { TaskLabelInfo } from "@/shared/schemas/label";

interface LabelChipProps {
  label: TaskLabelInfo;
  /** Visual size variant: "sm" for board cards, "default" for detail panels */
  size?: "sm" | "default";
  className?: string;
  /**
   * When provided, the chip renders as a real `<button type="button">`
   * (with an accessible "Filter by label: <name>" label) instead of a span.
   * Used for click-to-filter on task cards; all other call sites omit it and
   * keep the inert span unchanged.
   */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /**
   * Forwarded alongside `onClick` so callers inside dnd-kit draggables can
   * `stopPropagation` and keep a press on the chip from arming a card drag.
   * All three of `pointerdown`/`mousedown`/`touchstart` are exposed because the
   * board's drag sensors changed from a single PointerSensor (armed by
   * `pointerdown`) to a MouseSensor + TouchSensor pair (armed by `mousedown` and
   * `touchstart` respectively) — guarding `pointerdown` alone would no longer
   * stop the drag.
   */
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  /** See {@link LabelChipProps.onPointerDown} — covers the MouseSensor activator. */
  onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  /** See {@link LabelChipProps.onPointerDown} — covers the TouchSensor activator. */
  onTouchStart?: TouchEventHandler<HTMLButtonElement>;
}

/**
 * Renders a colored label chip. Reused across the board, task detail, and
 * label picker so the visual treatment stays consistent. Optionally
 * interactive (see {@link LabelChipProps.onClick}) for click-to-filter.
 */
export function LabelChip({
  label: lbl,
  size = "default",
  className,
  onClick,
  onPointerDown,
  onMouseDown,
  onTouchStart,
}: LabelChipProps) {
  const sizeClass =
    size === "sm"
      ? "inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-medium leading-none"
      : "task-label-picker__chip";
  const style = {
    backgroundColor: lbl.color + "20",
    color: lbl.color,
  };

  if (onClick) {
    return (
      <button
        type="button"
        aria-label={`Filter by label: ${lbl.name}`}
        className={`${sizeClass} cursor-pointer transition-shadow hover:ring-1 hover:ring-current ${className ?? ""}`}
        style={style}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        {lbl.name}
      </button>
    );
  }

  return (
    <span className={`${sizeClass} ${className ?? ""}`} style={style}>
      {lbl.name}
    </span>
  );
}
