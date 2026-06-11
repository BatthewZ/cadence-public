import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import type { Database } from "../../db";
import { project } from "../../db/schema/project";
import { workspaceMember } from "../../db/schema/workspace";
import type { ProjectRole, WorkspaceRole } from "../../shared/types/roles";
import type { AppEnv } from "../env";
import { resolveProjectAccess, resolveTaskAccess } from "../lib/access";
import { canAccessProject, hasScope } from "../lib/api-tokens";
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

    // PAT workspace-scope guard. A token bound to workspace A may never act
    // on workspace B even if its user is also a member of B — the token is
    // the workspace boundary, not the user. We return the same generic 403
    // as the no-membership case so the response shape never reveals the
    // distinction between "wrong token" and "no membership" to a probe.
    const token = c.get("apiToken");
    if (token && token.workspaceId !== workspaceId) {
      return errorResponse(c, "Forbidden", 403);
    }

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

    // PAT workspace-scope guard. See `requireWorkspaceMember` for the why
    // behind the generic 403 (no information disclosure).
    const token = c.get("apiToken");
    if (token && token.workspaceId !== workspaceId) {
      return errorResponse(c, "Forbidden", 403);
    }

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

    // PAT project-scope guard. A token minted with `projectScope: "selected"`
    // only sees the explicit id list; "all" always passes. We delegate the
    // check to `canAccessProject` so the policy logic stays single-sourced
    // in api-tokens.ts (Rule 4: no migrations/adapters, single source of
    // truth). Same generic 403 as the membership-failure path to avoid
    // disclosing scope-list shape to an attacker.
    const token = c.get("apiToken");
    if (token && !canAccessProject(token, projectId)) {
      return errorResponse(c, "Forbidden", 403);
    }

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

    // PAT project-scope guard — see `requireProjectAccess` for rationale.
    const token = c.get("apiToken");
    if (token && !canAccessProject(token, projectId)) {
      return errorResponse(c, "Forbidden", 403);
    }

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

    // PAT project-scope guard. We use the project resolved from the task
    // (the URL only gives us a taskId) so the token's `selected` list must
    // cover the *owning* project. Same generic 403 to keep the response
    // shape uniform with the membership-failure path.
    const token = c.get("apiToken");
    if (token && !canAccessProject(token, result.access.project.id)) {
      return errorResponse(c, "Forbidden", 403);
    }

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

    // PAT project-scope guard — mirrors requireTaskAccess. Applied here too
    // because this guard is the mutating-endpoint variant of the same check
    // and must enforce the token's selected-project list identically.
    const token = c.get("apiToken");
    if (token && !canAccessProject(token, result.access.project.id)) {
      return errorResponse(c, "Forbidden", 403);
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// PAT lockout middleware
// ---------------------------------------------------------------------------

/**
 * Rejects any request that arrived with a Personal Access Token (PAT) with
 * a uniform 403. Mount this on routes that must NEVER be reachable via
 * machine credentials — the canonical case is the PAT-management surface
 * itself, where allowing PAT callers would let a leaked token mint
 * siblings, rotate itself out of the audit window, or enumerate the rest
 * of the workspace's tokens.
 *
 * Why this lives as middleware instead of a per-handler guard: every
 * handler in `api-tokens.handlers.ts` currently calls `rejectPatCaller(c)`
 * as its first line. That pattern is correct but fragile — a future
 * handler that forgets the call silently exposes the surface. Mounting
 * the check once at the route-group level enforces the policy by
 * construction. Per CLAUDE.md Rule 4 (single source of truth), the policy
 * lives here so the routes file does not encode its own copy.
 */
export function rejectPatAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("apiToken")) {
      return errorResponse(c, "API tokens cannot manage other tokens", 403);
    }
    await next();
  };
}

// ---------------------------------------------------------------------------
// Token scope middleware
// ---------------------------------------------------------------------------

