import { useQueryClient } from "@tanstack/react-query";
import { CalendarOff, UserX } from "lucide-react";
import {
  useCallback,
  useMemo,
} from "react";
import { useSearchParams } from "react-router-dom";

import { Row, Stack } from "@/web/components/layout";
import {
  Accordion,
  Avatar,
  Badge,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Spinner,
  Text,
} from "@/web/components/ui";
import { BulkActionBar } from "@/web/components/ui/BulkActionBar";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { useToast } from "@/web/components/ui/ToastContext";
import { type Task, useProject } from "@/web/contexts/ProjectContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useMultiSelect } from "@/web/hooks/use-multi-select";
import { useTaskFilters } from "@/web/hooks/use-task-filters";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { getPriorityBadgeVariant } from "@/web/util/task-display";

import { GroupByDropdown } from "./components/GroupByDropdown";
import type { GroupingMode, TimelineTask } from "./components/grouping";
import { getDefaultOpenKeys, groupTimelineTasks, parseGroupingMode } from "./components/grouping";
import { TimelineTaskRow } from "./components/TimelineTaskRow";

/* ------------------------------------------------------------------ */
/*  ProjectTimeline page                                               */
/* ------------------------------------------------------------------ */

export default function ProjectTimeline() {
  const { project, tasks, updateTask, members, taskGroups, tasksError, refetchTasks } = useProject();
  // ProjectContext's type says `project: Project`, but the underlying React
  // Query fetch can transiently produce a null project (see the `!project`
  // spinner guard below and the loading-state test). Fall back to a bare
  // "Timeline" title in that window rather than blow up on `null.name`.
  useDocumentTitle(project ? `${project.name} — Timeline` : "Timeline");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { filteredTasks, filters } = useTaskFilters(tasks);
  const [searchParams, setSearchParams] = useSearchParams();

  // Grouping mode from URL (defaults to "dueDate")
  const groupBy = parseGroupingMode(searchParams.get("groupBy"));

  const handleGroupByChange = useCallback(
    (mode: GroupingMode) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (mode === "dueDate") {
          next.delete("groupBy");
        } else {
          next.set("groupBy", mode);
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  // Multi-select state
  const { selectedIds, handleToggleSelect, handleClearSelection } = useMultiSelect();

  // Group filtered tasks based on the active grouping mode.
  // Completed tasks are excluded unless the user explicitly set the Status filter.
  const excludeCompleted = filters.completed === null;
  const groups = useMemo(() => {
    const timelineTasks: TimelineTask[] = filteredTasks
      .filter((t) => !excludeCompleted || !t.completed)
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

    return groupTimelineTasks(groupBy, timelineTasks, taskGroups, members);
  }, [filteredTasks, excludeCompleted, groupBy, taskGroups, members]);

  // Determine which accordion sections to auto-expand
  const defaultOpen = useMemo(
    () => getDefaultOpenKeys(groupBy, groups),
    [groupBy, groups],
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
          void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboardMyTasksPrefix(project.workspaceId) });
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

  if (tasksError) {
    return (
      <QueryErrorRetry message="Failed to load timeline data." onRetry={refetchTasks} />
    );
  }

  return (
    <Stack gap="r3">
      <Row justify="between" align="center">
        <Text variant="h4">Timeline</Text>
        <GroupByDropdown value={groupBy} onChange={handleGroupByChange} />
      </Row>

      {groups.length === 0 ? (
        <EmptyState size="md">
          <EmptyStateTitle>No tasks</EmptyStateTitle>
          <EmptyStateDescription>
            Create tasks to see them on the timeline
          </EmptyStateDescription>
        </EmptyState>
      ) : (
        <Accordion key={groupBy} mode="multiple" defaultValue={defaultOpen}>
          {groups.map((group) => {
            const isUnscheduled = group.meta?.icon === "unscheduled";
            const isOverdue = group.meta?.icon === "overdue";
            return (
              <Accordion.Item key={group.key} value={group.key}>
                <Accordion.Trigger
                  className={isUnscheduled ? "text-fg-muted" : undefined}
                >
                  <Row gap="r5" align="center">
                    {/* Contextual leading icon based on grouping meta */}
                    {isUnscheduled && (
                      <CalendarOff size={14} className="text-fg-muted shrink-0" />
                    )}
                    {group.meta?.color && (
                      <span
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: group.meta.color }}
                      />
                    )}
                    {group.meta?.avatarName && (
                      <Avatar
                        name={group.meta.avatarName}
                        src={group.meta.avatarUrl}
                        size="xs"
                      />
                    )}
                    {group.meta?.icon === "unassigned" && (
                      <UserX size={14} className="text-fg-muted shrink-0" />
                    )}

                    {/* Group label — for priority, render as a colored badge */}
                    {group.meta?.priority ? (
                      <Badge variant={getPriorityBadgeVariant(group.meta.priority)}>
                        {group.label}
                      </Badge>
                    ) : (
                      <span>{group.label}</span>
                    )}

                    {/* Task count badge */}
                    <Badge variant={isOverdue ? "error" : "default"}>
                      {group.tasks.length}
                    </Badge>
                  </Row>
                </Accordion.Trigger>
                <Accordion.Content>
                  <Stack gap="r6">
                    {group.tasks.map((task) => (
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
