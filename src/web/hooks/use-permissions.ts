import { useMemo } from "react";

import type { ProjectRole, WorkspaceRole } from "@/shared/types/roles";
import { parseProjectRole, parseWorkspaceRole } from "@/shared/types/roles";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useSession } from "@/web/lib/auth/auth-client";

/**
 * The single wording for "you cannot create a project here".
 *
 * Four surfaces refuse project creation (the sidebar's `+`, the Projects
 * page's button, the dashboard empty state, and the command palette), and a
 * member who runs into one of them will run into the others. Divergent copy
 * across those four would read as four different problems rather than one
 * setting, so the sentence lives here next to the permission it explains — and
 * it names the setting's actual owner, because "no permission" without a route
 * to a person is a dead end.
 */
export const PROJECT_CREATION_DENIED_HINT =
  "Only workspace owners and admins can create projects in this workspace. Ask an admin to create one, or to enable project creation for members in workspace settings.";

/**
 * The empty-project story told to someone who cannot create one.
 *
 * The Projects page and the dashboard both render a "no projects" empty state,
 * and both have to say something different when creation is refused: the
 * default copy instructs the reader to do the one thing they cannot, which
 * makes an ordinary empty workspace look like a broken account. Two verbatim
 * copies of the replacement is one copy too many — a later edit to one of them
 * would leave the same user reading two different explanations for the same
 * state depending on which page they landed on first.
 *
 * Separate from {@link PROJECT_CREATION_DENIED_HINT} because they answer
 * different questions: that one explains a control the reader just tried to
 * press, this one explains an absence they are looking at.
 */
export const NO_PROJECTS_FOR_MEMBER_DESCRIPTION =
  "No projects have been shared with you yet. A workspace admin can create one or add you to an existing project.";

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
  /**
   * Can create a project in this workspace (and duplicate ones they admin).
   *
   * Mirrors `requireProjectCreation` in `src/api/middleware/authorize.ts`:
   * owners and admins always may; a member may while the workspace's
   * `allowMemberProjectCreation` policy is on.
   *
   * Never false merely because the roster is still loading — see
   * {@link WorkspacePermissions.isResolved} for why that distinction matters
   * for this particular flag.
   */
  canCreateProject: boolean;
  /**
   * False while the workspace roster this hook derives the caller's role from
   * has not arrived, so `workspaceRole` is "unknown" rather than "none".
   *
   * The rule is the same one `ProjectPermissions.isResolved` documents: a
   * caller that GRANTS on a permission may ignore this, a caller that DENIES
   * must not. It exists at the workspace level because `canCreateProject` is
   * the first workspace permission whose answer can be restrictive — every
   * other flag here (`canManageWorkspace`, `canDeleteWorkspace`) gates UI that
   * a plain member should not see anyway, so an unresolved `false` and a real
   * `false` lead to the same correct render.
   *
   * `canCreateProject` is different because its restrictive case is the ADMIN
   * case: with the policy off, an unresolved role would hide "New Project"
   * from the admins who are still allowed to use it, then pop the button in
   * once the roster lands. `canCreateProject` is therefore held permissive
   * while this is false, and any surface that hides or disables on it should
   * wait for this to be true.
   */
  isResolved: boolean;
}

/**
 * Project-level permissions derived from workspace + project roles.
 *
 * Workspace owners/admins are elevated to project admin automatically, and a
 * direct project role counts only while the user still holds a workspace
 * membership — the two rules the backend's `resolveProjectAccess` applies.
 */
export interface ProjectPermissions extends WorkspacePermissions {
  projectRole: ProjectRole | null;
  isProjectAdmin: boolean;
  /** Admin or member — can create/edit/move/delete tasks */
  canEditTasks: boolean;
  /** Any project role — can view tasks and activity */
  canViewProject: boolean;
  /**
   * False while a roster this hook needs has not arrived yet, so the values
   * above are the permissive placeholder rather than a decision.
   *
   * Callers that GRANT on a permission may ignore this — that is what the
   * placeholder is for, and it is why the placeholder is permissive. Callers
   * that DENY must not, because the placeholder's `isProjectAdmin: false` is
   * indistinguishable from a real refusal: a project admin who is not a
   * workspace admin would otherwise be shown "you do not have permission" on
   * a hard refresh, until the roster lands and the page silently changes its
   * mind. Deny on `!isProjectAdmin && isResolved`, and show a loading state
   * while this is false.
   */
  isResolved: boolean;
}

/**
 * Derives workspace-level permissions for the current user.
 *
 * Must be called within a workspace route.
 */
