import { ChevronsUpDown, LogOut, Settings, User } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useOptionalAppShell } from "@/web/components/ui/AppShell";
import { Avatar } from "@/web/components/ui/Avatar";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { useOptionalWorkspace } from "@/web/contexts/WorkspaceContext";
import { STORAGE_KEY } from "@/web/hooks/use-theme";
import { signOut, useSession } from "@/web/lib/auth/auth-client";
import { queryClient } from "@/web/lib/query-client";

/**
 * Compact user account menu rendered at the bottom of the sidebar.
 * Consolidates account info, settings links, and sign-out into a single dropdown.
 */
export function UserMenu() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const appShell = useOptionalAppShell();
  const isMobile = appShell?.isMobile ?? false;
  const workspaceCtx = useOptionalWorkspace();

  if (!session?.user) return null;

  const { name, email, image } = session.user;

  // Settings paths require an active workspace for proper layout/context
  const accountSettingsPath = workspaceCtx
    ? `/w/${workspaceCtx.workspace.slug}/account`
    : null;
  const workspaceSettingsPath = workspaceCtx
    ? `/w/${workspaceCtx.workspace.slug}/settings`
    : null;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      queryClient.clear();
      document.documentElement.removeAttribute("data-theme");
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* private browsing */ }
      void navigate("/login");
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu placement={isMobile ? "top-end" : "right-end"}>
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

        <DropdownMenu.Item
          index={[accountSettingsPath, workspaceSettingsPath].filter(Boolean).length}
          icon={<LogOut size={16} />}
          onSelect={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign Out"}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
