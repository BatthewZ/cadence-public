import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, CalendarRange, Download, FolderKanban, LayoutGrid, List, Settings, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";

import { type Theme,THEMES } from "@/shared/types/theme";
import { Input } from "@/web/components/form/Input";
import { Row, Stack } from "@/web/components/layout";
import { ImportIcsDialog } from "@/web/components/project/ImportIcsDialog";
import { TaskFilterBar } from "@/web/components/project/TaskFilterBar";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { Button } from "@/web/components/ui/Button";
import { CoverImage } from "@/web/components/ui/CoverImage";
import { Dialog } from "@/web/components/ui/Dialog";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { IconButton } from "@/web/components/ui/IconButton";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { IconPicker } from "@/web/components/ui/IconPicker";
import { Tabs } from "@/web/components/ui/Tabs";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import type { ProjectMember } from "@/web/contexts/ProjectContext";
import { ProjectProvider, useProject } from "@/web/contexts/ProjectContext";
import { type ThemeControlValue, useSetThemeOverride } from "@/web/contexts/ThemeControlContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useProjectPermissions } from "@/web/hooks/use-permissions";
import { useProjectCover } from "@/web/hooks/use-project-cover";
import { useRecents } from "@/web/hooks/use-recents";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { downloadProjectICS } from "@/web/lib/export-ics";
import { queryKeys } from "@/web/lib/query-keys";
import { TaskDetailPanel } from "@/web/pages/TaskDetail/TaskDetailPanel";

function ProjectLayoutInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: session } = useSession();
  const { workspace } = useWorkspace();
  const { addRecent } = useRecents(workspace.id);
  const { project, members, tasks, updateProject, refetch } = useProject();
  const { isProjectAdmin, canEditTasks } = useProjectPermissions(members);
  const {
    coverUrl,
    coverSrcSet,
    coverAttribution,
    uploading,
    handleUpload: handleCoverUpload,
    handleRemove: handleCoverRemove,
    handleApplyUnsplash: handleCoverApplyUnsplash,
  } = useProjectCover(
    project.id,
    project.coverImageKey,
    project.coverUnsplash,
    updateProject,
    refetch,
    refetch,
  );

  // Query project members to determine the current user's role
  const currentUserId = session?.user?.id;
  const { data: membersData, error: membersError } = useQuery({
    queryKey: queryKeys.projects.members(project.id),
    queryFn: () =>
      api.get<{ members: ProjectMember[] }>(`/api/projects/${project.id}/members`),
  });
  useEffect(() => {
    if (membersError) {
      console.error("Failed to load project members:", membersError);
    }
  }, [membersError]);
  const currentMember = membersData?.members?.find((m) => m.userId === currentUserId);
  const canEditTheme = currentMember?.role === "admin";

  // Project theme mutation with optimistic update for instant visual feedback
  const { mutate: updateTheme, isPending: themePending } = useMutation({
    mutationFn: (theme: Theme | null) =>
      api.patch(`/api/projects/${project.id}`, { theme }),
    onMutate: async (newTheme) => {
      await qc.cancelQueries({ queryKey: queryKeys.projects.detail(project.id) });
      const previousTheme = project.theme;
      updateProject({ theme: newTheme });
      return { previousTheme };
    },
    onError: (_err, _newTheme, context) => {
      if (context) {
        updateProject({ theme: context.previousTheme });
      }
      toast("Failed to update theme.", { variant: "error" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
      refetch();
    },
  });

  // Resolve effective theme: project > workspace > default
  const raw = project.theme ?? workspace.theme ?? "default";
  const effectiveTheme: Theme = THEMES.includes(raw as Theme) ? (raw as Theme) : "default";

  const projectThemeControl = useMemo<ThemeControlValue>(() => ({
    scope: "project",
    canEdit: canEditTheme ?? false,
    effectiveTheme,
    setTheme: (theme: Theme | null) => updateTheme(theme),
    hasProjectOverride: project.theme != null,
    isPending: themePending,
  }), [canEditTheme, effectiveTheme, updateTheme, project.theme, themePending]);

  // Push project theme control up to WorkspaceLayout via ThemeOverrideContext.
  // On mount: set the project override so navbar ThemeSwitcher sees project scope.
  // On unmount: clear the override so the workspace theme is restored.
  const setThemeOverride = useSetThemeOverride();
  useEffect(() => {
    if (setThemeOverride) {
      setThemeOverride(projectThemeControl);
    }
    return () => {
      if (setThemeOverride) {
        setThemeOverride(null);
      }
    };
  }, [setThemeOverride, projectThemeControl]);

  // Track project visit in recents
  useEffect(() => {
    addRecent({ id: project.id, name: project.name, type: "project" });
  }, [project.id, project.name, addRecent]);

  const handleCoverPositionChange = useCallback(
    (pos: number) => {
      updateProject({ coverImagePosition: pos });
      void api.patch(`/api/projects/${project.id}`, { coverImagePosition: pos });
    },
    [project.id, updateProject]
  );

  // --- Inline title editing ---
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const titleDirty = useRef(false);

  const handleTitleSave = useCallback(async () => {
    if (!titleDirty.current) return;
    setEditingTitle(false);
    titleDirty.current = false;
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== project.name) {
      updateProject({ name: trimmed });
      // Also optimistically update the workspace projects cache (drives sidebar)
      const wpKey = queryKeys.workspaces.projects(project.workspaceId);
      qc.setQueryData(wpKey, (old: { projects: Array<{ id: string; name: string }> } | undefined) =>
        old
          ? { projects: old.projects.map((p) => (p.id === project.id ? { ...p, name: trimmed } : p)) }
          : old,
      );
      try {
        await api.patch(`/api/projects/${project.id}`, { name: trimmed });
      } catch {
        toast("Failed to update project name.", { variant: "error" });
        refetch();
        void qc.invalidateQueries({ queryKey: wpKey });
      }
    }
  }, [titleValue, project.name, project.id, project.workspaceId, updateProject, qc, toast, refetch]);

  // --- Inline icon editing ---
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const handleIconChange = useCallback(
    async (newIcon: string | null) => {
      setIconPickerOpen(false);
      updateProject({ icon: newIcon });
      // Also optimistically update the workspace projects cache (drives sidebar)
      const wpKey = queryKeys.workspaces.projects(project.workspaceId);
      qc.setQueryData(wpKey, (old: { projects: Array<{ id: string; icon?: string | null }> } | undefined) =>
        old
          ? { projects: old.projects.map((p) => (p.id === project.id ? { ...p, icon: newIcon } : p)) }
          : old,
      );
      try {
        await api.patch(`/api/projects/${project.id}`, { icon: newIcon });
      } catch {
        toast("Failed to update icon.", { variant: "error" });
        refetch();
        void qc.invalidateQueries({ queryKey: wpKey });
      }
    },
    [project.id, project.workspaceId, updateProject, qc, toast, refetch]
  );

  // --- Calendar export / import (.ics) ---
  const [importIcsOpen, setImportIcsOpen] = useState(false);

  /**
   * Client-side export: the shared ICS generator is isomorphic and the
   * project's tasks are already in memory, so no endpoint is involved (see
   * `@/web/lib/export-ics`). Exports ALL tasks with dates — not the filtered
   * subset — because "export this project" must not silently depend on
   * invisible filter state. Zero dated tasks → explain instead of handing
   * the user an empty calendar file.
   */
  const handleExportCalendar = useCallback(() => {
    const exported = downloadProjectICS(project.name, tasks);
    if (exported === 0) {
      toast("This project has no tasks with dates to export.", { variant: "info" });
    }
  }, [project.name, tasks, toast]);

  const basePath = `/w/${workspace.slug}/projects/${project.id}`;

  // Determine active tab from current path
  const segments = location.pathname.split("/");
  const lastSegment = segments[segments.length - 1];
  const activeTab = ["dashboard", "board", "list", "timeline", "calendar", "settings"].includes(lastSegment)
    ? lastSegment
    : "board";

  // The calendar menu gates itself exactly like TaskFilterBar below: it acts
  // on tasks, so it is meaningless on the settings and dashboard tabs.
  const showCalendarMenu = activeTab !== "settings" && activeTab !== "dashboard";

  function handleTabChange(value: string) {
    void navigate(`${basePath}/${value}`);
  }

  return (
    <Stack gap="r3" className="py-r2">
      <Breadcrumbs>
        <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
        <Breadcrumbs.Item href={`/w/${workspace.slug}/projects`}>Projects</Breadcrumbs.Item>
        <Breadcrumbs.Item href={basePath}>{project.name}</Breadcrumbs.Item>
        <Breadcrumbs.Item current>
          {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
        </Breadcrumbs.Item>
      </Breadcrumbs>
      <CoverImage
        coverUrl={coverUrl}
        coverSrcSet={coverSrcSet}
        coverAttribution={coverAttribution}
        onUpload={handleCoverUpload}
        onApplyUnsplash={(payload) => { void handleCoverApplyUnsplash(payload); }}
        onRemove={() => { void handleCoverRemove(); }}
        uploading={uploading}
        editable={isProjectAdmin}
        position={project.coverImagePosition}
        onPositionChange={handleCoverPositionChange}
      />

      <div>
        <div className="flex items-center gap-3">
          {isProjectAdmin ? (
            <>
              <button
                type="button"
                onClick={() => setIconPickerOpen(true)}
                className="shrink-0 inline-flex items-center justify-center size-8 rounded hover:bg-surface-2 active:bg-surface-3 duration-fast cursor-pointer text-fg-secondary"
                aria-label={project.icon ? `Project icon: ${project.icon}` : "Choose project icon"}
              >
                <IconDisplay name={project.icon} fallback={FolderKanban} size={28} />
              </button>
              <Dialog open={iconPickerOpen} onClose={() => setIconPickerOpen(false)}>
                <Stack gap="r4">
                  <Row justify="between" align="center">
                    <Text variant="h5">Choose Icon</Text>
                    <button
                      type="button"
                      onClick={() => setIconPickerOpen(false)}
                      className="inline-flex items-center justify-center rounded-md p-r5 text-fg-secondary hover:bg-surface-2 active:bg-surface-3 duration-fast cursor-pointer"
                      aria-label="Close"
                    >
                      <X size={20} />
                    </button>
                  </Row>
                  <Text variant="body-2" color="secondary">
                    Select an icon to represent this project in navigation and breadcrumbs.
                  </Text>
                  <IconPicker
                    value={project.icon ?? null}
                    onChange={(newIcon) => {
                      void handleIconChange(newIcon);
                      if (newIcon !== null) {
                        setIconPickerOpen(false);
                      }
                    }}
                    portal={false}
                  />
                  {project.icon && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void handleIconChange(null);
                        setIconPickerOpen(false);
                      }}
                    >
                      Clear icon
                    </Button>
                  )}
                </Stack>
              </Dialog>
            </>
          ) : (
            <IconDisplay name={project.icon} fallback={FolderKanban} size={28} />
          )}
          {!editingTitle ? (
            <Text
              variant="h3"
              weight="bold"
              className={isProjectAdmin ? "cursor-pointer hover:text-accent duration-fast" : ""}
              onClick={isProjectAdmin ? () => { setTitleValue(project.name); setEditingTitle(true); } : undefined}
              title={isProjectAdmin ? "Click to edit" : undefined}
            >
              {project.name}
            </Text>
          ) : (
            <Input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onFocus={() => { titleDirty.current = true; }}
              onBlur={() => { void handleTitleSave(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleTitleSave();
                if (e.key === "Escape") { setEditingTitle(false); titleDirty.current = false; }
              }}
              className="text-h3 font-bold bg-transparent px-r6 py-0 rounded border-none"
            />
          )}
        </div>
        {project.description && (
          <Text variant="body-2" color="muted" className="mt-0.5 ml-[2.5rem]">
            {project.description}
          </Text>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 min-w-0">
        <Tabs value={activeTab} onValueChange={handleTabChange} defaultValue="board" className="min-w-0">
          <Tabs.List>
            <Tabs.Tab value="dashboard">
              <span className="inline-flex items-center gap-r6">
                <BarChart3 size={14} />
                Dashboard
              </span>
            </Tabs.Tab>
            <Tabs.Tab value="board">
              <span className="inline-flex items-center gap-r6">
                <LayoutGrid size={14} />
                Board
              </span>
            </Tabs.Tab>
            <Tabs.Tab value="list">
              <span className="inline-flex items-center gap-r6">
                <List size={14} />
                List
              </span>
            </Tabs.Tab>
            <Tabs.Tab value="timeline">
              <span className="inline-flex items-center gap-r6">
                <CalendarRange size={14} />
                Timeline
              </span>
            </Tabs.Tab>
            <Tabs.Tab value="calendar">
              <span className="inline-flex items-center gap-r6">
                <CalendarDays size={14} />
                Calendar
              </span>
            </Tabs.Tab>
            {isProjectAdmin && (
              <Tabs.Tab value="settings">
                <span className="inline-flex items-center gap-r6">
                  <Settings size={14} />
                  Settings
                </span>
              </Tabs.Tab>
            )}
          </Tabs.List>
        </Tabs>
        {showCalendarMenu && (
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger asChild>
              <IconButton aria-label="Calendar export and import">
                <Download size={16} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item
                index={0}
                icon={<Download size={14} />}
                onSelect={handleExportCalendar}
              >
                Export calendar (.ics)
              </DropdownMenu.Item>
              {canEditTasks && (
                <DropdownMenu.Item
                  index={1}
                  icon={<Upload size={14} />}
                  onSelect={() => setImportIcsOpen(true)}
                >
                  Import calendar (.ics)…
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        )}
      </div>

      {activeTab !== "settings" && activeTab !== "dashboard" && <TaskFilterBar tasks={tasks} />}

      <Outlet />

      <TaskDetailPanel />

      {/* Mounted only for members with edit rights — the import endpoint
          requires them, so viewers never see the dialog (or its menu item). */}
      {canEditTasks && (
        <ImportIcsDialog open={importIcsOpen} onClose={() => setImportIcsOpen(false)} />
      )}
    </Stack>
  );
}

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return null;
  }

  return (
    <ProjectProvider projectId={projectId}>
      <ProjectLayoutInner />
    </ProjectProvider>
  );
}
