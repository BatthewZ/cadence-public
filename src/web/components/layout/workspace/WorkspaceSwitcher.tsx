import {
  Check,
  ChevronDown,
  Plus,
  Settings,
} from "lucide-react";
import type { NavigateFunction } from "react-router-dom";

import { AppShell } from "@/web/components/ui/AppShell";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { Text } from "@/web/components/ui/Text";
import type { Workspace } from "@/web/contexts/WorkspaceContext";
import { cn } from "@/web/util/style/style";

interface WorkspaceSwitcherProps {
  workspace: Workspace;
  allWorkspaces: Workspace[];
  canManageWorkspace: boolean;
  basePath: string;
  navigate: NavigateFunction;
}

export function WorkspaceSwitcher({
  workspace,
  allWorkspaces,
  canManageWorkspace,
  basePath,
  navigate,
}: WorkspaceSwitcherProps) {
  return (
    <AppShell.SidebarSection>
      <div className="px-3 py-2">
        <DropdownMenu placement="bottom-start">
          <DropdownMenu.Trigger asChild>
            <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
              <Text variant="body-2" weight="semibold" as="span" className="truncate">
                {workspace.name}
              </Text>
              <ChevronDown size={16} className="shrink-0 text-fg-muted" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Label>Workspaces</DropdownMenu.Label>
            {allWorkspaces?.map((ws, index) => (
              <DropdownMenu.Item
                key={ws.id}
                index={index}
                icon={ws.id === workspace.id ? <Check size={16} className="text-fg-primary" /> : <span className="inline-block size-4" />}
                className={cn(ws.id === workspace.id && "bg-surface-2 font-semibold")}
                onSelect={() => {
                  localStorage.setItem("lastWorkspaceSlug", ws.slug);
                  void navigate(`/w/${ws.slug}/dashboard`);
                }}
              >
                {ws.name}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Divider />
            {canManageWorkspace && (
              <DropdownMenu.Item
                index={allWorkspaces?.length ?? 0}
                icon={<Settings size={16} />}
                onSelect={() => void navigate(`${basePath}/settings`)}
              >
                Workspace Settings
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              index={(allWorkspaces?.length ?? 0) + 1}
              icon={<Plus size={16} />}
              onSelect={() => void navigate("/workspaces")}
            >
              Create Workspace
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
      </div>
    </AppShell.SidebarSection>
  );
}
