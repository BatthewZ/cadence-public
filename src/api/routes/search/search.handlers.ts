import { and, eq, like, or } from "drizzle-orm";
import type { Context } from "hono";

import { project, projectMember } from "../../../db/schema/project";
import { task } from "../../../db/schema/task";
import { searchQuerySchema } from "../../../shared/schemas/search";
import type { AppEnv } from "../../env";
import { requireParam } from "../../lib/params";
import { validQuery } from "../../lib/validated";
import { tokenProjectScopeFilter } from "../../middleware/authorize";

/**
 * Escape LIKE-pattern metacharacters in user input so they are matched literally.
 */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * GET /workspaces/:workspaceId/search?q=...&limit=...
 *
 * Searches projects and tasks within the workspace. For workspace owners/admins,
 * all entities are searchable. For regular members, results are restricted to
 * projects the user belongs to.
 *
 * Two independent narrowings apply, and both are needed:
 *
 *  - the **human** narrowing above (elevated role vs. direct project
 *    membership), and
 *  - the **token** narrowing (`patScope`), which restricts a PAT with
 *    `projectScope: "selected"` to its own project list.
 *
 * The token narrowing matters because search is the highest-yield read in the
 * API for an attacker: a single unauthenticated-looking `?q=` returns task
 * titles AND project names across everything the caller can reach. The
 * workspace-level route guard can only verify the token's workspace binding,
 * so without this filter a token deliberately scoped to one project would
 * return titles from every sibling project — silently voiding the containment
 * promise that is the reason to mint a narrow token at all. Filtering rather
 * than rejecting is deliberate: a narrowed integration searching its own
 * project should get its results, not an error.
 *
 * `tokenProjectScopeFilter` returns `undefined` for cookie sessions and for
 * `projectScope: "all"` tokens, so the SQL for a human is unchanged.
 */
export async function workspaceSearch(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const { q, limit } = validQuery(c, searchQuerySchema);

  const pattern = `%${escapeLike(q)}%`;
  const isElevated = membership.role === "owner" || membership.role === "admin";
  const patScope = tokenProjectScopeFilter(c, project.id);

  // Search projects
  const projectsQuery = isElevated
    ? db
        .select({
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          icon: project.icon,
        })
        .from(project)
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            patScope,
            or(
              like(project.name, pattern),
              like(project.description, pattern),
            ),
          ),
        )
        .limit(limit)
    : db
        .select({
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          icon: project.icon,
        })
        .from(project)
        .innerJoin(
          projectMember,
          and(
            eq(projectMember.projectId, project.id),
            eq(projectMember.userId, user.id),
          ),
        )
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            patScope,
            or(
              like(project.name, pattern),
              like(project.description, pattern),
            ),
          ),
        )
        .limit(limit);

  // Search tasks
  const tasksQuery = isElevated
    ? db
        .select({
          id: task.id,
          title: task.title,
          priority: task.priority,
          completed: task.completed,
          projectId: task.projectId,
          projectName: project.name,
          projectIcon: project.icon,
        })
        .from(task)
        .innerJoin(project, eq(task.projectId, project.id))
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            patScope,
            or(
              like(task.title, pattern),
              like(task.description, pattern),
            ),
          ),
        )
        .limit(limit)
    : db
        .select({
          id: task.id,
          title: task.title,
          priority: task.priority,
          completed: task.completed,
          projectId: task.projectId,
          projectName: project.name,
          projectIcon: project.icon,
        })
        .from(task)
        .innerJoin(project, eq(task.projectId, project.id))
        .innerJoin(
          projectMember,
          and(
            eq(projectMember.projectId, project.id),
            eq(projectMember.userId, user.id),
          ),
        )
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            patScope,
            or(
              like(task.title, pattern),
              like(task.description, pattern),
            ),
          ),
        )
        .limit(limit);

  const [projects, tasks] = await Promise.all([projectsQuery, tasksQuery]);

  return c.json({ projects, tasks });
}
