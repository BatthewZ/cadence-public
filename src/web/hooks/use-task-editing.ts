import { useCallback, useEffect, useRef, useState } from "react";

import type { Task } from "@/web/contexts/ProjectContext";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

interface UseTaskEditingOptions {
  taskId: string;
  localTask: TaskDetail | null;
  setLocalTask: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  updateTaskInContext: (taskId: string, updates: Partial<Task>) => void;
  patchTaskMutateAsync: (updates: Partial<TaskDetail>) => Promise<unknown>;
  toast: (
    message: string,
    options?: { variant?: "info" | "success" | "warning" | "error" },
  ) => string;
  refetch: () => Promise<unknown>;
  /** The task data from the server query, used to sync editable fields. */
  taskData: { task: TaskDetail } | undefined;
}

/**
 * Manages the editable fields (title, description, cost) of a task detail
 * panel, including dirty-field tracking to prevent server refetches from
 * clobbering in-progress user input.
 *
 * The dirty-field pattern works by marking fields as dirty on focus and
 * clearing them on blur/save. While a field is dirty, incoming server
 * data for that field is ignored, preserving the user's unsaved edits.
 * This is critical for fields where the user is actively typing while
 * background query invalidation brings in fresh data.
 */
export function useTaskEditing({
  taskId,
  localTask,
  setLocalTask,
  updateTaskInContext,
  patchTaskMutateAsync,
  toast,
  refetch,
  taskData,
}: UseTaskEditingOptions) {
  // Track which fields the user is actively editing so server refetches
  // don't clobber in-progress input (ref to avoid re-renders).
  const dirtyFields = useRef<Set<string>>(new Set());

  // Local editable state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [descriptionValue, setDescriptionValue] = useState("");
  const [costDisplay, setCostDisplay] = useState("");

  // Sync local editable fields when fresh task data arrives from the server
  // — skip fields the user is currently editing to prevent clobbering input.
  const taskDataTaskId = taskData?.task?.id;
  useEffect(() => {
    if (taskData?.task) {
      const t = taskData.task;
      // Defer to avoid synchronous setState in effect body
      queueMicrotask(() => {
        if (!dirtyFields.current.has("title")) setTitleValue(t.title);
        if (!dirtyFields.current.has("description"))
          setDescriptionValue(t.description ?? "");
        if (!dirtyFields.current.has("cost"))
          setCostDisplay(t.cost != null ? (t.cost / 100).toFixed(2) : "");
      });
    }
  }, [taskDataTaskId, taskData]);

  const handlePatch = useCallback(
    async (updates: Partial<TaskDetail>) => {
      // Optimistic: update board/list context AND local panel state
      updateTaskInContext(taskId, updates);
      setLocalTask((prev) => (prev ? { ...prev, ...updates } : prev));
      try {
        await patchTaskMutateAsync(updates);
      } catch {
        toast("Failed to update task", { variant: "error" });
        void refetch(); // revert to server state on failure
      }
    },
    [taskId, updateTaskInContext, setLocalTask, patchTaskMutateAsync, toast, refetch],
  );

  const handleTitleSave = useCallback(async () => {
    setEditingTitle(false);
    dirtyFields.current.delete("title");
    if (titleValue.trim() && titleValue !== localTask?.title) {
      await handlePatch({ title: titleValue.trim() });
    }
  }, [titleValue, localTask?.title, handlePatch]);

  const handleDescriptionBlur = useCallback(async () => {
    dirtyFields.current.delete("description");
    if (descriptionValue !== (localTask?.description ?? "")) {
      await handlePatch({ description: descriptionValue || null });
    }
  }, [descriptionValue, localTask?.description, handlePatch]);

  const handleCostBlur = useCallback(async () => {
    dirtyFields.current.delete("cost");
    const parsed = parseFloat(costDisplay);
    const newCostCents =
      costDisplay.trim() === "" ? null : Math.round(parsed * 100);
    const currentCost = localTask?.cost ?? null;

    if (newCostCents !== currentCost && !Number.isNaN(parsed)) {
      await handlePatch({ cost: newCostCents } as Partial<TaskDetail>);
    } else if (costDisplay.trim() === "" && currentCost !== null) {
      await handlePatch({ cost: null } as Partial<TaskDetail>);
    }
  }, [costDisplay, localTask?.cost, handlePatch]);

  return {
    dirtyFields,
    editingTitle,
    setEditingTitle,
    titleValue,
    setTitleValue,
    descriptionValue,
    setDescriptionValue,
    costDisplay,
    setCostDisplay,
    handlePatch,
    handleTitleSave,
    handleDescriptionBlur,
    handleCostBlur,
  };
}
