import type { CostAggregation } from "@/web/hooks/use-project-dashboard";

interface DashboardStatsResponse {
  projects: {
    id: string;
    name: string;
    status: string;
    taskCounts: { active: number; completed: number; total: number };
    memberCount: number;
  }[];
  taskCounts: { activeCount: number; completedCount: number; totalCount: number };
  priorityBreakdown: { priority: string; count: number }[];
  tasksPerMember: { id: string; name: string; image: string | null; count: number }[];
  overdueTasks: {
    id: string;
    title: string;
    priority: string;
    dueDate: string;
    projectId: string;
    projectName: string;
    assigneeName: string | null;
    assigneeImage: string | null;
  }[];
  costAggregation: CostAggregation;
  archivedSummary: {
    status: string;
    projectCount: number;
    totalTasks: number;
    completedTasks: number;
  }[];
}

interface DashboardTaskRaw {
  id: string;
  title: string;
  completed: boolean;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  dueDate: string | null;
  projectId: string;
  projectName: string;
}

interface DashboardTask extends DashboardTaskRaw {
  project: { id: string; name: string };
}

function normalizeTask(t: DashboardTaskRaw): DashboardTask {
  return { ...t, project: { id: t.projectId, name: t.projectName } };
}

interface UpcomingResponse {
  buckets: Record<string, DashboardTaskRaw[]>;
  nextCursor: string | null;
}

interface MyTasksResponse {
  tasks: DashboardTaskRaw[];
  nextCursor: string | null;
}

interface WorkspaceProject {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  icon?: string | null;
  taskCounts?: { total: number; completed: number };
  memberCount?: number;
}

export type {
  DashboardStatsResponse,
  DashboardTask,
  DashboardTaskRaw,
  MyTasksResponse,
  UpcomingResponse,
  WorkspaceProject,
};
export { normalizeTask };
