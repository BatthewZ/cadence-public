import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import type { Theme } from "@/shared/types/theme";
import { NotificationBell } from "@/web/components/layout/NotificationBell";
import { SIDEBAR_PROJECT_LIMIT, SidebarNav } from "@/web/components/layout/workspace/SidebarNav";
import { WorkspaceSwitcher } from "@/web/components/layout/workspace/WorkspaceSwitcher";
import { AppShell } from "@/web/components/ui/AppShell";
import { CommandPalette } from "@/web/components/ui/CommandPalette";
import { CreateProjectDialog } from "@/web/components/ui/CreateProjectDialog";
import { KeyboardShortcutsDialog } from "@/web/components/ui/KeyboardShortcutsDialog";
import { Text } from "@/web/components/ui/Text";
import { ThemeSwitcher } from "@/web/components/ui/ThemeSwitcher";
import { useToast } from "@/web/components/ui/ToastContext";
import {
  ThemeControlProvider,
  type ThemeControlValue,
  ThemeOverrideProvider,
} from "@/web/contexts/ThemeControlContext";
import { useWorkspace, type Workspace, type WorkspacesResponse } from "@/web/contexts/WorkspaceContext";
import { useFavorites } from "@/web/hooks/use-favorites";
import { useChordIndicator, useHotkey, useHotkeyChord } from "@/web/hooks/use-hotkey";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { useThemeApplication } from "@/web/hooks/use-theme";
import { useWorkspaceFreshness } from "@/web/hooks/use-workspace-freshness";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";

