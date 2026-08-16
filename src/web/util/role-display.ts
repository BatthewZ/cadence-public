import type { ProjectRole } from "@/shared/types/roles";

/**
 * What each project role can actually do, in one line, for display next to a
 * role picker.
 *
 * ## Why this text exists at all
 *
 * "Admin / Member / Viewer" is not self-describing, and the two decisions it
 * hides are the ones that hurt: Member vs Viewer is the write boundary
 * (`requireProjectRole("admin", "member")` and `requireTaskRole("admin",
 * "member")` gate every task, comment, attachment and task-group mutation), and
 * Member vs Admin is the settings boundary (`requireProjectRole("admin")` gates
 * project settings, member management, webhooks, the cover image, duplication
 * and deletion). An admin picking blind either locks a contributor out of the
 * board or hands project administration to someone meant to file tickets — and
 * neither mistake announces itself, because the wrong role looks identical to
 * the right one in the members table.
 *
 * ## Why it lives here rather than in either dialog
 *
 * Both project role pickers — "Add Member" and "Change Role" in
 * `ProjectSettings/components` — need the same sentences, and a role's meaning
 * must not depend on which door you came through. Same reasoning as
 * {@link getRoleBadgeVariant} below, which was centralized here after the
 * badge mapping drifted between the same two screens.
 *
 * The prose is a mirror of the server's route guards, not an authority over
 * them: the full per-endpoint matrix is in `docs/api/endpoints.md`, and the
 * user-facing version is in `docs/guides/user-guide.md`. If a guard moves, this
 * text is wrong until it moves too.
 */
export const PROJECT_ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  admin: "Everything a member can do, plus project settings, members, webhooks and deletion.",
  member: "Can create and edit tasks, comments, attachments, task groups and labels.",
  viewer: "Read-only. Can browse the board, save personal views and export the CSV.",
};

/**
 * Returns the badge variant for a given role string.
 *
 * Centralizes the role-to-badge-variant mapping that was previously duplicated
 * across workspace member columns and project settings. Having a single source
 * of truth ensures consistent visual treatment of roles throughout the app.
 */
export function getRoleBadgeVariant(role: string): "default" | "info" | "success" {
  switch (role) {
    case "owner":
      return "success";
    case "admin":
      return "info";
    case "member":
    case "viewer":
    default:
      return "default";
  }
}
