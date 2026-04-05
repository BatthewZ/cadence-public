import {
  Bell,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  Plus,
  Star,
  Users,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";

import { UserMenu } from "@/web/components/layout/UserMenu";
import { AppShell } from "@/web/components/ui/AppShell";
import { Text } from "@/web/components/ui/Text";
import type { WorkspaceProject } from "@/web/contexts/WorkspaceContext";
import { getIconComponent } from "@/web/lib/icon-map";

export const SIDEBAR_PROJECT_LIMIT = 8;

interface SidebarNavProps {
  basePath: string;
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
  favoriteProjects,
  visibleProjects,
  activeProjects,
  showAllProjects,
  setShowAllProjects,
  setCreateDialogOpen,
  isFavorite,
  toggleFavorite,
}: SidebarNavProps) {
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
          {visibleProjects.map((project) => (
            <div key={project.id} className="group relative">
              <AppShell.SidebarLink
                to={`${basePath}/projects/${project.id}`}
                icon={getIconComponent(project.icon) ?? FolderKanban}
              >
                {project.name}
              </AppShell.SidebarLink>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  toggleFavorite(project.id);
                }}
                className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-5 rounded hover:bg-surface-2 transition-opacity ${
                  isFavorite(project.id)
                    ? "opacity-100 text-amber-400"
                    : "opacity-0 group-hover:opacity-100 text-fg-muted"
                }`}
                aria-label={isFavorite(project.id) ? "Remove from favorites" : "Add to favorites"}
              >
                <Star size={12} fill={isFavorite(project.id) ? "currentColor" : "none"} />
              </button>
            </div>
          ))}
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
