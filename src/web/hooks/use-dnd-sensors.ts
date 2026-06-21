import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/**
 * Shared dnd-kit sensor set for every drag-and-drop surface in the app
 * (board columns/cards, sidebar project nav, subtask lists).
 *
 * ## Why MouseSensor + TouchSensor instead of PointerSensor
 *
 * The previous setup used a single `PointerSensor` with a 5px distance
 * activation constraint. `PointerSensor` unifies mouse and touch through the
 * Pointer Events API, which sounds convenient but is actively hostile to
 * touch: on a phone, the same finger gesture that should scroll a column is
 * also a pointer drag. With only a 5px distance threshold, the browser claims
 * the gesture for native scrolling and fires `pointercancel` before dnd-kit
 * ever crosses that threshold — so on touch devices the drag never activates
 * and the user simply scrolls. There was also no alternative (menu/keyboard)
 * path to reorder, so reordering within a column was effectively impossible on
 * mobile. This is the exact failure the split-sensor setup fixes.
 *
 * dnd-kit's own guidance is: "If you'd like to have different activation
 * constraints for mouse and touch input, use the MouseSensor and TouchSensor
 * instead of the PointerSensor." Each input type then gets the activation model
 * that suits it:
 *
 * - **Mouse** — 5px distance threshold. A drag begins the instant the cursor
 *   moves past 5px, preserving the exact desktop behavior we had before.
 * - **Touch** — press-and-hold (`delay`) with a movement `tolerance`. Holding
 *   still for `TOUCH_ACTIVATION_DELAY_MS` starts a drag; dnd-kit then calls
 *   `preventDefault` on `touchmove` so the list doesn't scroll mid-drag. Moving
 *   further than `TOUCH_ACTIVATION_TOLERANCE_PX` before the delay elapses is
 *   interpreted as a scroll and cancels the pending drag. This lets a single
 *   finger BOTH scroll the column (quick swipe) and reorder cards (hold, then
 *   drag) without a `touch-action: none` rule — which would have permanently
 *   broken finger-scrolling of the column.
 *
 * Keeping this in one hook is the single source of truth for drag activation
 * so the three surfaces can never drift apart (e.g. one staying touch-broken).
 */

/** Press-and-hold duration (ms) before a touch drag activates. */
const TOUCH_ACTIVATION_DELAY_MS = 220;
/** Max finger travel (px) allowed during the hold before it's treated as a scroll. */
const TOUCH_ACTIVATION_TOLERANCE_PX = 8;
/** Mouse pointer travel (px) before a mouse drag activates. */
const MOUSE_ACTIVATION_DISTANCE_PX = 5;

interface UseDndSensorsOptions {
  /**
   * When false, no sensors are returned, fully disabling drag-and-drop (e.g.
   * for users without edit permission). Defaults to true. The sensor hooks are
   * still called unconditionally to satisfy the rules of hooks — only their
   * inclusion in the returned set is gated.
   */
  enabled?: boolean;
  /**
   * When true, includes a `KeyboardSensor` for accessible keyboard dragging
   * (space/enter to grab, arrow keys to move). Defaults to false; the board
   * opts in to match its prior behavior.
   */
  keyboard?: boolean;
}

/**
 * Returns the standard mouse + touch (+ optional keyboard) dnd-kit sensor set.
 *
 * @example
 * // Board: keyboard-accessible, gated on edit permission
 * const sensors = useDndSensors({ keyboard: true, enabled: canEditTasks });
 *
 * @example
 * // Sidebar / subtasks: mouse + touch only
 * const sensors = useDndSensors();
 */
export function useDndSensors({ enabled = true, keyboard = false }: UseDndSensorsOptions = {}) {
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: MOUSE_ACTIVATION_DISTANCE_PX },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: TOUCH_ACTIVATION_DELAY_MS,
      tolerance: TOUCH_ACTIVATION_TOLERANCE_PX,
    },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });

  return useSensors(
    enabled ? mouseSensor : undefined,
    enabled ? touchSensor : undefined,
    enabled && keyboard ? keyboardSensor : undefined
  );
}
