import { useMemo } from "react";

import type { ProjectRole, WorkspaceRole } from "@/shared/types/roles";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useSession } from "@/web/lib/auth/auth-client";

/**
 * Workspace-level permissions derived from the current user's workspace role.
 */
export interface WorkspacePermissions {
  workspaceRole: WorkspaceRole | null;
  isWorkspaceOwner: boolean;
  /** Owner or admin */
  isWorkspaceAdmin: boolean;
  /** Can edit workspace, invite members, manage roles */
  canManageWorkspace: boolean;
  /** Only the owner can delete */
  canDeleteWorkspace: boolean;
}

/**
 * Project-level permissions derived from workspace + project roles.
 *
 * Workspace owners/admins are elevated to project admin automatically,
 * mirroring the backend's `resolveProjectAccess` logic.
 */
export interface ProjectPermissions extends WorkspacePermissions {
  projectRole: ProjectRole | null;
  isProjectAdmin: boolean;
  /** Admin or member — can create/edit/move/delete tasks */
  canEditTasks: boolean;
  /** Any project role — can view tasks and activity */
  canViewProject: boolean;
}

/**
 * Derives workspace-level permissions for the current user.
 *
 * Must be called within a workspace route.
 */
export function useWorkspacePermissions(): WorkspacePermissions {
  const { data: session } = useSession();
  const { members } = useWorkspace();

  return useMemo(() => {
    const userId = session?.user?.id;
    const membership = userId
      ? members.find((m) => m.userId === userId)
      : undefined;
    const role = (membership?.role ?? null) as WorkspaceRole | null;

    return {
      workspaceRole: role,
      isWorkspaceOwner: role === "owner",
      isWorkspaceAdmin: role === "owner" || role === "admin",
      canManageWorkspace: role === "owner" || role === "admin",
      canDeleteWorkspace: role === "owner",
    };
  }, [session?.user?.id, members]);
}

/**
 * Derives project-level permissions for the current user.
 *
 * Mirrors the backend's access resolution:
 * 1. Workspace owner/admin → elevated to project "admin"
 * 2. Direct project member → use their project role
 * 3. Otherwise → no project access
 *
 * Must be called within both a workspace route and a ProjectProvider.
 * Accepts project members as a parameter to avoid a circular dependency
 * on ProjectContext (which is what typically calls this hook).
 */
export function useProjectPermissions(
  projectMembers: Array<{ userId: string; role: string }>,
): ProjectPermissions {
  const { data: session } = useSession();
  const wsPerms = useWorkspacePermissions();

  return useMemo(() => {
    const userId = session?.user?.id;

    // Workspace owners/admins are elevated to project admin
    if (wsPerms.isWorkspaceAdmin) {
      return {
        ...wsPerms,
        projectRole: "admin" as ProjectRole,
        isProjectAdmin: true,
        canEditTasks: true,
        canViewProject: true,
      };
    }

    // Members haven't loaded yet — default to permissive to avoid a flash
    // of restricted UI. The backend enforces regardless.
    if (projectMembers.length === 0) {
      return {
        ...wsPerms,
        projectRole: null,
        isProjectAdmin: false,
        canEditTasks: true,
        canViewProject: true,
      };
    }

    // Look up direct project membership
    const projectMembership = userId
      ? projectMembers.find((m) => m.userId === userId)
      : undefined;
    const projectRole = (projectMembership?.role ?? null) as ProjectRole | null;

    return {
      ...wsPerms,
      projectRole,
      isProjectAdmin: projectRole === "admin",
      canEditTasks: projectRole === "admin" || projectRole === "member",
      canViewProject: projectRole !== null,
    };
  }, [session?.user?.id, wsPerms, projectMembers]);
}
