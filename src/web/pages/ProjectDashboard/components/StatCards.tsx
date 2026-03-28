import { TaskMetricsCards } from "@/web/components/dashboard/TaskMetricsCards";
import type { ProjectDashboardData } from "@/web/hooks/use-project-dashboard";

export function StatCardsRow({ data }: { data: ProjectDashboardData }) {
  return (
    <TaskMetricsCards
      taskCounts={data.taskCounts}
      gridClassName="grid grid-cols-1 gap-r4 sm:grid-cols-3"
    />
  );
}
