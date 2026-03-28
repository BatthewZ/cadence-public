import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import type { TaskPriority } from "@/shared/types/roles";
import type { Task } from "@/web/contexts/ProjectContext";

export interface TaskFilters {
  assigneeIds: string[];
  priorities: TaskPriority[];
  completed: boolean | null;
  dueDateFrom: string | null;
  dueDateTo: string | null;
  labelIds: string[];
}

export interface UseTaskFiltersReturn {
  filters: TaskFilters;
  filteredTasks: Task[];
  activeFilterCount: number;
  hasActiveFilters: boolean;
  setFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
  clearFilter: (key: keyof TaskFilters) => void;
  clearFilters: () => void;
}

const FILTER_PARAMS = ["assignee", "priority", "completed", "dueDateFrom", "dueDateTo", "label"] as const;

function parseFilters(searchParams: URLSearchParams): TaskFilters {
  const assigneeRaw = searchParams.get("assignee");
  const priorityRaw = searchParams.get("priority");
  const completedRaw = searchParams.get("completed");

  const labelRaw = searchParams.get("label");

  return {
    assigneeIds: assigneeRaw ? assigneeRaw.split(",").filter(Boolean) : [],
    priorities: priorityRaw
      ? (priorityRaw.split(",").filter(Boolean) as TaskPriority[])
      : [],
    completed:
      completedRaw === "true" ? true : completedRaw === "false" ? false : null,
    dueDateFrom: searchParams.get("dueDateFrom"),
    dueDateTo: searchParams.get("dueDateTo"),
    labelIds: labelRaw ? labelRaw.split(",").filter(Boolean) : [],
  };
}

function applyFilters(tasks: Task[], filters: TaskFilters): Task[] {
  return tasks.filter((task) => {
    if (
      filters.assigneeIds.length > 0 &&
      (!task.assigneeId || !filters.assigneeIds.includes(task.assigneeId))
    ) {
      return false;
    }

    if (
      filters.priorities.length > 0 &&
      !filters.priorities.includes(task.priority)
    ) {
      return false;
    }

    if (filters.completed !== null && task.completed !== filters.completed) {
      return false;
    }

    if (filters.dueDateFrom) {
      if (!task.dueDate || task.dueDate < filters.dueDateFrom) {
        return false;
      }
    }

    if (filters.dueDateTo) {
      if (!task.dueDate || task.dueDate > filters.dueDateTo) {
        return false;
      }
    }

    if (filters.labelIds.length > 0) {
      const taskLabelIds = (task.labels ?? []).map((l) => l.id);
      if (!filters.labelIds.some((id) => taskLabelIds.includes(id))) {
        return false;
      }
    }

    return true;
  });
}

function countActiveFilters(filters: TaskFilters): number {
  let count = 0;
  if (filters.assigneeIds.length > 0) count++;
  if (filters.priorities.length > 0) count++;
  if (filters.completed !== null) count++;
  if (filters.dueDateFrom || filters.dueDateTo) count++;
  if (filters.labelIds.length > 0) count++;
  return count;
}

export function useTaskFilters(tasks: Task[]): UseTaskFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const filteredTasks = useMemo(
    () => applyFilters(tasks, filters),
    [tasks, filters],
  );

  const activeFilterCount = useMemo(
    () => countActiveFilters(filters),
    [filters],
  );

  const setFilter = useCallback(
    <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);

          if (key === "assigneeIds") {
            const ids = value as string[];
            if (ids.length > 0) next.set("assignee", ids.join(","));
            else next.delete("assignee");
          } else if (key === "priorities") {
            const prios = value as TaskPriority[];
            if (prios.length > 0) next.set("priority", prios.join(","));
            else next.delete("priority");
          } else if (key === "completed") {
            const v = value as boolean | null;
            if (v !== null) next.set("completed", String(v));
            else next.delete("completed");
          } else if (key === "dueDateFrom") {
            const v = value as string | null;
            if (v) next.set("dueDateFrom", v);
            else next.delete("dueDateFrom");
          } else if (key === "dueDateTo") {
            const v = value as string | null;
            if (v) next.set("dueDateTo", v);
            else next.delete("dueDateTo");
          } else if (key === "labelIds") {
            const ids = value as string[];
            if (ids.length > 0) next.set("label", ids.join(","));
            else next.delete("label");
          }

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilter = useCallback(
    (key: keyof TaskFilters) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key === "assigneeIds") next.delete("assignee");
          else if (key === "priorities") next.delete("priority");
          else if (key === "completed") next.delete("completed");
          else if (key === "dueDateFrom") next.delete("dueDateFrom");
          else if (key === "dueDateTo") next.delete("dueDateTo");
          else if (key === "labelIds") next.delete("label");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const param of FILTER_PARAMS) next.delete(param);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return {
    filters,
    filteredTasks,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    setFilter,
    clearFilter,
    clearFilters,
  };
}
