import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  Plus,
  Users,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import { UserMenu } from "@/web/components/layout/UserMenu";
import { AppShell } from "@/web/components/ui/AppShell";
import { Text } from "@/web/components/ui/Text";
import type { WorkspaceProject } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";
import { getIconComponent } from "@/web/lib/icon-map";
import { queryKeys } from "@/web/lib/query-keys";

import { SortableProjectItem } from "./SortableProjectItem";

export const SIDEBAR_PROJECT_LIMIT = 8;

interface SidebarNavProps {
  basePath: string;
  workspaceId: string;
  favoriteProjects: WorkspaceProject[];
  visibleProjects: WorkspaceProject[];
  activeProjects: WorkspaceProject[];
  showAllProjects: boolean;
  setShowAllProjects: Dispatch<SetStateAction<boolean>>;
  setCreateDialogOpen: Dispatch<SetStateAction<boolean>>;
  isFavorite: (projectId: string) => boolean;
  toggleFavorite: (projectId: string) => void;
}

export function SidebarNav({
  basePath,
  workspaceId,
  favoriteProjects,
  visibleProjects,
  activeProjects,
  showAllProjects,
  setShowAllProjects,
  setCreateDialogOpen,
  isFavorite,
  toggleFavorite,
}: SidebarNavProps) {
  const qc = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const sortedVisibleProjects = useMemo(
    () =>
      [...visibleProjects].sort((a, b) => {
        if (!a.position && !b.position) return 0;
        if (!a.position) return 1;
        if (!b.position) return -1;
        return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
      }),
    [visibleProjects],
  );

  const projectIds = useMemo(
    () => sortedVisibleProjects.map((p) => p.id),
    [sortedVisibleProjects],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortedVisibleProjects.findIndex((p) => p.id === active.id);
      const newIndex = sortedVisibleProjects.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sortedVisibleProjects, oldIndex, newIndex);
      const above = newIndex > 0 ? reordered[newIndex - 1] : null;
      const below =
        newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
      const newPosition = generateKeyBetween(
        above?.position ?? null,
        below?.position ?? null,
      );

      const movedProject = sortedVisibleProjects[oldIndex];
      const queryKey = queryKeys.workspaces.projects(workspaceId);

      const previousData = qc.getQueryData(queryKey);
      qc.setQueryData(
        queryKey,
        (old: { projects: Array<{ id: string; position?: string | null }> } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            projects: old.projects.map((p) =>
              p.id === movedProject.id ? { ...p, position: newPosition } : p,
            ),
          };
        },
      );

      try {
        await api.patch(`/api/projects/${movedProject.id}/reorder`, {
          position: newPosition,
        });
      } catch {
        qc.setQueryData(queryKey, previousData);
      }
    },
    [sortedVisibleProjects, workspaceId, qc],
  );

  return (
    <>
      {/* Main navigation */}
      <AppShell.SidebarSection>
        <AppShell.SidebarLink to={`${basePath}/dashboard`} icon={LayoutDashboard}>
          Dashboard
        </AppShell.SidebarLink>
        <AppShell.SidebarLink to={`${basePath}/my-tasks`} icon={CheckSquare}>
          My Tasks
        </AppShell.SidebarLink>
        <AppShell.SidebarLink to={`${basePath}/notifications`} icon={Bell}>
          Notifications
        </AppShell.SidebarLink>
        <AppShell.SidebarLink to={`${basePath}/settings/members`} icon={Users}>
          Members
        </AppShell.SidebarLink>
      </AppShell.SidebarSection>

      {favoriteProjects.length > 0 && (
        <AppShell.SidebarSection>
          <div className="flex items-center justify-between px-3 py-1">
            <Text variant="body-3" weight="semibold" color="muted" className="uppercase tracking-wider text-[0.6875rem]">
              Favorites
            </Text>
          </div>
          {favoriteProjects.map((project) => (
            <AppShell.SidebarLink
              key={`fav-${project.id}`}
              to={`${basePath}/projects/${project.id}`}
              icon={getIconComponent(project.icon) ?? FolderKanban}
            >
              {project.name}
            </AppShell.SidebarLink>
          ))}
        </AppShell.SidebarSection>
      )}

      {/* Projects */}
      <AppShell.SidebarSection className="min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-3 py-1">
          <Link
            to={`${basePath}/projects`}
            className="uppercase tracking-wider text-[0.6875rem] font-semibold text-fg-muted hover:text-fg-primary transition-colors"
          >
            Projects
          </Link>
          <button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            className="inline-flex items-center justify-center size-5 rounded hover:bg-surface-2 text-fg-muted hover:text-fg-primary transition-colors"
            aria-label="Create project"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="overflow-y-none flex-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              void handleDragEnd(event);
            }}
          >
            <SortableContext
              items={projectIds}
              strategy={verticalListSortingStrategy}
            >
              {sortedVisibleProjects.map((project) => (
                <SortableProjectItem
                  key={project.id}
                  project={project}
                  basePath={basePath}
                  isFavorite={isFavorite(project.id)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </SortableContext>
          </DndContext>
          {activeProjects.length > SIDEBAR_PROJECT_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllProjects((prev) => !prev)}
              className="w-full px-3 py-1.5 text-left text-body-3 text-fg-muted hover:text-fg-primary transition-colors"
            >
              {showAllProjects ? "Show less" : `Show all (${activeProjects.length})`}
            </button>
          )}
        </div>
      </AppShell.SidebarSection>

      {/* User menu — pushed to bottom */}
      <AppShell.SidebarSection className="mt-auto">
        <UserMenu />
      </AppShell.SidebarSection>
    </>
  );
}
