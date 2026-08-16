import type { ReactNode } from "react";

import { Alert } from "@/web/components/ui";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";

/**
 * Tells a workspace member why an owner/admin-only control is missing from the
 * surface around it.
 *
 * Renders nothing until the roster resolves: an unresolved role is
 * indistinguishable from `member`, and telling an actual admin they lack
 * permission — then silently retracting it — is worse than a beat of nothing.
 * Gate the controls themselves on `canManageWorkspace` alone, never on this
 * component's condition, so the unresolved case still fails closed.
 */
export function AdminOnlyNotice({ children }: { children: ReactNode }) {
  const { canManageWorkspace, isResolved } = useWorkspacePermissions();

  if (!isResolved || canManageWorkspace) return null;

  return <Alert variant="info">{children}</Alert>;
}
