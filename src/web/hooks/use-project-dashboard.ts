import { useQuery } from "@tanstack/react-query";

import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

export interface OverdueTask {
  id: string;
  title: string;
  priority: string;
  dueDate: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  taskGroupName: string;
}

export interface PriorityCount {
  priority: string;
  count: number;
}

export interface CostAggregation {
  totalCost: number;
  completedCost: number;
  activeCost: number;
  tasksWithCost: number;
}

export interface ProjectDashboardData {
  taskCounts: {
    activeCount: number;
    completedCount: number;
    totalCount: number;
  };
  tasksByGroup: Array<{
    taskGroupId: string;
    taskGroupName: string;
    count: number;
  }>;
  tasksPerMember: Array<{
    id: string;
    name: string;
    count: number;
  }>;
  upcomingTasks: Array<{
    id: string;
    title: string;
    completed: boolean;
    priority: string;
    dueDate: string;
    assigneeId: string;
    taskGroupId: string;
    taskGroupName: string;
  }>;
  overdueTasks: OverdueTask[];
  priorityBreakdown: PriorityCount[];
  costAggregation: CostAggregation;
  budget: number | null;
  costPerMember: Array<{
    id: string;
    name: string;
    totalCost: number;
  }>;
}

export function useProjectDashboard(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projects.dashboard(projectId),
    queryFn: () =>
      api.get<ProjectDashboardData>(`/api/projects/${projectId}/dashboard`),
    staleTime: 30_000,
  });
}
