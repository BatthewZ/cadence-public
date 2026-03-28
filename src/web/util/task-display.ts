import type { TaskPriority } from "@/shared/types/roles";

type BadgeVariant = "default" | "info" | "success" | "warning" | "error";

export const PRIORITY_BADGE_VARIANT: Record<TaskPriority, BadgeVariant> = {
  urgent: "error",
  high: "warning",
  medium: "info",
  low: "default",
  none: "default",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

export const PRIORITY_SORT_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function getPriorityBadgeVariant(priority: string): BadgeVariant {
  return PRIORITY_BADGE_VARIANT[priority as TaskPriority] ?? "default";
}

export function getPriorityLabel(priority: string): string {
  return PRIORITY_LABEL[priority as TaskPriority] ?? priority;
}

export const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
];

export const PRIORITY_DOT_CLASS: Record<string, string> = {
  urgent: "bg-status-error",
  high: "bg-status-warning",
  medium: "bg-status-info",
  low: "bg-surface-3",
  none: "",
};

export const PRIORITY_BORDER_CLASS: Record<string, string> = {
  urgent: "border-l-2 border-l-status-error",
  high: "border-l-2 border-l-status-warning",
  medium: "border-l-2 border-l-status-info",
  low: "border-l-2 border-l-transparent",
  none: "",
};

export const PRIORITY_TEXT_CLASS: Record<string, string> = {
  urgent: "text-status-error",
  high: "text-status-warning",
  medium: "text-status-info",
  low: "text-fg-muted",
  none: "text-fg-muted",
};

export const TASK_GROUP_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];