/**
 * Enforce a required scope on PAT-authenticated requests. No-op for cookie-
 * authenticated requests, which inherit full user permissions.
 *
 * Why this exists: scope checks must be independent of role checks. A user
 * may legitimately hold workspace-admin role, but a token they mint with
 * only `task:read` must NOT be able to write tasks just because the
 * underlying human can. The middleware enforces `min(token scopes, user
 * role)` (per the design doc) at the route level — the role half is handled
 * by `requireWorkspaceRole` / `requireProjectRole`, and this middleware
 * supplies the scope half.
 *
 * Cookie auth bypass is deliberate: legacy sessions did not have scopes and
 * grandfathering them in at "full" preserves existing behavior. Adding
 * scopes to cookies is a separate, larger conversation.
 *
 * The 403 message names the missing scope by design — for PATs we WANT the
 * caller (an integration developer) to know exactly which scope to request.
 * Unlike anonymous workspace probes there is no enumeration risk: the
 * caller has already proven token possession.
 */
export function requireTokenScope(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.get("apiToken");
    if (token && !hasScope(token, scope)) {
      return errorResponse(c, `Insufficient scope: requires ${scope}`, 403);
    }
    await next();
  };
}

/**
 * Options for `requireWriteScopeForResource`.
 *
 * `resource` is the singular noun the scope grammar uses (e.g. `task`,
 * `project`, `label`). `allowDelete: true` opts the route group into the
 * stricter `<resource>:delete` scope on DELETE requests; without it,
 * DELETE just requires `<resource>:write` like every other mutation. Only
 * `task` and `project` define a separate `:delete` scope in the v1 grammar
 * (per docs/api/api.md scope table) — `allowDelete` exists so callers
 * declare the policy at the route mount and we do not have to bake the
 * grammar into the middleware itself.
 */
export type WriteScopeOptions = { resource: string; allowDelete?: boolean };

/**
 * Auto-apply the correct write scope for a mutating request, based on the
 * HTTP method. Designed to be mounted once per resource at the route group
 * level so individual handlers do not have to repeat scope wiring.
 *
 * Mapping:
 *  - GET / HEAD / OPTIONS → no check (read scopes are wired explicitly via
 *    `requireReadScopeForResource` so opt-in is visible at the route).
 *  - DELETE with `allowDelete: true` → `<resource>:delete`
 *  - DELETE without `allowDelete` → `<resource>:write`
 *  - POST / PUT / PATCH / any other mutation → `<resource>:write`
 *
 * No-op when no PAT is present, so cookie sessions remain unaffected.
 *
 * Why we centralize this: every mutating route would otherwise need a
 * hand-rolled scope check, and the consistency cost of doing 80 of those
 * is a guaranteed bug surface. One mount per resource is auditable in a
 * single grep.
 */
export function requireWriteScopeForResource(
  opts: WriteScopeOptions,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.get("apiToken");
    if (!token) {
      await next();
      return;
    }

    const method = c.req.method.toUpperCase();
    // Safe methods — leave read-scope enforcement to the explicit factory.
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      await next();
      return;
    }

    const scope =
      method === "DELETE" && opts.allowDelete
        ? `${opts.resource}:delete`
        : `${opts.resource}:write`;

    if (!hasScope(token, scope)) {
      return errorResponse(c, `Insufficient scope: requires ${scope}`, 403);
    }

    await next();
  };
}

/**
 * Auto-apply the `<resource>:read` scope check. Mount alongside
 * `requireWriteScopeForResource` at the route group so both reads and
 * writes are scope-gated symmetrically.
 *
 * Like the write factory: no-op on cookie auth, no-op on non-safe methods
 * (those are the write factory's responsibility). Splitting read vs write
 * into two factories keeps each mount focused and makes it explicit at
 * the call site that the route group intends to enforce BOTH directions.
 */
export function requireReadScopeForResource(
  resource: string,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.get("apiToken");
    if (!token) {
      await next();
      return;
    }

    const method = c.req.method.toUpperCase();
    // Only enforce on safe methods — writes are handled by the write factory.
    if (method !== "GET" && method !== "HEAD") {
      await next();
      return;
    }

    const scope = `${resource}:read`;
    if (!hasScope(token, scope)) {
      return errorResponse(c, `Insufficient scope: requires ${scope}`, 403);
    }

    await next();
  };
}
