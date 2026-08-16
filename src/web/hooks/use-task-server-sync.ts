import { useEffect } from "react";

import type { TaskDetail } from "@/web/pages/TaskDetail/types";

/**
 * Mirror the server's task row into a detail view's local optimistic copy.
 *
 * Shared between TaskDetailDialog and TaskDetailPanelInner.
 *
 * Adopts the whole row, never a field allowlist: an allowlist discards the
 * fields a collaborator changed, freezing an open view on what it loaded with.
 * Two caller preconditions keep wholesale adoption safe —
 *   - fields the user can be mid-edit on must not render from the local copy,
 *   - task mutations must record a `"tasks"` mutation on `freshnessTracker` in
 *     `onMutate`, so a poll cannot refetch the pre-write row over an
 *     unacknowledged optimistic value.
 */
export function useTaskServerSync(
  taskFromServer: TaskDetail | null | undefined,
  setLocalTask: React.Dispatch<React.SetStateAction<TaskDetail | null>>,
): void {
  useEffect(() => {
    if (!taskFromServer) return;
    // Deferred: setState in an effect body re-renders synchronously.
    queueMicrotask(() => {
      setLocalTask(taskFromServer);
    });
  }, [taskFromServer, setLocalTask]);
}
