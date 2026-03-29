import { useMemo, useState } from "react";

import { ActivityFeed } from "@/web/components/dashboard/ActivityFeed";
import { OverdueTasksSection } from "@/web/components/dashboard/OverdueTasksSection";
import { PriorityBreakdownSection } from "@/web/components/dashboard/PriorityBreakdown";
import { TeamWorkloadSection } from "@/web/components/dashboard/TeamWorkload";
import { Stack } from "@/web/components/layout";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { TaskDetailDialog } from "@/web/components/ui/TaskDetailDialog";
import { useProject } from "@/web/contexts/ProjectContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useProjectActivity } from "@/web/hooks/use-project-activity";
import { useProjectDashboard } from "@/web/hooks/use-project-dashboard";
import { formatActivityMessage } from "@/web/util/activity";

import { BudgetAndCostsSection } from "./components/BudgetSection";
import { DashboardSkeleton } from "./components/DashboardSkeleton";
import { StatCardsRow } from "./components/StatCards";
import { TasksByGroupSection } from "./components/TasksByGroup";
import { UpcomingTasksSection } from "./components/UpcomingTasks";

/* ------------------------------------------------------------------ */
/*  ProjectDashboard — main page component                             */
/* ------------------------------------------------------------------ */

export default function ProjectDashboard() {
  const { project } = useProject();
  const { workspace, members } = useWorkspace();
  const { data, isLoading, isError, refetch } = useProjectDashboard(project.id);
  const activityQuery = useProjectActivity(project.id);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const allActivities = useMemo(
    () => activityQuery.data?.pages.flatMap((p) => p.activities) ?? [],
    [activityQuery.data],
  );

  const activityRows = useMemo(
    () =>
      allActivities.map((activity) => ({
        key: activity.id,
        activity,
        message: formatActivityMessage(activity, members),
      })),
    [allActivities, members],
  );

  useDocumentTitle(`${project.name} — Dashboard`);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (isError || !data) {
    return (
      <QueryErrorRetry message="Failed to load project dashboard." onRetry={refetch} />
    );
  }

  return (
    <Stack gap="r3">
      <OverdueTasksSection
        overdueTasks={data.overdueTasks}
        onTaskClick={setSelectedTaskId}
      />

      <StatCardsRow data={data} />

      <div className="grid grid-cols-1 gap-r4 md:grid-cols-3">
        <div className="md:col-span-2">
          <Stack gap="r4">
            <PriorityBreakdownSection
              priorityBreakdown={data.priorityBreakdown}
            />
            <TasksByGroupSection
              tasksByGroup={data.tasksByGroup}
              totalCount={data.taskCounts.totalCount}
            />
            <TeamWorkloadSection tasksPerMember={data.tasksPerMember} />
            <UpcomingTasksSection
              upcomingTasks={data.upcomingTasks}
              onTaskClick={setSelectedTaskId}
              projectId={project.id}
              workspaceSlug={workspace.slug}
            />
          </Stack>
        </div>
        <div className="md:sticky md:top-0 md:self-start">
          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto rounded-lg">
            <ActivityFeed
              rows={activityRows}
              isLoading={activityQuery.isLoading}
              isError={activityQuery.isError}
              hasNextPage={activityQuery.hasNextPage}
              fetchNextPage={() => void activityQuery.fetchNextPage()}
              isFetchingNextPage={activityQuery.isFetchingNextPage}
              onTaskClick={setSelectedTaskId}
            />
          </div>
        </div>
      </div>

      <BudgetAndCostsSection data={data} />

      {selectedTaskId && (
        <TaskDetailDialog
          taskId={selectedTaskId}
          members={members}
          open={!!selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </Stack>
  );
}
