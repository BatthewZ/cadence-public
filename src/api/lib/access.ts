import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { project, projectMember } from "../../db/schema/project";
import { task } from "../../db/schema/task";
import { workspaceMember } from "../../db/schema/workspace";
import type { ProjectRole } from "../../shared/types/roles";

/**
 * Result of resolving a user's access to a project.
 *
 * `role` is the effective role: workspace owners/admins are elevated to "admin",
 * otherwise the role comes directly from the project membership record.
 *
 * `source` indicates where the access was derived from — "workspace" for
 * elevated workspace owner/admin access, "project" for direct project membership.
 */
export interface ProjectAccessResult {
  role: ProjectRole;
  source: "workspace" | "project";
  project: { id: string; workspaceId: string };
}

/**
 * Resolve whether `userId` has access to the project identified by `projectId`.
 *
 * Uses a single LEFT JOIN query to fetch the project, workspace membership,
 * and project membership in one D1 round-trip instead of 3 sequential queries.
 *
 * Access resolution follows these rules in order:
 * 1. If the project does not exist, return `null`.
 * 2. If the user is a workspace owner or admin, they receive an elevated
 *    "admin" role (source: "workspace").
 * 3. If the user is a direct project member **and still holds a workspace
 *    membership**, their project-level role is used (source: "project").
 * 4. Otherwise return `null` (no access).
 *
 * ## Why rule 3 requires a live workspace membership
 *
 * Workspace membership is the outer boundary; a project role is a narrowing
 * *within* it, never a grant that outlives it. Honouring `project_member`
 * on its own made offboarding cosmetic: `removeMember` deleted the
 * `workspace_member` row, the user vanished from the members list and their
 * workspace list went empty, yet every `project_member` row they held kept
 * granting full read, write and CSV export on those projects. The database
 * cannot save us either — `project_member.userId` cascades on *user*
 * deletion, not on losing workspace membership.
 *
 * `removeMember` now deletes those rows, but that only fixes the one
 * instance. This condition closes the whole class: any orphaned
 * `project_member` row stops conferring access here, at the row-level choke
 * point every protected project endpoint funnels through.
 *
 * Being precise about what that class contains, so nobody later reads this
 * as evidence of a second live hole: no current write path *creates* such a
 * row. `addMember` rejects a non-workspace-member, the import executor only
 * maps refs to users selected from `workspace_member`, and
 * `duplicateProject` filters the copied roster through the same
 * workspace-membership query `addMember` uses (`selectWorkspaceMemberIds` in
 * `routes/projects/projects.handlers.ts`), so it can no longer propagate an
 * orphan it inherited from the source project either. What remains is rows
 * predating the offboarding fix. So this is defence in depth against a class
 * with no current new entrants — cheap insurance, not a patch. The check is free:
 * the workspace membership is already LEFT JOINed for rule 2, so no extra
 * query or round-trip is added.
 *
 * Scope note: this governs *row-level* access resolution. Several
 * workspace-scoped list and aggregate queries (search, dashboard, activity,
 * label listing) join `project_member` directly without consulting this
 * function. They are safe because each is mounted behind
 * `requireWorkspaceMember()` — not because they route through here.
 *
 * This is the single source of truth for project access checks across the API.
 */
export async function resolveProjectAccess(
  db: Database,
  projectId: string,
  userId: string,
): Promise<ProjectAccessResult | null> {
  const [row] = await db
    .select({
      projectId: project.id,
      workspaceId: project.workspaceId,
      wsRole: workspaceMember.role,
      projRole: projectMember.role,
    })
    .from(project)
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.workspaceId, project.workspaceId),
        eq(workspaceMember.userId, userId),
      ),
    )
    .leftJoin(
      projectMember,
      and(
        eq(projectMember.projectId, project.id),
        eq(projectMember.userId, userId),
      ),
    )
    .where(eq(project.id, projectId))
    .limit(1);

  if (!row) return null;

  // Workspace owners/admins are elevated to project admin
  if (row.wsRole === "owner" || row.wsRole === "admin") {
    return {
      role: "admin",
      source: "workspace",
      project: { id: row.projectId, workspaceId: row.workspaceId },
    };
  }

  // Direct project membership — only while the user is still in the workspace.
  // An orphaned project_member row (see the "why" note above) grants nothing.
  if (row.projRole && row.wsRole) {
    return {
      role: row.projRole,
      source: "project",
      project: { id: row.projectId, workspaceId: row.workspaceId },
    };
  }

  // User exists in workspace (or not) but has no project access
  return null;
}

/**
 * Resolve whether `userId` has access to the project that owns the given task.
 *
 * Uses a single query joining task → project → workspace_member → project_member,
 * reducing what was 4 sequential queries (task lookup + resolveProjectAccess) to 1.
 *
 * Applies exactly the same rules as `resolveProjectAccess`, including the
 * requirement that a project-membership-derived grant is backed by a live
 * workspace membership — see that function's note for why. The two must stay
 * in lockstep: this one guards every `/tasks/:taskId` route while the other
 * guards `/projects/:projectId`, so a rule enforced in only one of them
 * leaves the same data reachable by a different URL.
 *
 * Returns:
 * - `{ found: false }` if the task does not exist
 * - `{ found: true, access: null }` if the task exists but the user has no access
 * - `{ found: true, access: ProjectAccessResult }` if the user has access
 */
export type TaskAccessResult =
  | { found: false }
  | { found: true; access: ProjectAccessResult | null };

export async function resolveTaskAccess(
  db: Database,
  taskId: string,
  userId: string,
): Promise<TaskAccessResult> {
  const [row] = await db
    .select({
      taskId: task.id,
      projectId: project.id,
      workspaceId: project.workspaceId,
      wsRole: workspaceMember.role,
      projRole: projectMember.role,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.workspaceId, project.workspaceId),
        eq(workspaceMember.userId, userId),
      ),
    )
    .leftJoin(
      projectMember,
      and(
        eq(projectMember.projectId, project.id),
        eq(projectMember.userId, userId),
      ),
    )
    .where(eq(task.id, taskId))
    .limit(1);

  if (!row) return { found: false };

  if (row.wsRole === "owner" || row.wsRole === "admin") {
    return {
      found: true,
      access: {
        role: "admin",
        source: "workspace",
        project: { id: row.projectId, workspaceId: row.workspaceId },
      },
    };
  }

  // Direct project membership — only while the user is still in the workspace.
  if (row.projRole && row.wsRole) {
    return {
      found: true,
      access: {
        role: row.projRole,
        source: "project",
        project: { id: row.projectId, workspaceId: row.workspaceId },
      },
    };
  }

  // Task exists but user has no access to its project
  return { found: true, access: null };
}
