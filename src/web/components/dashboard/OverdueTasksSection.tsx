import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { Row, Stack } from "@/web/components/layout";
import { Avatar, Badge, Text } from "@/web/components/ui";
import { formatDueDate } from "@/web/util/date";
import { getPriorityBadgeVariant } from "@/web/util/task-display";

/**
 * Base shape for an overdue task — covers fields common to both
 * the workspace dashboard and per-project dashboard responses.
 */
interface OverdueTask {
  id: string;
  title: string;
  priority: string;
  dueDate: string;
  assigneeName: string | null;
  assigneeImage: string | null;
}

interface OverdueTasksSectionProps<T extends OverdueTask> {
  overdueTasks: T[];
  onTaskClick: (taskId: string) => void;
  /** Optional renderer for extra context per row (e.g. project name). */
  renderContext?: (task: T) => ReactNode;
}

/**
 * Shared overdue-tasks alert banner used on both the workspace and project
 * dashboards. The optional `renderContext` prop lets the workspace dashboard
 * show the project name for each overdue task while the project dashboard
 * omits it, eliminating the previously duplicated component.
 */
function OverdueTasksSection<T extends OverdueTask>({
  overdueTasks,
  onTaskClick,
  renderContext,
}: OverdueTasksSectionProps<T>) {
  if (overdueTasks.length === 0) return null;

  return (
    <div className="rounded-lg border border-status-error/20 bg-status-error-bg p-r3">
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <AlertTriangle size={16} className="text-status-error" />
          <Text variant="h6">Overdue</Text>
          <Badge variant="error">{overdueTasks.length}</Badge>
        </Row>
        <Stack gap="r6">
          {overdueTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="flex w-full items-center gap-r5 py-r5 text-left hover:bg-status-error/5 rounded-md transition-colors cursor-pointer"
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
              {renderContext && (
                <Text variant="body-3" color="muted" className="shrink-0">
                  {renderContext(task)}
                </Text>
              )}
              {task.assigneeName && (
                <Avatar
                  size="xs"
                  name={task.assigneeName}
                  src={task.assigneeImage ?? undefined}
                />
              )}
              <Text variant="body-3" className="shrink-0 text-status-error">
                {formatDueDate(task.dueDate)}
              </Text>
            </button>
          ))}
        </Stack>
      </Stack>
    </div>
  );
}

export { OverdueTasksSection };
export type { OverdueTask };
