import {
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { UseMutationResult } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import type { Subtask, Task } from "@/web/contexts/ProjectContext";
import { useDndSensors } from "@/web/hooks/use-dnd-sensors";
import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { sortByPosition } from "@/web/lib/sort-by-position";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

interface UseTaskSubtasksOptions {
  taskId: string;
  localTask: TaskDetail | null;
  setLocalTask: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  updateTaskInContext: (taskId: string, updates: Partial<Task>) => void;
  invalidateTaskQueries: () => void;
  toast: (
    message: string,
    options?: { variant?: "info" | "success" | "warning" | "error" },
  ) => string;
  createSubtask: UseMutationResult<
    { subtask: Subtask },
    Error,
    { title: string }
  >;
}

/**
 * Encapsulates all subtask state and handlers for the task detail panel:
 * DnD sensors, sorted subtask memos, active drag state, and CRUD
 * operations with optimistic updates and rollback.
 *
 * Extracted from TaskDetailPanelInner to keep the component focused on
 * rendering while this hook owns the subtask domain logic. The optimistic
 * update/rollback pattern for each operation ensures the UI stays
 * responsive and self-corrects on API failures.
 */
export function useTaskSubtasks({
  taskId,
  localTask,
  setLocalTask,
  updateTaskInContext,
  invalidateTaskQueries,
  toast,
  createSubtask,
}: UseTaskSubtasksOptions) {
  const subtaskSensors = useDndSensors();

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
      const completedCount =
        localTask?.subtasks.filter((s) => s.completed).length ?? 0;
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
      updateTaskInContext(taskId, {
        subtaskCompletedCount: subtask.completed
          ? Math.max(0, completedCount - 1)
          : completedCount + 1,
      });
      try {
        await api.patch(`/api/subtasks/${subtask.id}`, {
          completed: !subtask.completed,
        });
        invalidateTaskQueries();
      } catch {
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
        updateTaskInContext(taskId, { subtaskCompletedCount: completedCount });
        toast("Failed to update subtask", { variant: "error" });
      }
    },
    [
      taskId,
      localTask?.subtasks,
      setLocalTask,
      updateTaskInContext,
      invalidateTaskQueries,
      toast,
    ],
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
      id: `optimistic-${crypto.randomUUID()}`,
      title,
      completed: false,
      position: generateKeyBetween(lastPosition, null),
    };
    setLocalTask((prev) => {
      if (!prev) return prev;
      return { ...prev, subtasks: [...prev.subtasks, optimisticSubtask] };
    });
    updateTaskInContext(taskId, {
      subtaskCount: (localTask?.subtasks.length ?? 0) + 1,
    });

    try {
      const result = await createSubtask.mutateAsync({ title });
      // Replace optimistic subtask with server-returned subtask
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === optimisticSubtask.id ? result.subtask : s,
          ),
        };
      });
    } catch {
      // Remove optimistic subtask on failure
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.filter((s) => s.id !== optimisticSubtask.id),
        };
      });
      updateTaskInContext(taskId, {
        subtaskCount: Math.max(0, (localTask?.subtasks.length ?? 1) - 1),
      });
      toast("Failed to add subtask", { variant: "error" });
    }
  }, [
    newSubtaskTitle,
    sortedSubtasks,
    taskId,
    localTask?.subtasks.length,
    setLocalTask,
    updateTaskInContext,
    createSubtask,
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
      updateTaskInContext(taskId, {
        subtaskCount: Math.max(0, (localTask?.subtasks.length ?? 1) - 1),
        subtaskCompletedCount: removedSubtask.completed
          ? Math.max(
              0,
              (localTask?.subtasks.filter((s) => s.completed).length ?? 1) - 1,
            )
          : (localTask?.subtasks.filter((s) => s.completed).length ?? 0),
      });

      try {
        await api.delete(`/api/subtasks/${subtaskId}`);
        invalidateTaskQueries();
      } catch {
        // Restore on failure
        setLocalTask((prev) => {
          if (!prev) return prev;
          return { ...prev, subtasks: [...prev.subtasks, removedSubtask] };
        });
        updateTaskInContext(taskId, {
          subtaskCount: localTask?.subtasks.length ?? 0,
          subtaskCompletedCount:
            localTask?.subtasks.filter((s) => s.completed).length ?? 0,
        });
        toast("Failed to delete subtask", { variant: "error" });
      }
    },
    [
      taskId,
      localTask?.subtasks,
      setLocalTask,
      updateTaskInContext,
      invalidateTaskQueries,
      toast,
    ],
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
        await api.patch(`/api/subtasks/${subtaskId}`, { title });
        invalidateTaskQueries();
      } catch {
        setLocalTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            subtasks: prev.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, title: oldTitle ?? title } : s,
            ),
          };
        });
        toast("Failed to rename subtask", { variant: "error" });
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
        await api.patch(`/api/subtasks/${movedSubtask.id}`, {
          position: newPosition,
        });
        invalidateTaskQueries();
      } catch {
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
        toast("Failed to reorder subtask", { variant: "error" });
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
