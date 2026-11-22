import { useCallback, useEffect, useRef, useState } from "react";

import { WRITE_ERROR_CODES } from "@/shared/constants/offline-sync";
import { copyMyVersion } from "@/web/components/sync/copy-my-version";
import type { ToastAction } from "@/web/components/ui/Toast";
import type { Task } from "@/web/contexts/ProjectContext";
import { ApiError } from "@/web/lib/api/client";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

/** A PATCH /api/tasks/:id body: task fields plus the description compare-and-set base. */
export type TaskPatch = Partial<TaskDetail> & { descriptionBase?: string | null };

const PATCH_VERBS: Partial<Record<keyof TaskDetail, string>> = {
  title: "Rename",
  description: "Edit description of",
  priority: "Set priority of",
  assigneeId: "Assign",
  dueDate: "Set due date of",
  startDate: "Set start date of",
  cost: "Set cost of",
  icon: "Set icon of",
  labels: "Set labels of",
  recurrenceRule: "Set repeat of",
};

/** The sync-status label for a task PATCH, e.g. `Set priority of “Fix login”`. */
export function taskPatchLabel(title: string | undefined, updates: TaskPatch): string {
  const keys = Object.keys(updates).filter((k) => k !== "descriptionBase") as (keyof TaskDetail)[];
  const verb = (keys.length === 1 && PATCH_VERBS[keys[0]]) || "Edit";
  return `${verb} “${title ?? "task"}”`;
}

const CONFLICT_TOAST_MS = 15_000;

interface UseTaskEditingOptions {
  taskId: string;
  localTask: TaskDetail | null;
  setLocalTask: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  updateTaskInContext: (taskId: string, updates: Partial<Task>) => void;
  patchTaskMutateAsync: (updates: TaskPatch) => Promise<unknown>;
  toast: (
    message: string,
    options?: {
      variant?: "info" | "success" | "warning" | "error";
      title?: string;
      duration?: number;
      action?: ToastAction;
    },
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
 * Description saves are compare-and-set: they carry the description the edit
 * started from (`descriptionBase`), so a collaborator's change in the meantime
 * is refused by the server instead of overwritten.
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
  const [costDisplay, setCostDisplay] = useState("");

  // Sync local editable fields when fresh task data arrives from the server
  // — skip fields the user is currently editing to prevent clobbering input.
  // The description draft is not synced here: EditableMarkdown owns it and
  // guards it against background `value` changes itself.
  const taskDataTaskId = taskData?.task?.id;
  useEffect(() => {
    if (taskData?.task) {
      const t = taskData.task;
      // Defer to avoid synchronous setState in effect body
      queueMicrotask(() => {
        if (!dirtyFields.current.has("title")) setTitleValue(t.title);
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

  // The description the open editor was seeded from.
  const descriptionBase = useRef<string | null>(null);
  const currentDescription = localTask?.description ?? "";

  /** `EditableMarkdown`'s `onEditStart`. */
  const handleDescriptionEditStart = useCallback((seed: string) => {
    descriptionBase.current = seed;
  }, []);

  /** Rejects when not saved, so EditableMarkdown keeps the draft open. */
  const handleDescriptionSave = useCallback(
    async (next: string) => {
      const description = next || null;
      const base = descriptionBase.current ?? currentDescription;
      updateTaskInContext(taskId, { description });
      setLocalTask((prev) => (prev ? { ...prev, description } : prev));
      try {
        await patchTaskMutateAsync({ description, descriptionBase: base });
        descriptionBase.current = null;
      } catch (err) {
        if (err instanceof ApiError && err.code === WRITE_ERROR_CODES.descriptionConflict) {
          const current = (err.body as { task?: TaskDetail } | undefined)?.task;
          if (current) {
            setLocalTask(current);
            updateTaskInContext(taskId, current);
          }
          // Saving again from the same draft now knowingly replaces their version.
          descriptionBase.current = current?.description ?? null;
          toast(
            "Someone else changed this description while you were editing, so your edit wasn't saved. Your text is still in the editor.",
            {
              variant: "error",
              title: "Description not saved",
              duration: CONFLICT_TOAST_MS,
              action: { label: "Copy my version", onClick: () => copyMyVersion(next, toast) },
            },
          );
        } else {
          toast("Failed to update task", { variant: "error" });
        }
        void refetch();
        throw err;
      }
    },
    [taskId, currentDescription, updateTaskInContext, setLocalTask, patchTaskMutateAsync, toast, refetch],
  );

  const handleTitleSave = useCallback(async () => {
    setEditingTitle(false);
    dirtyFields.current.delete("title");
    if (titleValue.trim() && titleValue !== localTask?.title) {
      await handlePatch({ title: titleValue.trim() });
    }
  }, [titleValue, localTask?.title, handlePatch]);

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
    costDisplay,
    setCostDisplay,
    handlePatch,
    handleTitleSave,
    handleCostBlur,
    handleDescriptionSave,
    handleDescriptionEditStart,
  };
}
