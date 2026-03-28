import type { Task, TaskGroup } from "@/web/contexts/ProjectContext";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

export type ActiveItem = { type: "group"; group: TaskGroup } | { type: "task"; task: Task };

export function groupIdStr(id: string) {
  return `group-${id}`;
}

export function taskIdStr(id: string) {
  return `task-${id}`;
}

export function parseId(prefixedId: string): { type: "group" | "task"; id: string } {
  if (prefixedId.startsWith("group-")) {
    return { type: "group", id: prefixedId.slice(6) };
  }
  return { type: "task", id: prefixedId.slice(5) };
}

export function sortByPosition<T extends { position: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0
  );
}

/** Maximum number of task cards to render per column before showing a "Show more" button. */
export const COLUMN_TASK_LIMIT = 30;
