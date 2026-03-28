import type { Subtask, Task } from "@/web/contexts/ProjectContext";

/**
 * TaskDetail extended with subtask/comment count used by the detail panel.
 * Mirrors the shape produced by the `/api/tasks/:id` endpoint.
 */
export interface TaskDetail extends Task {
  subtasks: Subtask[];
  commentCount: number;
  cost?: number | null;
  coverImagePosition?: number | null;
}
