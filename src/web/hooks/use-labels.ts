import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TaskLabelInfo } from "@/shared/schemas/label";
import type { Task } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { sendWrite, type WriteResult } from "@/web/lib/offline/send-write";
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

type LabelsData = { labels: Label[] };

/** A queued write's reply comes with the refresh after the queue drains, so it skips this one. */
function invalidateLabelQueries(qc: QueryClient, projectId: string, result: WriteResult<unknown> | undefined) {
  if (result?.status === "queued") return;
  void qc.invalidateQueries({ queryKey: queryKeys.projects.labels(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
}

function labelName(qc: QueryClient, projectId: string, labelId: string): string {
  const label = qc
    .getQueryData<LabelsData>(queryKeys.projects.labels(projectId))
    ?.labels.find((l) => l.id === labelId);
  return label ? `“${label.name}”` : "a label";
}

type CacheEntry = [readonly unknown[], unknown];

/** Tasks embed their labels: the cached task list and task details that carry `labelId`, for rollback. */
function taskCachesWithLabel(qc: QueryClient, projectId: string, labelId: string): CacheEntry[] {
  const entries: CacheEntry[] = [];
  const tasksKey = queryKeys.projects.tasks(projectId);
  const tasks = qc.getQueryData<{ tasks: Task[] }>(tasksKey);
  if (tasks?.tasks.some((t) => t.labels?.some((l) => l.id === labelId))) entries.push([tasksKey, tasks]);
  for (const [key, data] of qc.getQueriesData<TaskDetailData>({ queryKey: ["tasks"] })) {
    if (data?.task?.labels?.some((l) => l.id === labelId)) entries.push([key, data]);
  }
  return entries;
}

function rewriteLabelInTaskCaches(
  qc: QueryClient,
  projectId: string,
  labelId: string,
  rewrite: (labels: TaskLabelInfo[]) => TaskLabelInfo[]
): void {
  qc.setQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId), (old) => {
    if (!old) return old;
    return {
      tasks: old.tasks.map((t) =>
        t.labels?.some((l) => l.id === labelId) ? { ...t, labels: rewrite(t.labels) } : t
      ),
    };
  });
  for (const [key, data] of qc.getQueriesData<TaskDetailData>({ queryKey: ["tasks"] })) {
    const labels = data?.task?.labels;
    if (!data || !labels?.some((l) => l.id === labelId)) continue;
    qc.setQueryData<TaskDetailData>(key, { ...data, task: { ...data.task, labels: rewrite(labels) } });
  }
}

function restoreCaches(qc: QueryClient, entries: CacheEntry[] | undefined) {
  for (const [key, data] of entries ?? []) qc.setQueryData(key, data);
}

export function useCreateLabel(projectId: string) {
  const qc = useQueryClient();
  const labelsKey = queryKeys.projects.labels(projectId);

  return useMutation({
    networkMode: "always",
    // The insert lives here, not in onMutate, because this is where the client id is minted.
    mutationFn: (input: { name: string; color: string }) => {
      const id = crypto.randomUUID();
      const optimistic: Label = {
        id,
        projectId,
        ...input,
        taskCount: 0,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<LabelsData>(labelsKey, (old) =>
        old ? { labels: [...old.labels, optimistic] } : old
      );
      return sendWrite<{ label: Label }>({
        method: "POST",
        path: `/api/projects/${projectId}/labels`,
        body: { id, ...input },
        label: `Add label “${input.name}”`,
      });
    },
    onMutate: async () => {
      freshnessTracker.recordMutation("project");
      await qc.cancelQueries({ queryKey: labelsKey });
      return { prevLabels: qc.getQueryData<LabelsData>(labelsKey) };
    },
    onSuccess: (result) => {
      if (result.status !== "sent") return;
      const { label } = result.data;
      qc.setQueryData<LabelsData>(labelsKey, (old) =>
        old ? { labels: old.labels.map((l) => (l.id === label.id ? { ...l, ...label } : l)) } : old
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevLabels) qc.setQueryData(labelsKey, ctx.prevLabels);
    },
    onSettled: (result) => invalidateLabelQueries(qc, projectId, result),
  });
}

export function useUpdateLabel(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    networkMode: "always",
    mutationFn: ({ labelId, ...input }: { labelId: string; name?: string; color?: string }) =>
      sendWrite<{ label: Label }>({
        method: "PATCH",
        path: `/api/projects/${projectId}/labels/${labelId}`,
        body: input,
        // Runs after onMutate has applied the new name, so a rename is named by it.
        label: input.name
          ? `Rename label to “${input.name}”`
          : `Recolor label ${labelName(qc, projectId, labelId)}`,
      }),
    onMutate: async ({ labelId, ...input }) => {
      freshnessTracker.recordMutation("project");
      await Promise.all([
        qc.cancelQueries({ queryKey: queryKeys.projects.labels(projectId) }),
        qc.cancelQueries({ queryKey: queryKeys.projects.tasks(projectId) }),
      ]);

      const prevLabels = qc.getQueryData<LabelsData>(queryKeys.projects.labels(projectId));
      qc.setQueryData<LabelsData>(queryKeys.projects.labels(projectId), (old) => {
        if (!old) return old;
        return {
          labels: old.labels.map((l) => (l.id === labelId ? { ...l, ...input } : l)),
        };
      });

      const prevTaskCaches = taskCachesWithLabel(qc, projectId, labelId);
      rewriteLabelInTaskCaches(qc, projectId, labelId, (labels) =>
        labels.map((l) => (l.id === labelId ? { ...l, ...input } : l))
      );

      return { prevLabels, prevTaskCaches };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevLabels) {
        qc.setQueryData(queryKeys.projects.labels(projectId), ctx.prevLabels);
      }
      restoreCaches(qc, ctx?.prevTaskCaches);
    },
    onSettled: (result) => invalidateLabelQueries(qc, projectId, result),
  });
}

