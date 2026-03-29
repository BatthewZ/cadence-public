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
 * 3. If the user is a direct project member, their project-level role is used
 *    (source: "project").
 * 4. Otherwise return `null` (no access).
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

  // Direct project membership
  if (row.projRole) {
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

  if (row.projRole) {
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
