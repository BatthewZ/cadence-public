import { useNavigate } from "react-router-dom";

import { Stack } from "@/web/components/layout";
import {
  Badge,
  Card,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Text,
} from "@/web/components/ui";
import type { ProjectDashboardData } from "@/web/hooks/use-project-dashboard";
import { formatDueDate, startOfDay } from "@/web/util/date";
import { getPriorityBadgeVariant } from "@/web/util/task-display";

const MAX_UPCOMING_DISPLAY = 10;

type DueDateUrgency = "overdue" | "urgent" | "soon" | "normal";

function getDueDateUrgency(dateStr: string): DueDateUrgency {
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(dateStr));
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "urgent";
  if (diffDays <= 7) return "soon";
  return "normal";
}

const urgencyTextClass: Record<DueDateUrgency, string> = {
  overdue: "text-status-error",
  urgent: "text-status-error",
  soon: "text-status-warning",
  normal: "text-fg-secondary",
};

export function UpcomingTasksSection({
  upcomingTasks,
  onTaskClick,
  projectId,
  workspaceSlug,
}: {
  upcomingTasks: ProjectDashboardData["upcomingTasks"];
  onTaskClick: (taskId: string) => void;
  projectId: string;
  workspaceSlug: string;
}) {
  const navigate = useNavigate();
  const displayTasks = upcomingTasks.slice(0, MAX_UPCOMING_DISPLAY);
  const hasMore = upcomingTasks.length > MAX_UPCOMING_DISPLAY;

  return (
    <Card>
      <Stack gap="r4">
        <Text variant="h6">Upcoming Deadlines</Text>
        {displayTasks.length === 0 ? (
          <EmptyState size="sm">
            <EmptyStateTitle>No upcoming deadlines</EmptyStateTitle>
            <EmptyStateDescription>
              No tasks with due dates in the next 30 days.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <Stack gap="r6">
            {displayTasks.map((task) => {
              const urgency = getDueDateUrgency(task.dueDate);
              return (
                <button
                  key={task.id}
                  type="button"
                  className="flex w-full items-center gap-r5 px-r4 py-r5 text-left hover:bg-surface-1 rounded-md transition-colors cursor-pointer"
                  onClick={() => onTaskClick(task.id)}
                >
                  <Badge
                    variant={getPriorityBadgeVariant(task.priority)}
                    className="shrink-0 capitalize"
                  >
                    {task.priority}
                  </Badge>
                  <Text variant="body-2" className="flex-1 truncate">
                    {task.title}
                  </Text>
                  <Badge variant="default" className="shrink-0">
                    {task.taskGroupName}
                  </Badge>
                  <Text
                    variant="body-3"
                    className={`shrink-0 ${urgencyTextClass[urgency]}`}
                  >
                    {formatDueDate(task.dueDate)}
                  </Text>
                </button>
              );
            })}
            {hasMore && (
              <button
                type="button"
                className="flex items-center gap-r6 px-r4 py-r5 text-sm font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer"
                onClick={() =>
                  void navigate(
                    `/w/${workspaceSlug}/projects/${projectId}/board`,
                  )
                }
              >
                View all on Board
              </button>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
