import { type MouseEvent, useCallback, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  useMultiSelect                                                     */
/*                                                                     */
/*  Shared multi-select state management for task views (ProjectBoard  */
/*  and ProjectTimeline). Encapsulates the selected-ID set, toggle     */
/*  behaviour, Escape-key clearing, and returns a stable API so each   */
/*  view doesn't reimplement identical logic.                          */
/* ------------------------------------------------------------------ */

interface UseMultiSelectReturn {
  /** Currently selected task IDs. */
  selectedIds: Set<string>;
  /**
   * Toggle a task in/out of the selection.
   * The optional `MouseEvent` parameter lets callers pass the click event
   * so `preventDefault()` is called automatically (board cards need this
   * to stop the click from opening the task detail panel).
   */
  handleToggleSelect: (taskId: string, e?: MouseEvent) => void;
  /** Clear all selected IDs. */
  handleClearSelection: () => void;
}

export function useMultiSelect(): UseMultiSelectReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggleSelect = useCallback((taskId: string, e?: MouseEvent) => {
    if (e) {
      e.preventDefault();
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Escape key clears selection
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClearSelection();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds.size, handleClearSelection]);

  return { selectedIds, handleToggleSelect, handleClearSelection };
}
