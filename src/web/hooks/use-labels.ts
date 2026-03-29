import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TaskLabelInfo } from "@/shared/schemas/label";
import type { Task } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
  taskCount: number;
  createdAt: string;
}

export function useLabels(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.projects.labels(projectId),
    queryFn: () => api.get<{ labels: Label[] }>(`/api/projects/${projectId}/labels`),
    enabled: options?.enabled,
  });
}

export function useCreateLabel(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      api.post<{ label: Label }>(`/api/projects/${projectId}/labels`, input),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.labels(projectId),
      });
    },
  });
}

export function useUpdateLabel(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ labelId, ...input }: { labelId: string; name?: string; color?: string }) =>
      api.patch<{ label: Label }>(`/api/projects/${projectId}/labels/${labelId}`, input),
    onMutate: async ({ labelId, ...input }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: queryKeys.projects.labels(projectId) }),
        qc.cancelQueries({ queryKey: queryKeys.projects.tasks(projectId) }),
      ]);

      const prevLabels = qc.getQueryData<{ labels: Label[] }>(
        queryKeys.projects.labels(projectId)
      );
      const prevTasks = qc.getQueryData<{ tasks: Task[] }>(
        queryKeys.projects.tasks(projectId)
      );

      // Update labels cache
      qc.setQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId), (old) => {
        if (!old) return old;
        return {
          labels: old.labels.map((l) => (l.id === labelId ? { ...l, ...input } : l)),
        };
      });

      // Update embedded label data in all tasks
      qc.setQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId), (old) => {
        if (!old) return old;
        return {
          tasks: old.tasks.map((t) => ({
            ...t,
            labels: t.labels?.map((l) => (l.id === labelId ? { ...l, ...input } : l)),
          })),
        };
      });

      // Update any active task detail queries that contain this label
      const prevTaskDetails: Array<[readonly unknown[], TaskDetailData | undefined]> = [];
      const taskDetailQueries = qc.getQueriesData<TaskDetailData>({ queryKey: ["tasks"] });
      for (const [key, data] of taskDetailQueries) {
        if (data?.task?.labels?.some((l: TaskLabelInfo) => l.id === labelId)) {
          prevTaskDetails.push([key, data]);
          qc.setQueryData<TaskDetailData>(key, (old) => {
            if (!old) return old;
            return {
              ...old,
              task: {
                ...old.task,
                labels: old.task.labels?.map((l: TaskLabelInfo) =>
                  l.id === labelId ? { ...l, ...input } : l
                ),
              },
            };
          });
        }
      }

      return { prevLabels, prevTasks, prevTaskDetails };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevLabels) {
        qc.setQueryData(queryKeys.projects.labels(projectId), ctx.prevLabels);
      }
      if (ctx?.prevTasks) {
        qc.setQueryData(queryKeys.projects.tasks(projectId), ctx.prevTasks);
      }
      if (ctx?.prevTaskDetails) {
        for (const [key, data] of ctx.prevTaskDetails) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.labels(projectId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.tasks(projectId),
      });
    },
  });
}

export function useDeleteLabel(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (labelId: string) => api.delete(`/api/projects/${projectId}/labels/${labelId}`),
    onMutate: async (labelId) => {
      await qc.cancelQueries({
        queryKey: queryKeys.projects.labels(projectId),
      });
      const prev = qc.getQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId));
      qc.setQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId), (old) => {
        if (!old) return old;
        return { labels: old.labels.filter((l) => l.id !== labelId) };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.projects.labels(projectId), ctx.prev);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.labels(projectId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.projects.tasks(projectId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Shared helpers for optimistic label assignment updates
// ---------------------------------------------------------------------------

interface TaskDetailData {
  task: Task & { subtasks?: unknown[]; commentCount?: number };
}

function addLabelToTask(labels: TaskLabelInfo[] | undefined, info: TaskLabelInfo): TaskLabelInfo[] {
  const existing = labels ?? [];
  if (existing.some((l) => l.id === info.id)) return existing;
  return [...existing, info];
}

function removeLabelFromTask(
  labels: TaskLabelInfo[] | undefined,
  labelId: string
): TaskLabelInfo[] {
  return (labels ?? []).filter((l) => l.id !== labelId);
}

interface AssignSnapshot {
  prevTaskDetail: TaskDetailData | undefined;
  prevTasks: { tasks: Task[] } | undefined;
  prevLabels: { labels: Label[] } | undefined;
}

type QueryClient = ReturnType<typeof useQueryClient>;

async function cancelAndSnapshot(
  qc: QueryClient,
  taskId: string,
  projectId: string
): Promise<AssignSnapshot> {
  await Promise.all([
    qc.cancelQueries({ queryKey: queryKeys.tasks.detail(taskId) }),
    qc.cancelQueries({ queryKey: queryKeys.projects.tasks(projectId) }),
    qc.cancelQueries({ queryKey: queryKeys.projects.labels(projectId) }),
  ]);
  return {
    prevTaskDetail: qc.getQueryData<TaskDetailData>(queryKeys.tasks.detail(taskId)),
    prevTasks: qc.getQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId)),
    prevLabels: qc.getQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId)),
  };
}

