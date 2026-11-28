import type { QueryClient } from "@tanstack/react-query";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import type { Task, TaskGroup } from "@/web/contexts/ProjectContext";
import type { WriteRequest } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";

/** `POST /api/tasks/:id/complete` (or `/uncomplete`), named for the sync status. */
export function taskCompletionWrite(
  task: { id: string; title: string },
  complete: boolean
): WriteRequest {
  return {
    method: "POST",
    path: `/api/tasks/${task.id}/${complete ? "complete" : "uncomplete"}`,
    body: {},
    label: `${complete ? "Complete" : "Reopen"} “${task.title}”`,
  };
}

export type CompletionFields = Pick<Task, "completed" | "completedAt" | "taskGroupId" | "position">;

/** A task's fields that completing or reopening it changes: what a rollback puts back. */
export function completionFields(task: CompletionFields): CompletionFields {
  return {
    completed: task.completed,
    completedAt: task.completedAt ?? null,
    taskGroupId: task.taskGroupId,
    position: task.position,
  };
}

const byPosition = (a: { position: string; id: string }, b: { position: string; id: string }) =>
  a.position < b.position
    ? -1
    : a.position > b.position
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

/**
 * What completing (or reopening) the task changes, as the server will set it
 * (`src/api/routes/tasks/handlers/completion.ts`), so the card moves at once. Offline the reply
 * that used to move it doesn't come until the queue syncs.
 * - Completing moves the task to the top of the project's first completion group, if it isn't in one.
 * - Reopening a task in a completion group moves it to the top of the first other group.
 *
 * Worked out from the project's cached groups and tasks; without them only `completed` and
 * `completedAt` change, and the server's reply (or the refresh after syncing) places the card.
 */
export function completionChange(
  qc: QueryClient,
  projectId: string | undefined,
  taskId: string,
  complete: boolean,
  now: Date = new Date()
): Partial<CompletionFields> {
  const change: Partial<CompletionFields> = {
    completed: complete,
    completedAt: complete ? now.toISOString() : null,
  };
  if (!projectId) return change;
  const groups = qc.getQueryData<{ taskGroups: TaskGroup[] }>(
    queryKeys.projects.taskGroups(projectId)
  )?.taskGroups;
  const tasks = qc.getQueryData<{ tasks: Task[] }>(queryKeys.projects.tasks(projectId))?.tasks;
  const task = tasks?.find((t) => t.id === taskId);
  if (!groups || !tasks || !task) return change;

  const ordered = [...groups].sort(byPosition);
  const current = groups.find((g) => g.id === task.taskGroupId);
  const target = complete
    ? ordered.find((g) => g.isCompletionGroup)
    : current?.isCompletionGroup
      ? ordered.find((g) => !g.isCompletionGroup)
      : undefined;
  if (!target || target.id === task.taskGroupId) return change;

  const first = tasks
    .filter((t) => t.taskGroupId === target.id && t.id !== taskId)
    .sort(byPosition)[0];
  return {
    ...change,
    taskGroupId: target.id,
    position: generateKeyBetween(null, first?.position ?? null),
  };
}
