import type { WriteRequest } from "@/web/lib/offline/send-write";

/** `POST /api/tasks/:id/complete` (or `/uncomplete`), named for the sync status. */
export function taskCompletionWrite(task: { id: string; title: string }, complete: boolean): WriteRequest {
  return {
    method: "POST",
    path: `/api/tasks/${task.id}/${complete ? "complete" : "uncomplete"}`,
    body: {},
    label: `${complete ? "Complete" : "Reopen"} “${task.title}”`,
  };
}
