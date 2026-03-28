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