export function useDeleteLabel(projectId: string) {
  const qc = useQueryClient();
  const labelsKey = queryKeys.projects.labels(projectId);

  return useMutation({
    networkMode: "always",
    // The removal lives here, not in onMutate, so the write is named before the label leaves the cache.
    mutationFn: (labelId: string) => {
      const label = `Delete label ${labelName(qc, projectId, labelId)}`;
      qc.setQueryData<LabelsData>(labelsKey, (old) =>
        old ? { labels: old.labels.filter((l) => l.id !== labelId) } : old
      );
      rewriteLabelInTaskCaches(qc, projectId, labelId, (labels) => removeLabelFromTask(labels, labelId));
      return sendWrite({
        method: "DELETE",
        path: `/api/projects/${projectId}/labels/${labelId}`,
        label,
      });
    },
    onMutate: async (labelId) => {
      freshnessTracker.recordMutation("project");
      await Promise.all([
        qc.cancelQueries({ queryKey: labelsKey }),
        qc.cancelQueries({ queryKey: queryKeys.projects.tasks(projectId) }),
      ]);
      return {
        prevLabels: qc.getQueryData<LabelsData>(labelsKey),
        prevTaskCaches: taskCachesWithLabel(qc, projectId, labelId),
      };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevLabels) qc.setQueryData(labelsKey, ctx.prevLabels);
      restoreCaches(qc, ctx?.prevTaskCaches);
    },
    onSettled: (result) => invalidateLabelQueries(qc, projectId, result),
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

/**
 * Puts back only what the assignment changed: this task's labels and the label's task count.
 * Restoring the whole snapshots would also undo every edit made since (the detail view's
 * optimistic edits live in the detail query, and the task list holds every card).
 */
function rollbackSnapshot(
  qc: QueryClient,
  taskId: string,
  projectId: string,
  labelId: string,
  ctx: AssignSnapshot | undefined
) {
  if (ctx?.prevTaskDetail) {
    const labels = ctx.prevTaskDetail.task.labels;
    qc.setQueryData<TaskDetailData>(queryKeys.tasks.detail(taskId), (old) =>
      old ? { ...old, task: { ...old.task, labels } } : old
    );
  }
  if (ctx?.prevTasks) {
    const labels = ctx.prevTasks.tasks.find((t) => t.id === taskId)?.labels;
    qc.setQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId), (old) =>
      old ? { tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, labels } : t)) } : old
    );
  }
  if (ctx?.prevLabels) {
    const taskCount = ctx.prevLabels.labels.find((l) => l.id === labelId)?.taskCount;
    if (taskCount !== undefined) {
      qc.setQueryData<{ labels: Label[] }>(queryKeys.projects.labels(projectId), (old) =>
        old ? { labels: old.labels.map((l) => (l.id === labelId ? { ...l, taskCount } : l)) } : old
      );
    }
  }
}

function invalidateAssignmentQueries(
  qc: QueryClient,
  taskId: string,
  projectId: string,
  result: WriteResult<unknown> | undefined
) {
  if (result?.status === "queued") return;
  void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.projects.labels(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
}

function taskTitle(qc: QueryClient, taskId: string, projectId: string): string {
  const title =
    qc.getQueryData<TaskDetailData>(queryKeys.tasks.detail(taskId))?.task.title ??
    qc
      .getQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId))
      ?.tasks.find((t) => t.id === taskId)?.title;
  return title ? `“${title}”` : "a task";
}

// ---------------------------------------------------------------------------

export function useAssignLabel(taskId: string, projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    networkMode: "always",
    mutationFn: (labelId: string) =>
      sendWrite({
        method: "POST",
        path: `/api/tasks/${taskId}/labels`,
        body: { labelId },
        label: `Add label ${labelName(qc, projectId, labelId)} to ${taskTitle(qc, taskId, projectId)}`,
      }),
    onMutate: async (labelId): Promise<AssignSnapshot> => {
      freshnessTracker.recordMutation("tasks");
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
    onError: (_err, labelId, ctx) => rollbackSnapshot(qc, taskId, projectId, labelId, ctx),
    onSettled: (result) => invalidateAssignmentQueries(qc, taskId, projectId, result),
  });
}

export function useUnassignLabel(taskId: string, projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    networkMode: "always",
    mutationFn: (labelId: string) =>
      sendWrite({
        method: "DELETE",
        path: `/api/tasks/${taskId}/labels/${labelId}`,
        label: `Remove label ${labelName(qc, projectId, labelId)} from ${taskTitle(qc, taskId, projectId)}`,
      }),
    onMutate: async (labelId): Promise<AssignSnapshot> => {
      freshnessTracker.recordMutation("tasks");
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
    onError: (_err, labelId, ctx) => rollbackSnapshot(qc, taskId, projectId, labelId, ctx),
    onSettled: (result) => invalidateAssignmentQueries(qc, taskId, projectId, result),
  });
}
