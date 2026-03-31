import type { TaskPriority } from "@/shared/types/roles";
import type { ProjectMember, TaskGroup } from "@/web/contexts/ProjectContext";
import { endOfMonth, endOfNextWeek, endOfWeek, startOfDay } from "@/web/util/date";
import { getPriorityLabel } from "@/web/util/task-display";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GroupingMode = "dueDate" | "priority" | "taskGroup" | "assignee";

const VALID_GROUPING_MODES: ReadonlySet<string> = new Set<GroupingMode>([
  "dueDate", "priority", "taskGroup", "assignee",
]);

/** Safely parse a URL param into a GroupingMode, falling back to "dueDate". */
export function parseGroupingMode(raw: string | null): GroupingMode {
  return raw && VALID_GROUPING_MODES.has(raw) ? (raw as GroupingMode) : "dueDate";
}

export interface TimelineGroupMeta {
  color?: string;
  priority?: TaskPriority;
  avatarUrl?: string;
  avatarName?: string;
  icon?: "overdue" | "unscheduled" | "unassigned";
}

export interface TimelineGroup {
  label: string;
  key: string;
  tasks: TimelineTask[];
  meta?: TimelineGroupMeta;
}

export interface TimelineTask {
  id: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  dueDate?: string;
  assigneeId?: string;
  assigneeName?: string;
  assigneeAvatarUrl?: string;
  taskGroupId: string;
}

/* ------------------------------------------------------------------ */
/*  Group by Due Date (original time-bucket logic)                     */
/* ------------------------------------------------------------------ */

function groupTasksIntoBuckets(tasks: TimelineTask[]): TimelineGroup[] {
  const now = new Date();
  const today = startOfDay(now);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = endOfWeek(now);
  const nextWeekEnd = endOfNextWeek(now);
  const monthEnd = endOfMonth(now);

  const buckets: TimelineGroup[] = [
    { label: "Overdue", key: "overdue", tasks: [], meta: { icon: "overdue" } },
    { label: "Today", key: "today", tasks: [] },
    { label: "This Week", key: "this-week", tasks: [] },
    { label: "Next Week", key: "next-week", tasks: [] },
    { label: "This Month", key: "this-month", tasks: [] },
    { label: "Later", key: "later", tasks: [] },
    { label: "Unscheduled", key: "unscheduled", tasks: [], meta: { icon: "unscheduled" } },
  ];

  for (const task of tasks) {
    if (!task.dueDate) {
      buckets[6].tasks.push(task);
      continue;
    }

    const due = startOfDay(new Date(task.dueDate));

    if (due < today) {
      buckets[0].tasks.push(task);
    } else if (due <= todayEnd) {
      buckets[1].tasks.push(task);
    } else if (due <= weekEnd) {
      buckets[2].tasks.push(task);
    } else if (due <= nextWeekEnd) {
      buckets[3].tasks.push(task);
    } else if (due <= monthEnd) {
      buckets[4].tasks.push(task);
    } else {
      buckets[5].tasks.push(task);
    }
  }

  return buckets.filter((b) => b.tasks.length > 0);
}

/* ------------------------------------------------------------------ */
/*  Group by Priority                                                  */
/* ------------------------------------------------------------------ */

const PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "medium", "low", "none"];

function groupTasksByPriority(tasks: TimelineTask[]): TimelineGroup[] {
  const groups: TimelineGroup[] = PRIORITY_ORDER.map((p) => ({
    label: getPriorityLabel(p),
    key: `priority-${p}`,
    tasks: [],
    meta: { priority: p },
  }));

  const indexMap = new Map(PRIORITY_ORDER.map((p, i) => [p, i]));

  for (const task of tasks) {
    const idx = indexMap.get(task.priority) ?? PRIORITY_ORDER.length - 1;
    groups[idx].tasks.push(task);
  }

  return groups.filter((g) => g.tasks.length > 0);
}

/* ------------------------------------------------------------------ */
/*  Group by Task Group                                                */
/* ------------------------------------------------------------------ */

function groupTasksByTaskGroup(
  tasks: TimelineTask[],
  taskGroups: TaskGroup[],
): TimelineGroup[] {
  const sorted = [...taskGroups].sort((a, b) => a.position.localeCompare(b.position));

  const groups: TimelineGroup[] = sorted.map((tg) => ({
    label: tg.name,
    key: `group-${tg.id}`,
    tasks: [],
    meta: { color: tg.color ?? undefined },
  }));

  const indexMap = new Map(sorted.map((tg, i) => [tg.id, i]));

  for (const task of tasks) {
    const idx = indexMap.get(task.taskGroupId);
    if (idx !== undefined) {
      groups[idx].tasks.push(task);
    }
  }

  return groups.filter((g) => g.tasks.length > 0);
}

/* ------------------------------------------------------------------ */
/*  Group by Assignee                                                  */
/* ------------------------------------------------------------------ */

function groupTasksByAssignee(
  tasks: TimelineTask[],
  members: ProjectMember[],
): TimelineGroup[] {
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));

  const groups: TimelineGroup[] = sorted.map((m) => ({
    label: m.name,
    key: `assignee-${m.userId}`,
    tasks: [],
    meta: { avatarName: m.name, avatarUrl: m.image ?? undefined },
  }));

  const unassigned: TimelineGroup = {
    label: "Unassigned",
    key: "assignee-unassigned",
    tasks: [],
    meta: { icon: "unassigned" },
  };

  const indexMap = new Map(sorted.map((m, i) => [m.userId, i]));

  for (const task of tasks) {
    if (!task.assigneeId) {
      unassigned.tasks.push(task);
      continue;
    }
    const idx = indexMap.get(task.assigneeId);
    if (idx !== undefined) {
      groups[idx].tasks.push(task);
    } else {
      // Assignee not in current members list (e.g. removed) — put in unassigned
      unassigned.tasks.push(task);
    }
  }

  const result = groups.filter((g) => g.tasks.length > 0);
  if (unassigned.tasks.length > 0) result.push(unassigned);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                         */
/* ------------------------------------------------------------------ */

export function groupTimelineTasks(
  mode: GroupingMode,
  tasks: TimelineTask[],
  taskGroups: TaskGroup[],
  members: ProjectMember[],
): TimelineGroup[] {
  switch (mode) {
    case "dueDate":
      return groupTasksIntoBuckets(tasks);
    case "priority":
      return groupTasksByPriority(tasks);
    case "taskGroup":
      return groupTasksByTaskGroup(tasks, taskGroups);
    case "assignee":
      return groupTasksByAssignee(tasks, members);
  }
}

/* ------------------------------------------------------------------ */
/*  Default open keys per grouping mode                                */
/* ------------------------------------------------------------------ */

export function getDefaultOpenKeys(
  mode: GroupingMode,
  groups: TimelineGroup[],
): string[] {
  switch (mode) {
    case "dueDate":
      return groups
        .filter((g) => g.key === "overdue" || g.key === "today")
        .map((g) => g.key);
    case "priority":
      return groups.length > 0 ? [groups[0].key] : [];
    case "taskGroup":
    case "assignee":
      return groups.map((g) => g.key);
  }
}
