import { eq } from "drizzle-orm";

import type { Database } from "../../db";
import { workspace } from "../../db/schema/workspace";
import type { WorkspacePolicy } from "../../shared/types/workspace-policy";
import {
  DEFAULT_WORKSPACE_POLICY,
  resolveWorkspacePolicy,
} from "../../shared/types/workspace-policy";

/**
 * Load and resolve a workspace's governance policy.
 *
 * The one place the server reads `workspace.policy` for an authorization
 * decision. Handlers that already hold the workspace row should call
 * `resolveWorkspacePolicy` on it directly rather than paying for this query
 * again — this exists for the middleware path, which has a workspace id and
 * nothing else.
 *
 * ## Why a missing workspace resolves to defaults rather than throwing
 *
 * Callers reach here only after a membership check has already passed, so a
 * missing row means the workspace was deleted between that check and this
 * query. Returning defaults hands the decision back to the caller's own
 * not-found handling instead of inventing a second, differently-shaped failure
 * for a race the caller is already equipped to lose. It cannot widen access:
 * the membership row is what grants entry, and it is gone too.
 */
export async function loadWorkspacePolicy(
  db: Database,
  workspaceId: string,
): Promise<WorkspacePolicy> {
  const [row] = await db
    .select({ policy: workspace.policy })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  if (!row) return { ...DEFAULT_WORKSPACE_POLICY };
  return resolveWorkspacePolicy(row.policy);
}
