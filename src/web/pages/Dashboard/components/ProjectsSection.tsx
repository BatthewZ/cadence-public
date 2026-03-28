import { FolderKanban } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Row, Stack } from "@/web/components/layout";
import {
  Card,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  ProgressBar,
  Skeleton,
  Text,
} from "@/web/components/ui";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";

import type { DashboardStatsResponse, WorkspaceProject } from "./types";

function ProjectCard({ project }: { project: WorkspaceProject }) {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();

  const total = project.taskCounts?.total ?? 0;
  const completed = project.taskCounts?.completed ?? 0;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-shadow"
      onClick={() => void navigate(`/w/${workspace.slug}/projects/${project.id}/board`)}
    >
      <Stack gap="r5">
        <Row gap="r5" align="center">
          <IconDisplay name={project.icon} fallback={FolderKanban} size={20} />
          <Text variant="h6">{project.name}</Text>
        </Row>
        {project.description && (
          <Text variant="body-3" color="secondary" className="line-clamp-2">
            {project.description}
          </Text>
        )}
        <Stack gap="r6">
          <Row justify="between" align="center">
            <Text variant="body-3" color="muted">
              Progress
            </Text>
            <Text variant="body-3" color="muted">
              {completed}/{total} tasks
            </Text>
          </Row>
          <ProgressBar value={progress} size="sm" color={progress === 100 ? "success" : "accent"} />
        </Stack>
        {project.memberCount != null && (
          <Text variant="body-3" color="muted">
            {project.memberCount} {project.memberCount === 1 ? "member" : "members"}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function ProjectsGrid({
  dashboardProjects,
}: {
  dashboardProjects?: DashboardStatsResponse["projects"];
}) {
  const { projects, loading } = useWorkspace();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-r4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i}>
            <Stack gap="r5">
              <Skeleton variant="text" className="h-5 w-3/4" />
              <Skeleton variant="text" className="h-4 w-full" />
              <Skeleton variant="text" className="h-4 w-1/2" />
              <Skeleton variant="rectangular" className="h-2 w-full rounded" />
            </Stack>
          </Card>
        ))}
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <EmptyState size="md">
        <EmptyStateTitle>No projects yet</EmptyStateTitle>
        <EmptyStateDescription>
          Create your first project to start tracking tasks.
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  // Build a lookup from dashboard stats to enrich workspace projects with task counts
  const statsMap = new Map(
    (dashboardProjects ?? []).map((p) => [p.id, p]),
  );

  const enrichedProjects: WorkspaceProject[] = projects.map((p) => {
    const stats = statsMap.get(p.id);
    return {
      ...p,
      taskCounts: stats
        ? { total: stats.taskCounts.total, completed: stats.taskCounts.completed }
        : undefined,
      memberCount: stats?.memberCount ?? p.memberCount,
    };
  });

  const activeEnrichedProjects = enrichedProjects.filter((p) => p.status === "active");

  if (activeEnrichedProjects.length === 0) {
    return (
      <EmptyState size="md">
        <EmptyStateTitle>No active projects</EmptyStateTitle>
        <EmptyStateDescription>
          All projects are archived or completed. Create a new project to get started.
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-r4 sm:grid-cols-2 lg:grid-cols-3">
      {activeEnrichedProjects.map((project: WorkspaceProject) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

export { ProjectCard, ProjectsGrid };
