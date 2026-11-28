import { ChevronsUpDown, LogOut, Settings, User } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

import { InstallAppMenuItem, InstallHelpDialog } from "@/web/components/pwa";
import { UnsyncedSignOutDialog } from "@/web/components/sync/UnsyncedSignOutDialog";
import { useSignOut } from "@/web/components/sync/use-sign-out";
import { useOptionalAppShell } from "@/web/components/ui/AppShell";
import { Avatar } from "@/web/components/ui/Avatar";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { useOptionalWorkspace } from "@/web/contexts/WorkspaceContext";
import { useSession } from "@/web/lib/auth/auth-client";
import { useInstall } from "@/web/lib/pwa";

/**
 * Compact user account menu rendered at the bottom of the sidebar.
 * Consolidates account info, settings links, and sign-out into a single dropdown.
 */
export function UserMenu() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const toLogin = useCallback(() => void navigate("/login"), [navigate]);
  const signOutFlow = useSignOut(toLogin);
  const { installed } = useInstall();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const appShell = useOptionalAppShell();
  const isMobile = appShell?.isMobile ?? false;
  const workspaceCtx = useOptionalWorkspace();

  // When inside AppShell (workspace view with sidebar), use sidebar-appropriate placements.
  // When outside AppShell (e.g. /workspaces top nav), use "bottom-end" so it drops below the trigger.
  const placement = appShell ? (isMobile ? "top-end" : "right-end") : ("bottom-end" as const);

  if (!session?.user) return null;

  const { name, email, image } = session.user;

  // Settings paths require an active workspace for proper layout/context
  const accountSettingsPath = workspaceCtx ? `/w/${workspaceCtx.workspace.slug}/account` : null;
  const workspaceSettingsPath = workspaceCtx ? `/w/${workspaceCtx.workspace.slug}/settings` : null;
  const settingsItemCount = [accountSettingsPath, workspaceSettingsPath].filter(Boolean).length;

  return (
    <>
      <DropdownMenu placement={placement}>
        <DropdownMenu.Trigger asChild>
          <button className="user-menu-trigger" aria-label="Account menu">
            <Avatar size="sm" name={name} src={image} />
            <div className="user-menu-trigger-info">
              <span className="user-menu-trigger-name">{name}</span>
              <span className="user-menu-trigger-email">{email}</span>
            </div>
            <ChevronsUpDown size={14} className="user-menu-trigger-chevron" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Content>
          {/* User info header */}
          <div className="user-menu-header">
            <Avatar size="sm" name={name} src={image} />
            <div className="user-menu-header-info">
              <div className="user-menu-header-name">{name}</div>
              <div className="user-menu-header-email">{email}</div>
            </div>
          </div>

          <DropdownMenu.Divider />

          {accountSettingsPath && (
            <DropdownMenu.Item
              index={0}
              icon={<User size={16} />}
              onSelect={() => void navigate(accountSettingsPath)}
            >
              Account Settings
            </DropdownMenu.Item>
          )}

          {workspaceSettingsPath && (
            <DropdownMenu.Item
              index={accountSettingsPath ? 1 : 0}
              icon={<Settings size={16} />}
              onSelect={() => void navigate(workspaceSettingsPath)}
            >
              Workspace Settings
            </DropdownMenu.Item>
          )}

          {(accountSettingsPath || workspaceSettingsPath) && <DropdownMenu.Divider />}

          <InstallAppMenuItem
            index={settingsItemCount}
            onShowHelp={() => setInstallHelpOpen(true)}
          />

          <DropdownMenu.Item
            index={settingsItemCount + (installed ? 0 : 1)}
            icon={<LogOut size={16} />}
            onSelect={signOutFlow.request}
            disabled={signOutFlow.disabled}
            title={signOutFlow.title}
          >
            {signOutFlow.signingOut ? "Signing out…" : "Sign Out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
      <UnsyncedSignOutDialog flow={signOutFlow} />
      <InstallHelpDialog open={installHelpOpen} onClose={() => setInstallHelpOpen(false)} />
    </>
  );
}
