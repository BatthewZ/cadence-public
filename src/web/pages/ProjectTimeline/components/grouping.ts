import type { TaskLabelInfo } from "@/shared/schemas/label";
import type { TaskPriority } from "@/shared/types/roles";
import type { ProjectMember, TaskGroup } from "@/web/contexts/ProjectContext";
import { sortByPosition } from "@/web/lib/sort-by-position";
import { endOfMonth, endOfNextWeek, endOfWeek, startOfDay } from "@/web/util/date";
import { getPriorityLabel } from "@/web/util/task-display";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GroupingMode = "dueDate" | "priority" | "taskGroup" | "assignee" | "label";

const VALID_GROUPING_MODES: ReadonlySet<string> = new Set<GroupingMode>([
  "dueDate", "priority", "taskGroup", "assignee", "label",
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
  icon?: "overdue" | "unscheduled" | "unassigned" | "unlabeled";
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
  labels?: TaskLabelInfo[];
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

    // Parse YYYY-MM-DD as local date (new Date("YYYY-MM-DD") is UTC, causing timezone bugs)
    const [y, m, d] = task.dueDate.split("-").map(Number);
    const due = new Date(y, m - 1, d);

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
  const sorted = sortByPosition(taskGroups);

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
/*  Group by Label                                                     */
/* ------------------------------------------------------------------ */

/**
 * Group tasks by their embedded labels (a many-to-many relation).
 *
 * A task with multiple labels intentionally appears in EVERY matching group.
 * Duplication is the honest representation of many-to-many data and matches
 * the OR semantics of the label filter; collapsing to a single "primary"
 * label would hide real associations. Two consequences are accepted
 * tradeoffs, and the tests in grouping.test.ts pin them down so a future
 * "fix" doesn't silently change the contract:
 *
 * - Per-group count badges stay truthful (each badge counts the tasks
 *   carrying that label), so group counts can sum to more than the total
 *   number of distinct tasks.
 * - Bulk-select operates on task ids, so selecting a duplicated row selects
 *   that task in every group it appears in (existing id-based behavior).
 *
 * Groups are derived from the labels found on the tasks themselves rather
 * than from a separate label fetch — empty groups are filtered out in every
 * grouping mode anyway, so the output is identical and the function stays
 * pure (no network dependency). Groups are sorted by label name
 * case-insensitively; tasks with no labels land in a trailing "No label"
 * group (key `label-none`, rendered with a muted Tag icon — the installed
 * lucide-react version has no TagOff variant).
 */
export function groupTasksByLabel(tasks: TimelineTask[]): TimelineGroup[] {
  const labelsById = new Map<string, TaskLabelInfo>();
  for (const task of tasks) {
    for (const label of task.labels ?? []) {
      if (!labelsById.has(label.id)) labelsById.set(label.id, label);
    }
  }

  const sortedLabels = [...labelsById.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  const groups: TimelineGroup[] = sortedLabels.map((l) => ({
    label: l.name,
    key: `label-${l.id}`,
    tasks: [],
    meta: { color: l.color },
  }));

  const noLabel: TimelineGroup = {
    label: "No label",
    key: "label-none",
    tasks: [],
    meta: { icon: "unlabeled" },
  };

  const indexMap = new Map(sortedLabels.map((l, i) => [l.id, i]));

  for (const task of tasks) {
    const labels = task.labels ?? [];
    if (labels.length === 0) {
      noLabel.tasks.push(task);
      continue;
    }
    for (const label of labels) {
      const idx = indexMap.get(label.id);
      if (idx !== undefined) groups[idx].tasks.push(task);
    }
  }

  const result = groups.filter((g) => g.tasks.length > 0);
  if (noLabel.tasks.length > 0) result.push(noLabel);
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
    case "label":
      return groupTasksByLabel(tasks);
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
    case "label":
      return groups.map((g) => g.key);
  }
}