function rollbackSnapshot(
  qc: QueryClient,
  taskId: string,
  projectId: string,
  ctx: AssignSnapshot | undefined
) {
  if (ctx?.prevTaskDetail) qc.setQueryData(queryKeys.tasks.detail(taskId), ctx.prevTaskDetail);
  if (ctx?.prevTasks) qc.setQueryData(queryKeys.projects.tasks(projectId), ctx.prevTasks);
  if (ctx?.prevLabels) qc.setQueryData(queryKeys.projects.labels(projectId), ctx.prevLabels);
}

function invalidateAssignmentQueries(qc: QueryClient, taskId: string, projectId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.projects.labels(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
}

// ---------------------------------------------------------------------------

export function useAssignLabel(taskId: string, projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (labelId: string) => api.post(`/api/tasks/${taskId}/labels`, { labelId }),
    onMutate: async (labelId): Promise<AssignSnapshot> => {
      const labelsData = qc.getQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId));
      const labelInfo = labelsData?.labels.find((l) => l.id === labelId);
      if (!labelInfo)
        return { prevTaskDetail: undefined, prevTasks: undefined, prevLabels: undefined };

      const info: TaskLabelInfo = {
        id: labelInfo.id,
        name: labelInfo.name,
        color: labelInfo.color,
      };
      const snapshot = await cancelAndSnapshot(qc, taskId, projectId);

      qc.setQueryData<TaskDetailData>(queryKeys.tasks.detail(taskId), (old) => {
        if (!old) return old;
        return { task: { ...old.task, labels: addLabelToTask(old.task.labels, info) } };
      });

      qc.setQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId), (old) => {
        if (!old) return old;
        return {
          tasks: old.tasks.map((t) =>
            t.id === taskId ? { ...t, labels: addLabelToTask(t.labels, info) } : t
          ),
        };
      });

      qc.setQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId), (old) => {
        if (!old) return old;
        return {
          labels: old.labels.map((l) =>
            l.id === labelId ? { ...l, taskCount: l.taskCount + 1 } : l
          ),
        };
      });

      return snapshot;
    },
    onError: (_err, _labelId, ctx) => rollbackSnapshot(qc, taskId, projectId, ctx),
    onSettled: () => invalidateAssignmentQueries(qc, taskId, projectId),
  });
}

export function useUnassignLabel(taskId: string, projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (labelId: string) => api.delete(`/api/tasks/${taskId}/labels/${labelId}`),
    onMutate: async (labelId): Promise<AssignSnapshot> => {
      const snapshot = await cancelAndSnapshot(qc, taskId, projectId);

      qc.setQueryData<TaskDetailData>(queryKeys.tasks.detail(taskId), (old) => {
        if (!old) return old;
        return { task: { ...old.task, labels: removeLabelFromTask(old.task.labels, labelId) } };
      });

      qc.setQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId), (old) => {
        if (!old) return old;
        return {
          tasks: old.tasks.map((t) =>
            t.id === taskId ? { ...t, labels: removeLabelFromTask(t.labels, labelId) } : t
          ),
        };
      });

      qc.setQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId), (old) => {
        if (!old) return old;
        return {
          labels: old.labels.map((l) =>
            l.id === labelId ? { ...l, taskCount: Math.max(0, l.taskCount - 1) } : l
          ),
        };
      });

      return snapshot;
    },
    onError: (_err, _labelId, ctx) => rollbackSnapshot(qc, taskId, projectId, ctx),
    onSettled: () => invalidateAssignmentQueries(qc, taskId, projectId),
  });
}
