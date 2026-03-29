import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import type { Database } from "../../db";
import { project } from "../../db/schema/project";
import { workspaceMember } from "../../db/schema/workspace";
import type { ProjectRole, WorkspaceRole } from "../../shared/types/roles";
import type { AppEnv } from "../env";
import { resolveProjectAccess, resolveTaskAccess } from "../lib/access";
import { errorResponse } from "../lib/error-response";
import { requireParam } from "../lib/params";

// ---------------------------------------------------------------------------
// Shared helpers (keep middleware functions DRY)
// ---------------------------------------------------------------------------

async function lookupWorkspaceMembership(
  db: Database,
  workspaceId: string,
  userId: string,
) {
  const [membership] = await db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, userId),
      ),
    )
    .limit(1);

  return membership ?? null;
}

/**
 * Resolves workspace membership for the current user, using the cached
 * value when available. Caches the result in context for downstream use.
 */
async function getOrResolveWorkspaceMembership(
  c: Context<AppEnv>,
  workspaceId: string,
  userId: string,
): Promise<{ id: string; workspaceId: string; role: WorkspaceRole } | null> {
  const cached = c.get("workspaceMembership");
  if (cached && cached.workspaceId === workspaceId) return cached;

  const db = c.get("db");
  const membership = await lookupWorkspaceMembership(db, workspaceId, userId);
  if (!membership) return null;

  const result = { id: membership.id, workspaceId, role: membership.role };
  c.set("workspaceMembership", result);
  return result;
}

/**
 * Resolves project access for the current user, using the cached value
 * when available. Caches the result in context for downstream use.
 * Returns `"not_found"` when the project does not exist, `null` when the
 * user has no access, or the access record on success.
 */
async function getOrResolveProjectAccess(
  c: Context<AppEnv>,
  projectId: string,
  userId: string,
): Promise<{ role: ProjectRole; source: "workspace" | "project" } | "not_found" | null> {
  const cachedProject = c.get("currentProject");
  const cachedAccess = c.get("projectAccess");
  if (cachedProject && cachedAccess && cachedProject.id === projectId) return cachedAccess;

  const db = c.get("db");
  const result = await resolveProjectAccess(db, projectId, userId);

  if (!result) {
    const [proj] = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    return proj ? null : "not_found";
  }

  c.set("projectAccess", { role: result.role, source: result.source });
  c.set("currentProject", result.project);
  return { role: result.role, source: result.source };
}

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * Requires the authenticated user to be a member of the workspace
 * identified by the `workspaceId` route parameter.
 *
 * Caches the membership in context so subsequent middleware or handlers
 * in the same request can skip the DB lookup via `c.get("workspaceMembership")`.
 */
export function requireWorkspaceMember(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return errorResponse(c, "Unauthorized", 401);

    const workspaceId = requireParam(c, "workspaceId");
    const membership = await getOrResolveWorkspaceMembership(c, workspaceId, user.id);
    if (!membership) return errorResponse(c, "Forbidden", 403);

    await next();
  };
}

/**
 * Requires the authenticated user to hold one of the specified roles
 * within the workspace identified by the `workspaceId` route parameter.
 *
 * Caches the membership in context so subsequent middleware or handlers
 * in the same request can skip the DB lookup via `c.get("workspaceMembership")`.
 */
export function requireWorkspaceRole(
  ...allowedRoles: string[]
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return errorResponse(c, "Unauthorized", 401);

    const workspaceId = requireParam(c, "workspaceId");
    const membership = await getOrResolveWorkspaceMembership(c, workspaceId, user.id);
    if (!membership) return errorResponse(c, "Forbidden", 403);
    if (!allowedRoles.includes(membership.role)) return errorResponse(c, "Forbidden", 403);

    await next();
  };
}

/**
 * Requires the authenticated user to have access to the project
 * identified by the `projectId` route parameter.
 *
 * Access is granted if the user is a workspace owner/admin (elevated)
 * or a direct project member.
 *
 * Caches the result in context (`projectAccess` and `currentProject`) so
 * downstream middleware or handlers can skip re-querying via `c.get(...)`.
 */
export function requireProjectAccess(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return errorResponse(c, "Unauthorized", 401);

    const projectId = requireParam(c, "projectId");
    const access = await getOrResolveProjectAccess(c, projectId, user.id);
    if (access === "not_found") return errorResponse(c, "Not found", 404);
    if (!access) return errorResponse(c, "Forbidden", 403);

    await next();
  };
}

/**
 * Requires the authenticated user to hold one of the specified effective
 * roles for the project identified by the `projectId` route parameter.
 *
 * Caches the result in context (`projectAccess` and `currentProject`) so
 * downstream middleware or handlers can skip re-querying via `c.get(...)`.
 */
export function requireProjectRole(
  ...allowedRoles: string[]
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return errorResponse(c, "Unauthorized", 401);

    const projectId = requireParam(c, "projectId");
    const access = await getOrResolveProjectAccess(c, projectId, user.id);
    if (access === "not_found") return errorResponse(c, "Not found", 404);
    if (!access) return errorResponse(c, "Forbidden", 403);
    if (!allowedRoles.includes(access.role)) return errorResponse(c, "Forbidden", 403);

    await next();
  };
}

/**
 * Requires the authenticated user to have access to the project that
 * owns the task identified by the `taskId` route parameter.
 *
 * Uses a single JOIN query (task → project → workspace_member → project_member)
 * instead of 4 sequential queries.
 * Grants access to any project role (admin, member, or viewer).
 *
 * Caches `projectAccess` and `currentProject` in context for downstream use.
 */
export function requireTaskAccess(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return errorResponse(c, "Unauthorized", 401);
    }

    const taskId = requireParam(c, "taskId");
    const db = c.get("db");

    const result = await resolveTaskAccess(db, taskId, user.id);

    if (!result.found) {
      return errorResponse(c, "Not found", 404);
    }

    if (!result.access) {
      return errorResponse(c, "Forbidden", 403);
    }

    c.set("projectAccess", { role: result.access.role, source: result.access.source });
    c.set("currentProject", result.access.project);
    await next();
  };
}

/**
 * Requires the authenticated user to hold one of the specified effective
 * roles for the project that owns the task identified by the `taskId`
 * route parameter.
 *
 * Uses a single JOIN query (task → project → workspace_member → project_member)
 * instead of 4 sequential queries.
 * Use this instead of requireTaskAccess() on mutating endpoints to
 * prevent viewers from modifying tasks.
 *
 * Caches `projectAccess` and `currentProject` in context for downstream use.
 */
export function requireTaskRole(
  ...allowedRoles: string[]
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return errorResponse(c, "Unauthorized", 401);
    }

    const taskId = requireParam(c, "taskId");
    const db = c.get("db");

    const result = await resolveTaskAccess(db, taskId, user.id);

    if (!result.found) {
      return errorResponse(c, "Not found", 404);
    }

    if (!result.access) {
      return errorResponse(c, "Forbidden", 403);
    }

    if (!allowedRoles.includes(result.access.role)) {
      return errorResponse(c, "Forbidden", 403);
    }

    c.set("projectAccess", { role: result.access.role, source: result.access.source });
    c.set("currentProject", result.access.project);
    await next();
  };
}
