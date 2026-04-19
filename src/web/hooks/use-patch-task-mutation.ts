import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Task } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";
import { patchTaskInCaches, quietInvalidateTaskStats } from "@/web/lib/task-cache-patches";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

interface UsePatchTaskMutationOptions {
  taskId: string;
  workspaceId: string;
  projectId?: string;
}

/**
 * Optimistic field-edit mutation: patch every cache that holds this task up
 * front, then keep the network footprint to the single PATCH itself. Stats
 * are marked stale via refetchType:'none' so they refresh on next mount/focus
 * instead of cascading refetches into the current action.
 *
 * Shared between TaskDetailDialog and TaskDetailPanelInner — both edit the
 * same fields through the same endpoint and need identical cache plumbing.
 */
export function usePatchTaskMutation({
  taskId,
  workspaceId,
  projectId,
}: UsePatchTaskMutationOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<TaskDetail>) =>
      api.patch<{ task: TaskDetail }>(`/api/tasks/${taskId}`, updates),
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      freshnessTracker.recordMutation("tasks");
      const rollback = patchTaskInCaches(qc, {
        taskId,
        workspaceId,
        projectId,
        patch: updates as Partial<Task>,
      });
      return { rollback };
    },
    onError: (_err, _updates, context) => {
      context?.rollback();
    },
    onSuccess: (data) => {
      // Merge — the PATCH response is the bare task without hydrated relations
      // (subtasks, labels). Replacing the cache would wipe them and crash
      // useTaskSubtasks. Spread the response over the existing cached task.
      qc.setQueryData<{ task: TaskDetail }>(queryKeys.tasks.detail(taskId), (prev) => {
        if (!prev?.task) return data;
        return { task: { ...prev.task, ...data.task } };
      });
      quietInvalidateTaskStats(qc, workspaceId, projectId);
    },
  });
}