export function useWorkspacePermissions(): WorkspacePermissions {
  const { data: session } = useSession();
  const { workspace, members } = useWorkspace();

  return useMemo(() => {
    const userId = session?.user?.id;
    const membership = userId
      ? members.find((m) => m.userId === userId)
      : undefined;
    const role = membership?.role ? parseWorkspaceRole(membership.role) : null;
    // One expression, read twice. `canManageWorkspace` IS "owner or admin" —
    // it was spelled out a second time, and two copies of a permission rule are
    // two things to keep in step. Naming it once means a future change to who
    // may manage a workspace cannot land on one of the pair and miss the other.
    const isWorkspaceAdmin = role === "owner" || role === "admin";

    // An empty roster means "not loaded yet", never "nobody is a member" — a
    // real workspace always contains at least its owner. Same reasoning, and
    // the same permissive treatment, as `useProjectPermissions` below.
    const isResolved = members.length > 0;

    return {
      workspaceRole: role,
      isWorkspaceOwner: role === "owner",
      isWorkspaceAdmin,
      canManageWorkspace: isWorkspaceAdmin,
      canDeleteWorkspace: role === "owner",
      // The server's rule, mirrored: admins are exempt from the toggle, and
      // members are subject to it. The `!isResolved` term is what keeps an
      // unknown role from reading as a denied one — see the field's docs for
      // why this flag in particular needs it.
      canCreateProject:
        !isResolved ||
        isWorkspaceAdmin ||
        workspace.policy.allowMemberProjectCreation,
      isResolved,
    };
  }, [session?.user?.id, members, workspace.policy]);
}

/**
 * Derives project-level permissions for the current user.
 *
 * Mirrors the backend's `resolveProjectAccess` (`src/api/lib/access.ts`),
 * rule for rule:
 * 1. Workspace owner/admin → elevated to project "admin"
 * 2. Direct project member **who still holds a workspace membership** → use
 *    their project role
 * 3. Otherwise → no project access
 *
 * ## Why rule 2 carries the workspace-membership condition
 *
 * Workspace membership is the outer boundary; a project role narrows it and
 * never outlives it. The backend added that condition when offboarding turned
 * out to be cosmetic — an orphaned `project_member` row kept granting read,
 * write and export after the `workspace_member` row was deleted. Leaving it
 * out here made the JSDoc's "mirrors the backend" claim false, which is worse
 * than a missing check: the next person to reason about a permission gap reads
 * this hook and trusts it to say what the server will do.
 *
 * Being precise about the effect, so this is not mistaken for a security
 * control: it is not one. The server decides, and a removed member cannot load
 * this workspace's context at all — `requireWorkspaceMember` fails the fetch
 * that populates `members` — so the divergence is close to unreachable in a
 * live session. What the condition buys is that the client's model and the
 * server's model agree as written, so a reader can trust the mirror.
 *
 * It does NOT close the removed-mid-session window, and should not be cited as
 * doing so: React Query keeps the last successful payload when a refetch
 * fails, and `WorkspaceContext` reads `membersData?.members ?? []`, so after a
 * removal the 403'd refetch leaves the stale roster — still naming the removed
 * user — in place. `workspaceRole` stays non-null and the orphaned project role
 * keeps being honoured client-side until the page is reloaded. The server
 * rejects every request made in that window, which is why this is a display
 * concern and not a hole.
 *
 * ## Loading is "unknown", not "denied"
 *
 * Both membership lists arrive asynchronously, and an empty list means "not
 * loaded yet" rather than "nobody is a member" — a real workspace always has
 * at least its owner, a real project at least its creator. Treating either
 * empty list as an absent membership would flash restricted UI on every page
 * load, so both are handled permissively. The backend enforces regardless.
 *
 * Must be called within both a workspace route and a ProjectProvider.
 * Accepts project members as a parameter to avoid a circular dependency
 * on ProjectContext (which is what typically calls this hook).
 */
export function useProjectPermissions(
  projectMembers: Array<{ userId: string; role: string }>,
): ProjectPermissions {
  const { data: session } = useSession();
  const { members: workspaceMembers } = useWorkspace();
  const wsPerms = useWorkspacePermissions();

  return useMemo(() => {
    const userId = session?.user?.id;

    // Workspace owners/admins are elevated to project admin
    if (wsPerms.isWorkspaceAdmin) {
      return {
        ...wsPerms,
        projectRole: "admin" satisfies ProjectRole,
        isProjectAdmin: true,
        canEditTasks: true,
        canViewProject: true,
        isResolved: true,
      };
    }

    // Members haven't loaded yet — default to permissive to avoid a flash
    // of restricted UI. The backend enforces regardless.
    //
    // `isResolved: false` is what makes that safe. The permissive defaults
    // cover the GRANT direction, but `isProjectAdmin` cannot be permissive
    // without flashing admin controls at non-admins — so it sits here as
    // `false`, identical in shape to a real refusal. Any caller that DENIES on
    // it must check `isResolved` first; see the field's own docs.
    if (projectMembers.length === 0 || workspaceMembers.length === 0) {
      return {
        ...wsPerms,
        projectRole: null,
        isProjectAdmin: false,
        canEditTasks: true,
        canViewProject: true,
        isResolved: false,
      };
    }

    // Look up direct project membership. The roster is loaded and the user is
    // not in it as a workspace member, so any project role they hold is an
    // orphan and confers nothing — same call the server makes.
    const projectMembership =
      userId && wsPerms.workspaceRole !== null
        ? projectMembers.find((m) => m.userId === userId)
        : undefined;
    const projectRole = projectMembership?.role ? parseProjectRole(projectMembership.role) : null;

    return {
      ...wsPerms,
      projectRole,
      isProjectAdmin: projectRole === "admin",
      canEditTasks: projectRole === "admin" || projectRole === "member",
      canViewProject: projectRole !== null,
      isResolved: true,
    };
  }, [session?.user?.id, wsPerms, projectMembers, workspaceMembers]);
}
