import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { queryKeys } from "@/web/lib/query-keys";

import { DuplicateProjectDialog } from "./components/DuplicateProjectDialog";
import { ProjectCardGrid } from "./components/ProjectCardGrid";
import { RenameProjectDialog } from "./components/RenameProjectDialog";

export default function ProjectList() {
  useDocumentTitle("Projects");

  const navigate = useNavigate();
  const { workspace, projects, loading, error, refetchProjects } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Tracks optimistic status changes per project so tab counts and tab membership
  // (Active/Completed/Archived) update instantly without waiting for the refetch.
  // We can't merely *hide* the project from the source tab, because that would
  // also hide it from the target tab — leaving the target count stale until a
  // full page reload. Storing the new status here makes the project move to the
  // correct tab immediately. Entries are cleared after the refetch settles
  // (success path) or on failure (rollback).
  const [statusOverrides, setStatusOverrides] = useState<
    Map<string, "active" | "completed" | "archived">
  >(new Map());
  const [renameTarget, setRenameTarget] = useState<WorkspaceProject | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<WorkspaceProject | null>(null);
  const { isFavorite, toggleFavorite } = useFavorites(workspace?.id ?? "");
  const [activeTab, setActiveTab] = useState<string>("active");

  function handleOpenProject(projectId: string) {
    if (!workspace) return;
    void navigate(`/w/${workspace.slug}/projects/${projectId}/board`);
  }

  function clearStatusOverride(projectId: string) {
    setStatusOverrides((prev) => {
      if (!prev.has(projectId)) return prev;
      const next = new Map(prev);
      next.delete(projectId);
      return next;
    });
  }

  async function handleChangeProjectStatus(
    projectId: string,
    status: "active" | "completed" | "archived",
    successMessage: string,
    failureMessage: string,
  ) {
    setStatusOverrides((prev) => new Map(prev).set(projectId, status));
    toast(successMessage, { variant: "success" });
    try {
      await api.patch(`/api/projects/${projectId}`, { status });
      if (workspace) {
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
      }
      // Don't clear the override here — the refetch may still be in flight, and
      // dropping the override before upstream carries the new status would let
      // the project briefly snap back to its previous tab. The reconciliation
      // useEffect below clears the override the moment upstream agrees with it
      // (or the project is gone), which keeps tests deterministic too: in unit
      // tests where the upstream `projects` mock never updates, the override
      // simply persists, preserving the optimistic state under assertion.
      void refetchProjects();
    } catch {
      clearStatusOverride(projectId);
      toast(failureMessage, { variant: "error" });
    }
  }

  // Reconcile optimistic status overrides with the upstream `projects` list:
  // drop an override entry once the server-confirmed project carries the same
  // status (refetch caught up), or once the project no longer exists upstream
  // (e.g. it was deleted). This avoids stale overrides "pinning" a project to
  // the wrong tab if the server-side status diverges from our local guess.
  useEffect(() => {
    if (statusOverrides.size === 0) return;
    setStatusOverrides((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const [id, status] of prev) {
        const project = projects.find((p) => p.id === id);
        if (!project || project.status === status) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [projects, statusOverrides]);

  async function handleDeleteProject() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/projects/${deleteTarget.id}`);
      toast("Project deleted", { variant: "success" });
      setDeleteTarget(null);
      void refetchProjects();
    } catch {
      toast("Failed to delete project", { variant: "error" });
    } finally {
      setDeleting(false);
    }
  }

  // Apply optimistic status overrides on top of upstream projects so the
  // Active/Completed/Archived tabs reflect the target state instantly.
  const visibleProjects = useMemo(() => {
    if (statusOverrides.size === 0) return projects;
    return projects.map((p) => {
      const override = statusOverrides.get(p.id);
      return override ? { ...p, status: override } : p;
    });
  }, [projects, statusOverrides]);

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
    onDuplicateProject: setDuplicateTarget,
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

      <DuplicateProjectDialog
        duplicateTarget={duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
        onDuplicated={(projectId) => {
          setDuplicateTarget(null);
          void refetchProjects();
          void navigate(`/w/${workspace.slug}/projects/${projectId}/board`);
        }}
      />

      <RenameProjectDialog
        renameTarget={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={() => void refetchProjects()}
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
