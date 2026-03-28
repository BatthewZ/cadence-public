import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateTitle,
  Skeleton,
  Tabs,
  Text,
} from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { CreateProjectDialog } from "@/web/components/ui/CreateProjectDialog";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace, type WorkspaceProject } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useFavorites } from "@/web/hooks/use-favorites";
import { api } from "@/web/lib/api/client";

import { ProjectCardGrid } from "./components/ProjectCardGrid";
import { RenameProjectDialog } from "./components/RenameProjectDialog";

export default function ProjectList() {
  useDocumentTitle("Projects");

  const navigate = useNavigate();
  const { workspace, projects, loading, error, refetchProjects } = useWorkspace();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<WorkspaceProject | null>(null);
  const { isFavorite, toggleFavorite } = useFavorites(workspace?.id ?? "");
  const [activeTab, setActiveTab] = useState<string>("active");

  function handleOpenProject(projectId: string) {
    if (!workspace) return;
    void navigate(`/w/${workspace.slug}/projects/${projectId}/board`);
  }

  function handleChangeProjectStatus(
    projectId: string,
    status: "active" | "completed" | "archived",
    successMessage: string,
    failureMessage: string,
  ) {
    setHiddenProjectIds((prev) => new Set(prev).add(projectId));
    toast(successMessage, { variant: "success" });
    api
      .patch(`/api/projects/${projectId}`, { status })
      .then(() => {
        refetchProjects();
      })
      .catch(() => {
        setHiddenProjectIds((prev) => {
          const next = new Set(prev);
          next.delete(projectId);
          return next;
        });
        toast(failureMessage, { variant: "error" });
      });
  }

  async function handleDeleteProject() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/projects/${deleteTarget.id}`);
      toast("Project deleted", { variant: "success" });
      setDeleteTarget(null);
      refetchProjects();
    } catch {
      toast("Failed to delete project", { variant: "error" });
    } finally {
      setDeleting(false);
    }
  }

  const visibleProjects = projects?.filter((p) => !hiddenProjectIds.has(p.id));

  const activeProjects = useMemo(
    () => visibleProjects?.filter((p) => p.status === "active") ?? [],
    [visibleProjects],
  );
  const completedProjects = useMemo(
    () => visibleProjects?.filter((p) => p.status === "completed") ?? [],
    [visibleProjects],
  );
  const archivedProjects = useMemo(
    () => visibleProjects?.filter((p) => p.status === "archived") ?? [],
    [visibleProjects],
  );

  if (loading) {
    return (
      <Stack gap="r4">
        <Row justify="between">
          <Text variant="h3">Projects</Text>
          <Button onClick={() => setDialogOpen(true)} disabled>
            + New Project
          </Button>
        </Row>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i}>
              <Stack gap="r5">
                <Skeleton variant="text" className="h-5 w-3/4" />
                <Skeleton variant="text" className="h-4 w-full" />
                <Skeleton variant="text" className="h-4 w-1/2" />
                <Skeleton variant="rectangular" className="h-6 w-16 rounded" />
                <Row gap="r4">
                  <Skeleton variant="text" className="h-3 w-20" />
                  <Skeleton variant="text" className="h-3 w-16" />
                </Row>
              </Stack>
            </Card>
          ))}
        </div>
      </Stack>
    );
  }

  const gridProps = {
    onOpenProject: handleOpenProject,
    onOpenRenameDialog: setRenameTarget,
    onNavigateToSettings: (projectId: string) => {
      if (!workspace) return;
      void navigate(`/w/${workspace.slug}/projects/${projectId}/settings`);
    },
    onChangeProjectStatus: handleChangeProjectStatus,
    onDeleteProject: setDeleteTarget,
    isFavorite,
    toggleFavorite,
  };

  return (
    <Stack gap="r4">
      <Breadcrumbs>
        <Breadcrumbs.Item href={`/w/${workspace?.slug}/dashboard`}>
          {workspace?.name}
        </Breadcrumbs.Item>
        <Breadcrumbs.Item current>Projects</Breadcrumbs.Item>
      </Breadcrumbs>
      <Row justify="between">
        <Text variant="h3">Projects</Text>
        <Button onClick={() => setDialogOpen(true)}>+ New Project</Button>
      </Row>

      {error && <Alert variant="error">{error}</Alert>}

      {visibleProjects.length === 0 && !error ? (
        <EmptyState>
          <EmptyStateTitle>No projects yet</EmptyStateTitle>
          <EmptyStateDescription>
            Create your first project to start tracking tasks
          </EmptyStateDescription>
          <EmptyStateActions>
            <Button onClick={() => setDialogOpen(true)}>Create Project</Button>
          </EmptyStateActions>
        </EmptyState>
      ) : (
        <Tabs defaultValue="active" value={activeTab} onValueChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="active">Active ({activeProjects.length})</Tabs.Tab>
            <Tabs.Tab value="completed">Completed ({completedProjects.length})</Tabs.Tab>
            <Tabs.Tab value="archived">Archived ({archivedProjects.length})</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="active">
            {activeProjects.length === 0 ? (
              <EmptyState>
                <EmptyStateTitle>No active projects</EmptyStateTitle>
                <EmptyStateDescription>Create a new project to get started</EmptyStateDescription>
                <EmptyStateActions>
                  <Button onClick={() => setDialogOpen(true)}>Create Project</Button>
                </EmptyStateActions>
              </EmptyState>
            ) : (
              <ProjectCardGrid projects={activeProjects} tab="active" {...gridProps} />
            )}
          </Tabs.Panel>
          <Tabs.Panel value="completed">
            {completedProjects.length === 0 ? (
              <EmptyState>
                <EmptyStateTitle>No completed projects yet</EmptyStateTitle>
                <EmptyStateDescription>Projects you mark as completed will appear here</EmptyStateDescription>
              </EmptyState>
            ) : (
              <ProjectCardGrid projects={completedProjects} tab="completed" {...gridProps} />
            )}
          </Tabs.Panel>
          <Tabs.Panel value="archived">
            {archivedProjects.length === 0 ? (
              <EmptyState>
                <EmptyStateTitle>No archived projects</EmptyStateTitle>
                <EmptyStateDescription>Projects you archive will appear here</EmptyStateDescription>
              </EmptyState>
            ) : (
              <ProjectCardGrid projects={archivedProjects} tab="archived" {...gridProps} />
            )}
          </Tabs.Panel>
        </Tabs>
      )}

      {workspace && (
        <CreateProjectDialog
          workspaceId={workspace.id}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={(projectId) => {
            void refetchProjects();
            setDialogOpen(false);
            void navigate(`/w/${workspace.slug}/projects/${projectId}/board`);
          }}
        />
      )}

      <RenameProjectDialog
        renameTarget={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={() => refetchProjects()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDeleteProject()}
        title="Delete Project"
        confirmLabel="Delete Project"
        confirmingLabel="Deleting..."
        confirming={deleting}
      >
        Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will permanently
        delete all tasks and data. This action cannot be undone.
      </ConfirmDialog>
    </Stack>
  );
}
