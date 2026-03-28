import type { TaskPriority } from "@/shared/types/roles";
import { endOfMonth, endOfNextWeek, endOfWeek, startOfDay } from "@/web/util/date";

export interface TimeBucket {
  label: string;
  key: string;
  tasks: TimelineTask[];
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

export function groupTasksIntoBuckets(tasks: TimelineTask[]): TimeBucket[] {
  const now = new Date();
  const today = startOfDay(now);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = endOfWeek(now);
  const nextWeekEnd = endOfNextWeek(now);
  const monthEnd = endOfMonth(now);

  const buckets: TimeBucket[] = [
    { label: "Overdue", key: "overdue", tasks: [] },
    { label: "Today", key: "today", tasks: [] },
    { label: "This Week", key: "this-week", tasks: [] },
    { label: "Next Week", key: "next-week", tasks: [] },
    { label: "This Month", key: "this-month", tasks: [] },
    { label: "Later", key: "later", tasks: [] },
    { label: "Unscheduled", key: "unscheduled", tasks: [] },
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
