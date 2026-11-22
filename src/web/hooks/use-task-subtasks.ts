import {
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import type { Subtask, Task } from "@/web/contexts/ProjectContext";
import { useDndSensors } from "@/web/hooks/use-dnd-sensors";
import { apiErrorMessage } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";
import { sortByPosition } from "@/web/lib/sort-by-position";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

interface UseTaskSubtasksOptions {
  taskId: string;
  localTask: TaskDetail | null;
  /** From `useLocalTask`: it writes each edit to the task's detail query, which the card counts are read from. */
  setLocalTask: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  updateTaskInContext: (taskId: string, updates: Partial<Task>) => void;
  invalidateTaskQueries: () => void;
  toast: (
    message: string,
    options?: { variant?: "info" | "success" | "warning" | "error" },
  ) => string;
}

/**
 * Encapsulates all subtask state and handlers for the task detail panel:
 * DnD sensors, sorted subtask memos, active drag state, and CRUD
 * operations with optimistic updates and rollback.
 *
 * Every write goes through `sendWrite`, so it also works offline: a queued
 * write keeps its optimistic state and skips the refetch (the queue's drain
 * refreshes the cache); only a refusal rolls back.
 */
export function useTaskSubtasks({
  taskId,
  localTask,
  setLocalTask,
  updateTaskInContext,
  invalidateTaskQueries,
  toast,
}: UseTaskSubtasksOptions) {
  const subtaskSensors = useDndSensors();
  const qc = useQueryClient();

  // The board card's counts, copied from the subtasks as they stand after an edit, never worked
  // out from a captured list: that miscounted a rollback and edits made before an earlier one settled.
  const syncCardCounts = useCallback(() => {
    const current = qc.getQueryData<{ task: TaskDetail }>(queryKeys.tasks.detail(taskId))?.task.subtasks;
    if (!current) return;
    updateTaskInContext(taskId, {
      subtaskCount: current.length,
      subtaskCompletedCount: current.filter((s) => s.completed).length,
    });
  }, [qc, taskId, updateTaskInContext]);

  const subtasks = localTask?.subtasks;
  const sortedSubtasks = useMemo(
    () => (subtasks ? sortByPosition(subtasks) : []),
    [subtasks],
  );
  const subtaskIds = useMemo(
    () => sortedSubtasks.map((s) => s.id),
    [sortedSubtasks],
  );

  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);
  const activeSubtask = activeSubtaskId
    ? (sortedSubtasks.find((s) => s.id === activeSubtaskId) ?? null)
    : null;

  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const handleSubtaskToggle = useCallback(
    async (subtask: Subtask) => {
      freshnessTracker.recordMutation("tasks");
      // Optimistic toggle
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === subtask.id ? { ...s, completed: !s.completed } : s,
          ),
        };
      });
      syncCardCounts();
      try {
        const result = await sendWrite({
          method: "PATCH",
          path: `/api/subtasks/${subtask.id}`,
          body: { completed: !subtask.completed },
          label: `${subtask.completed ? "Reopen" : "Complete"} subtask “${subtask.title}”`,
        });
        if (result.status === "sent") invalidateTaskQueries();
      } catch (err) {
        // Revert
        setLocalTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            subtasks: prev.subtasks.map((s) =>
              s.id === subtask.id ? { ...s, completed: subtask.completed } : s,
            ),
          };
        });
        syncCardCounts();
        toast(apiErrorMessage(err, "Failed to update subtask"), { variant: "error" });
      }
    },
    [setLocalTask, syncCardCounts, invalidateTaskQueries, toast],
  );

  const handleAddSubtask = useCallback(async () => {
    if (!newSubtaskTitle.trim()) return;
    freshnessTracker.recordMutation("tasks");
    const title = newSubtaskTitle.trim();
    setNewSubtaskTitle("");

    // Optimistically add subtask to local state
    const lastPosition =
      sortedSubtasks.length > 0
        ? sortedSubtasks[sortedSubtasks.length - 1].position
        : null;
    const optimisticSubtask: Subtask = {
      id: crypto.randomUUID(),
      title,
      completed: false,
      position: generateKeyBetween(lastPosition, null),
    };
    setLocalTask((prev) => {
      if (!prev) return prev;
      return { ...prev, subtasks: [...prev.subtasks, optimisticSubtask] };
    });
    syncCardCounts();

    try {
      const result = await sendWrite<{ subtask: Subtask }>({
        method: "POST",
        path: `/api/tasks/${taskId}/subtasks`,
        body: { id: optimisticSubtask.id, title },
        label: `Add subtask “${title}”`,
      });
      if (result.status === "sent") {
        const { subtask } = result.data;
        setLocalTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            subtasks: prev.subtasks.map((s) => (s.id === subtask.id ? { ...s, ...subtask } : s)),
          };
        });
        invalidateTaskQueries();
      }
    } catch (err) {
      // Remove optimistic subtask on failure
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.filter((s) => s.id !== optimisticSubtask.id),
        };
      });
      syncCardCounts();
      toast(apiErrorMessage(err, "Failed to add subtask"), { variant: "error" });
    }
  }, [
    newSubtaskTitle,
    sortedSubtasks,
    taskId,
    setLocalTask,
    syncCardCounts,
    invalidateTaskQueries,
    toast,
  ]);

  const handleDeleteSubtask = useCallback(
    async (subtaskId: string) => {
      const removedSubtask = localTask?.subtasks.find(
        (s) => s.id === subtaskId,
      );
      if (!removedSubtask) return;
      freshnessTracker.recordMutation("tasks");

      // Remove from local state and update board card counts
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.filter((s) => s.id !== subtaskId),
        };
      });
      syncCardCounts();

      try {
        const result = await sendWrite({
          method: "DELETE",
          path: `/api/subtasks/${subtaskId}`,
          label: `Delete subtask “${removedSubtask.title}”`,
        });
        if (result.status === "sent") invalidateTaskQueries();
      } catch (err) {
        // Restore on failure
        setLocalTask((prev) => {
          if (!prev) return prev;
          return { ...prev, subtasks: [...prev.subtasks, removedSubtask] };
        });
        syncCardCounts();
        toast(apiErrorMessage(err, "Failed to delete subtask"), { variant: "error" });
      }
    },
    [localTask?.subtasks, setLocalTask, syncCardCounts, invalidateTaskQueries, toast],
  );

  const handleRenameSubtask = useCallback(
    async (subtaskId: string, title: string) => {
      freshnessTracker.recordMutation("tasks");
      const oldTitle = localTask?.subtasks.find(
        (s) => s.id === subtaskId,
      )?.title;
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, title } : s,
          ),
        };
      });
      try {
        const result = await sendWrite({
          method: "PATCH",
          path: `/api/subtasks/${subtaskId}`,
          body: { title },
          label: `Rename subtask “${oldTitle ?? title}”`,
        });
        if (result.status === "sent") invalidateTaskQueries();
      } catch (err) {
        setLocalTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            subtasks: prev.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, title: oldTitle ?? title } : s,
            ),
          };
        });
        toast(apiErrorMessage(err, "Failed to rename subtask"), { variant: "error" });
      }
    },
    [localTask?.subtasks, setLocalTask, invalidateTaskQueries, toast],
  );

  const handleSubtaskDragStart = useCallback((event: DragStartEvent) => {
    setActiveSubtaskId(event.active.id as string);
  }, []);

  const handleSubtaskDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveSubtaskId(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !localTask) return;
      freshnessTracker.recordMutation("tasks");

      const oldIndex = sortedSubtasks.findIndex((s) => s.id === active.id);
      const newIndex = sortedSubtasks.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sortedSubtasks, oldIndex, newIndex);
      const above = newIndex > 0 ? reordered[newIndex - 1] : null;
      const below =
        newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
      const newPosition = generateKeyBetween(
        above?.position ?? null,
        below?.position ?? null,
      );

      const movedSubtask = sortedSubtasks[oldIndex];

      // Optimistic update
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === movedSubtask.id ? { ...s, position: newPosition } : s,
          ),
        };
      });

      try {
        const result = await sendWrite({
          method: "PATCH",
          path: `/api/subtasks/${movedSubtask.id}`,
          body: { position: newPosition },
          label: `Reorder subtask “${movedSubtask.title}”`,
        });
        if (result.status === "sent") invalidateTaskQueries();
      } catch (err) {
        setLocalTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            subtasks: prev.subtasks.map((s) =>
              s.id === movedSubtask.id
                ? { ...s, position: movedSubtask.position }
                : s,
            ),
          };
        });
        toast(apiErrorMessage(err, "Failed to reorder subtask"), { variant: "error" });
      }
    },
    [localTask, sortedSubtasks, setLocalTask, invalidateTaskQueries, toast],
  );

  return {
    subtaskSensors,
    sortedSubtasks,
    subtaskIds,
    activeSubtask,
    newSubtaskTitle,
    setNewSubtaskTitle,
    handleSubtaskToggle,
    handleAddSubtask,
    handleDeleteSubtask,
    handleRenameSubtask,
    handleSubtaskDragStart,
    handleSubtaskDragEnd,
  };
}