export function WorkspaceLayout() {
  const navigate = useNavigate();
  const { workspace, members, projects, refetch } = useWorkspace();
  useWorkspaceFreshness(workspace.id, members.length > 1);
  const { data: session } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canManageWorkspace } = useWorkspacePermissions();
  const [searchOpen, setSearchOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const storageKey = `cadence:sidebar-projects-expanded:${workspace.id}`;
  const [showAllProjects, setShowAllProjects] = useState(() => {
    try { return localStorage.getItem(storageKey) === "true"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, String(showAllProjects)); } catch { /* noop */ }
  }, [showAllProjects, storageKey]);
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === "active"),
    [projects],
  );
  const visibleProjects = showAllProjects || activeProjects.length <= SIDEBAR_PROJECT_LIMIT
    ? activeProjects
    : activeProjects.slice(0, SIDEBAR_PROJECT_LIMIT);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useHotkey("k", openSearch, { ctrlOrMeta: true });

  // Keyboard shortcuts dialog
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useHotkey("?", openShortcuts);

  // Navigation chord shortcuts (g then d/m/p/s)
  const navToDashboard = useCallback(() => { void navigate(`/w/${workspace.slug}/dashboard`); }, [navigate, workspace.slug]);
  const navToMyTasks = useCallback(() => { void navigate(`/w/${workspace.slug}/my-tasks`); }, [navigate, workspace.slug]);
  const navToProjects = useCallback(() => { void navigate(`/w/${workspace.slug}/projects`); }, [navigate, workspace.slug]);
  const navToSettings = useCallback(() => { void navigate(`/w/${workspace.slug}/settings`); }, [navigate, workspace.slug]);
  const navToMembers = useCallback(() => { void navigate(`/w/${workspace.slug}/settings/members`); }, [navigate, workspace.slug]);
  useHotkeyChord("g", "d", navToDashboard);
  useHotkeyChord("g", "m", navToMyTasks);
  useHotkeyChord("g", "p", navToProjects);
  useHotkeyChord("g", "s", navToSettings);
  useHotkeyChord("g", "e", navToMembers);

  // Chord indicator for navbar
  const chordPrefix = useChordIndicator();

  const { data: allWorkspacesData } = useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api.get<WorkspacesResponse>("/api/workspaces"),
  });
  const allWorkspaces = allWorkspacesData?.workspaces ?? [];

  // Project override — set by ProjectLayout via ThemeOverrideContext when
  // the user navigates into a project, cleared when they navigate out.
  const [projectOverride, setProjectOverride] = useState<ThemeControlValue | null>(null);

  // Determine if current user is owner or admin in this workspace
  const currentUserId = session?.user?.id;
  const currentMember = members.find((m) => m.userId === currentUserId);
  const canEditTheme = currentMember?.role === "owner" || currentMember?.role === "admin";

  // Workspace theme mutation with optimistic update for instant visual feedback
  const { mutate: updateTheme, isPending: themePending } = useMutation({
    mutationFn: (theme: Theme | null) =>
      api.patch(`/api/workspaces/${workspace.id}`, { theme }),
    onMutate: async (newTheme) => {
      await qc.cancelQueries({ queryKey: queryKeys.workspaces.detail(workspace.id) });
      const previousData = qc.getQueryData(queryKeys.workspaces.detail(workspace.id));
      qc.setQueryData(
        queryKeys.workspaces.detail(workspace.id),
        (old: { workspace: Workspace } | undefined) =>
          old ? { workspace: { ...old.workspace, theme: newTheme } } : old,
      );
      return { previousData };
    },
    onError: (_err, _newTheme, context) => {
      if (context?.previousData) {
        qc.setQueryData(queryKeys.workspaces.detail(workspace.id), context.previousData);
      }
      toast("Failed to update theme.", { variant: "error" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspace.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      refetch();
    },
  });

  // Command palette action handler
  const handlePaletteAction = useCallback((action: string) => {
    switch (action) {
      case "create-project":
        setCreateDialogOpen(true);
        break;
      case "toggle-theme":
        if (canEditTheme) {
          const nextTheme = (workspace.theme ?? "default") === "default" ? "noir" : "default";
          updateTheme(nextTheme as Theme);
        }
        break;
    }
    setSearchOpen(false);
  }, [canEditTheme, workspace.theme, updateTheme]);

  const workspaceThemeControl = useMemo<ThemeControlValue>(() => ({
    scope: "workspace",
    canEdit: canEditTheme ?? false,
    effectiveTheme: (workspace.theme ?? "default") as Theme,
    setTheme: (theme: Theme | null) => updateTheme(theme),
    hasProjectOverride: false,
    isPending: themePending,
  }), [canEditTheme, workspace.theme, updateTheme, themePending]);

  // When a project is active, use its override; otherwise use workspace control.
  const activeControl = projectOverride ?? workspaceThemeControl;

  // Single theme application point — always uses the active control's effective theme.
  // When projectOverride is set, this applies the project theme.
  // When projectOverride is cleared (unmount), this reverts to workspace theme.
  useThemeApplication(
    workspace.theme,
    projectOverride ? projectOverride.effectiveTheme : null,
  );

  const basePath = `/w/${workspace.slug}`;
  const { favorites, isFavorite, toggleFavorite } = useFavorites(workspace.id);
  const favoriteProjects = useMemo(() =>
    projects.filter((p) => favorites.includes(p.id) && p.status === "active"),
    [projects, favorites],
  );

  return (
    <ThemeControlProvider value={activeControl}>
      <ThemeOverrideProvider onOverride={setProjectOverride}>
        <AppShell defaultOpen>
          <AppShell.Navbar>
            <AppShell.Toggle />
            <AppShell.Brand>
              <Text variant="h6">{workspace.name}</Text>
            </AppShell.Brand>
            <AppShell.NavbarActions>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="command-palette-trigger"
                aria-label="Search workspace"
              >
                <Search size={14} />
                <span className="command-palette-trigger__text">Search...</span>
                <kbd className="command-palette-trigger__kbd">
                  {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "\u2318" : "Ctrl"}K
                </kbd>
              </button>
              {chordPrefix && (
                <span className="chord-indicator">
                  <kbd className="command-palette-trigger__kbd">{chordPrefix}</kbd>
                  <span className="text-fg-muted text-body-3">...</span>
                </span>
              )}
              <NotificationBell />
              <ThemeSwitcher />
            </AppShell.NavbarActions>
          </AppShell.Navbar>

          <AppShell.Sidebar>
            <WorkspaceSwitcher
              workspace={workspace}
              allWorkspaces={allWorkspaces}
              canManageWorkspace={canManageWorkspace}
              basePath={basePath}
              navigate={navigate}
            />
            <SidebarNav
              basePath={basePath}
              workspaceId={workspace.id}
              favoriteProjects={favoriteProjects}
              visibleProjects={visibleProjects}
              activeProjects={activeProjects}
              showAllProjects={showAllProjects}
              setShowAllProjects={setShowAllProjects}
              setCreateDialogOpen={setCreateDialogOpen}
              isFavorite={isFavorite}
              toggleFavorite={toggleFavorite}
            />
          </AppShell.Sidebar>

          <AppShell.Main>
            <Outlet />
          </AppShell.Main>

          {searchOpen && (
            <CommandPalette
              open
              onClose={() => setSearchOpen(false)}
              onAction={handlePaletteAction}
            />
          )}
          {shortcutsOpen && (
            <KeyboardShortcutsDialog
              open
              onClose={() => setShortcutsOpen(false)}
            />
          )}
          <CreateProjectDialog
            workspaceId={workspace.id}
            open={createDialogOpen}
            onClose={() => setCreateDialogOpen(false)}
            onCreated={(projectId) => {
              setCreateDialogOpen(false);
              void refetch();
              void navigate(`${basePath}/projects/${projectId}/board`);
            }}
          />
        </AppShell>
      </ThemeOverrideProvider>
    </ThemeControlProvider>
  );
}
