import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

import { useTaskServerSync } from "@/web/hooks/use-task-server-sync";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

type TaskDetailData = { task: TaskDetail };

/**
 * A detail view's working copy of a task. Shared between TaskDetailDialog and TaskDetailPanelInner.
 *
 * `setLocalTask` applies each optimistic edit to the copy *and* to the task's detail query, the
 * record the view is seeded from. Kept only in component state, an edit was rolled back whenever
 * that record was read again: the panel reopened, the page reloaded (the query is saved for
 * offline use), or another writer of the query (a label change) handed it back through
 * `useTaskServerSync`. Online the refetch after each write hid that; offline, nothing refetches
 * until the queue syncs, so edits vanished from the panel.
 *
 * Updaters passed to `setLocalTask` run on both copies, so they must be pure.
 * `resetLocalTask` replaces the copy without touching the query (reseeding the view from it).
 */
export function useLocalTask(taskId: string, taskFromServer: TaskDetail | null | undefined) {
  const qc = useQueryClient();
  const [localTask, resetLocalTask] = useState<TaskDetail | null>(null);
  useTaskServerSync(taskFromServer, resetLocalTask);

  const setLocalTask = useCallback<Dispatch<SetStateAction<TaskDetail | null>>>(
    (next) => {
      resetLocalTask(next);
      qc.setQueryData<TaskDetailData>(queryKeys.tasks.detail(taskId), (old) => {
        if (!old) return undefined;
        const task = typeof next === "function" ? next(old.task) : next;
        // Undefined leaves the query untouched: no write for a no-op, a cleared view, or another task.
        if (!task || task === old.task || task.id !== old.task.id) return undefined;
        return { ...old, task };
      });
    },
    [qc, taskId],
  );

  return { localTask, setLocalTask, resetLocalTask };
}
