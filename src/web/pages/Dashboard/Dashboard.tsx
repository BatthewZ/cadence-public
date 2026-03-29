import { useQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ActivityFeed } from "@/web/components/dashboard/ActivityFeed";
import { OverdueTasksSection } from "@/web/components/dashboard/OverdueTasksSection";
import { PriorityBreakdownSection } from "@/web/components/dashboard/PriorityBreakdown";
import { TeamWorkloadSection } from "@/web/components/dashboard/TeamWorkload";
import { Container, Row, Stack } from "@/web/components/layout";
import {
  Button,
  Card,
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
  QueryErrorRetry,
  Text,
} from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { CreateProjectDialog } from "@/web/components/ui/CreateProjectDialog";
import { TaskDetailDialog } from "@/web/components/ui/TaskDetailDialog";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useWorkspaceActivity } from "@/web/hooks/use-workspace-activity";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import {
  formatActivityMessage,
  formatGroupedLabelMessage,
  groupLabelActivities,
} from "@/web/util/activity";

import { ArchivedProjectsSummary } from "./components/ArchivedSummary";
import { CostSummaryCard } from "./components/CostSummary";
import { DashboardSkeleton } from "./components/DashboardSkeleton";
import { ProjectsGrid } from "./components/ProjectsSection";
import { StatCardsRow } from "./components/StatCards";
import { MyTasksPreview, TimeGroupedTaskList } from "./components/TaskLists";
import type { DashboardStatsResponse } from "./components/types";

export default function Dashboard() {
  useDocumentTitle("Dashboard");
  const { workspace, projects, members } = useWorkspace();
  const navigate = useNavigate();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const { data: statsData, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery({
    queryKey: queryKeys.workspaces.dashboard(workspace.id),
    queryFn: () => api.get<DashboardStatsResponse>(`/api/workspaces/${workspace.id}/dashboard`),
    staleTime: 30_000,
  });

  const activityQuery = useWorkspaceActivity(workspace.id);

  const allActivities = useMemo(
    () => activityQuery.data?.pages.flatMap((p) => p.activities ?? []) ?? [],
    [activityQuery.data],
  );

  const activityRows = useMemo(
    () =>
      groupLabelActivities(allActivities).map((group) => ({
        key: group.representative.id,
        activity: group.representative,
        message: group.isLabelGroup
          ? formatGroupedLabelMessage(group)
          : formatActivityMessage(group.representative, members),
      })),
    [allActivities, members],
  );

  const projectCount = projects?.length ?? 0;
  const activeProjectCount = projects?.filter((p) => p.status === "active").length ?? 0;

  if (statsLoading) {
    return (
      <Container size="xl" className="py-r2">
        <Stack gap="r3">
          <Breadcrumbs>
            <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
            <Breadcrumbs.Item current>Dashboard</Breadcrumbs.Item>
          </Breadcrumbs>
          <Text variant="h3">Dashboard</Text>
          <DashboardSkeleton />
        </Stack>
      </Container>
    );
  }

  if (statsError) {
    return (
      <Container size="xl" className="py-r2">
        <Stack gap="r3">
          <Breadcrumbs>
            <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
            <Breadcrumbs.Item current>Dashboard</Breadcrumbs.Item>
          </Breadcrumbs>
          <Text variant="h3">Dashboard</Text>
          <QueryErrorRetry message="Failed to load dashboard data." onRetry={refetchStats} />
        </Stack>
      </Container>
    );
  }

  const taskCounts = statsData?.taskCounts ?? { activeCount: 0, completedCount: 0, totalCount: 0 };
  const overdueTasks = statsData?.overdueTasks ?? [];
  const priorityBreakdown = statsData?.priorityBreakdown ?? [];
  const tasksPerMember = statsData?.tasksPerMember ?? [];
  const costAggregation = statsData?.costAggregation;
  const archivedSummary = statsData?.archivedSummary ?? [];

  if (projectCount === 0) {
    return (
      <Container size="xl" className="py-r2">
        <Stack gap="r3">
          <Breadcrumbs>
            <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
            <Breadcrumbs.Item current>Dashboard</Breadcrumbs.Item>
          </Breadcrumbs>
          <Text variant="h3">Dashboard</Text>

          <EmptyState size="lg">
            <EmptyStateIcon>
              <FolderKanban />
            </EmptyStateIcon>
            <EmptyStateTitle>No projects yet</EmptyStateTitle>
            <EmptyStateDescription>
              Create your first project to start tracking tasks.
            </EmptyStateDescription>
            <EmptyStateActions>
              <Button onClick={() => setCreateProjectOpen(true)}>Create Project</Button>
            </EmptyStateActions>
          </EmptyState>
        </Stack>

        <CreateProjectDialog
          workspaceId={workspace.id}
          open={createProjectOpen}
          onClose={() => setCreateProjectOpen(false)}
          onCreated={(projectId) => {
            setCreateProjectOpen(false);
            void navigate(`/w/${workspace.slug}/projects/${projectId}/board`);
          }}
        />
      </Container>
    );
  }

  return (
    <Container size="xl" className="py-r2">
      <Stack gap="r3">
        <Breadcrumbs>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
          <Breadcrumbs.Item current>Dashboard</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Dashboard</Text>

        <OverdueTasksSection
          overdueTasks={overdueTasks}
          onTaskClick={setSelectedTaskId}
          renderContext={(task) => task.projectName}
        />

        <StatCardsRow taskCounts={taskCounts} projectCount={activeProjectCount} costAggregation={costAggregation} />
        <ArchivedProjectsSummary archivedSummary={archivedSummary} />

        <div className="grid grid-cols-1 gap-r4 md:grid-cols-3">
          <div className="md:col-span-2">
            <Stack gap="r4">
              {/* My Tasks preview */}
              <Card>
                <Stack gap="r5">
                  <Row justify="between" align="center">
                    <Text variant="h5">My Tasks</Text>
                    <Link
                      to={`/w/${workspace.slug}/my-tasks`}
                      className="text-sm font-medium text-accent hover:text-accent-hover transition-colors"
                    >
                      View all
                    </Link>
                  </Row>
                  <MyTasksPreview onTaskClick={setSelectedTaskId} />
                </Stack>
              </Card>

              <PriorityBreakdownSection priorityBreakdown={priorityBreakdown} />
              <TeamWorkloadSection tasksPerMember={tasksPerMember} />

              {costAggregation && costAggregation.tasksWithCost > 0 && (
                <CostSummaryCard costAggregation={costAggregation} />
              )}

              {/* Upcoming tasks */}
              <Card>
                <Stack gap="r5">
                  <Text variant="h5">Upcoming</Text>
                  <TimeGroupedTaskList onTaskClick={setSelectedTaskId} />
                </Stack>
              </Card>

              {/* Projects grid */}
              <Stack gap="r5">
                <Text variant="h5">Projects</Text>
                <ProjectsGrid dashboardProjects={statsData?.projects} />
              </Stack>
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
                renderExtra={(activity) => activity.projectName}
              />
            </div>
          </div>
        </div>
      </Stack>

      {selectedTaskId && (
        <TaskDetailDialog
          taskId={selectedTaskId}
          members={members}
          open={!!selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </Container>
  );
}
