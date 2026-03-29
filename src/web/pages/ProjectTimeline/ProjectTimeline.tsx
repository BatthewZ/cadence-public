import { useQueryClient } from "@tanstack/react-query";
import { CalendarOff } from "lucide-react";
import {
  useCallback,
  useMemo,
} from "react";

import { Row, Stack } from "@/web/components/layout";
import {
  Accordion,
  Badge,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Spinner,
  Text,
} from "@/web/components/ui";
import { BulkActionBar } from "@/web/components/ui/BulkActionBar";
import { useToast } from "@/web/components/ui/ToastContext";
import { type Task, useProject } from "@/web/contexts/ProjectContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useMultiSelect } from "@/web/hooks/use-multi-select";
import { useTaskFilters } from "@/web/hooks/use-task-filters";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import type { TimelineTask } from "./components/grouping";
import { groupTasksIntoBuckets } from "./components/grouping";
import { TimelineTaskRow } from "./components/TimelineTaskRow";

/* ------------------------------------------------------------------ */
/*  ProjectTimeline page                                               */
/* ------------------------------------------------------------------ */

export default function ProjectTimeline() {
  useDocumentTitle("Timeline");
  const { project, tasks, updateTask } = useProject();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { filteredTasks } = useTaskFilters(tasks);

  // Multi-select state
  const { selectedIds, handleToggleSelect, handleClearSelection } = useMultiSelect();

  // Group all tasks into time buckets (including unscheduled)
  const buckets = useMemo(() => {
    const timelineTasks: TimelineTask[] = filteredTasks
      .map((t) => ({
        id: t.id,
        title: t.title,
        completed: t.completed,
        priority: t.priority,
        dueDate: t.dueDate ?? undefined,
        assigneeId: t.assigneeId ?? undefined,
        assigneeName: t.assigneeName,
        assigneeAvatarUrl: t.assigneeAvatarUrl,
        taskGroupId: t.taskGroupId,
      }));

    return groupTasksIntoBuckets(timelineTasks);
  }, [filteredTasks]);

  // Auto-expand Overdue and Today
  const defaultOpen = useMemo(
    () =>
      buckets
        .filter((b) => b.key === "overdue" || b.key === "today")
        .map((b) => b.key),
    [buckets],
  );

  const handleToggleCompleted = useCallback(
    async (taskId: string, currentlyCompleted: boolean) => {
      // Optimistic update
      updateTask(taskId, { completed: !currentlyCompleted });
      const endpoint = currentlyCompleted
        ? `/api/tasks/${taskId}/uncomplete`
        : `/api/tasks/${taskId}/complete`;
      try {
        const res = await api.post<{ task: Task }>(endpoint, {});
        updateTask(taskId, res.task);
        if (project) {
          void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(project.id) });
        }
      } catch {
        // Revert on failure
        updateTask(taskId, { completed: currentlyCompleted });
        toast("Failed to update task", { variant: "error" });
      }
    },
    [updateTask, toast, qc, project],
  );

  if (!project) {
    return (
      <Row justify="center" className="py-r1">
        <Spinner />
      </Row>
    );
  }

  return (
    <Stack gap="r3">
      <Text variant="h4">Timeline</Text>

      {buckets.length === 0 ? (
        <EmptyState size="md">
          <EmptyStateTitle>No tasks</EmptyStateTitle>
          <EmptyStateDescription>
            Create tasks to see them on the timeline
          </EmptyStateDescription>
        </EmptyState>
      ) : (
        <Accordion mode="multiple" defaultValue={defaultOpen}>
          {buckets.map((bucket) => {
            const isUnscheduled = bucket.key === "unscheduled";
            return (
              <Accordion.Item key={bucket.key} value={bucket.key}>
                <Accordion.Trigger
                  className={isUnscheduled ? "text-fg-muted" : undefined}
                >
                  <Row gap="r5" align="center">
                    {isUnscheduled && (
                      <CalendarOff size={14} className="text-fg-muted shrink-0" />
                    )}
                    <span>{bucket.label}</span>
                    <Badge
                      variant={
                        bucket.key === "overdue" ? "error" : "default"
                      }
                    >
                      {bucket.tasks.length}
                    </Badge>
                  </Row>
                </Accordion.Trigger>
                <Accordion.Content>
                  <Stack gap="r6">
                    {bucket.tasks.map((task) => (
                      <TimelineTaskRow
                        key={task.id}
                        task={task}
                        onToggleCompleted={(taskId, completed) => { void handleToggleCompleted(taskId, completed); }}
                        selected={selectedIds.has(task.id)}
                        onToggleSelect={handleToggleSelect}
                      />
                    ))}
                  </Stack>
                </Accordion.Content>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}

      <BulkActionBar selectedIds={selectedIds} onClearSelection={handleClearSelection} />
    </Stack>
  );
}
