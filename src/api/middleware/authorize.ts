import type { Column, ColumnBaseConfig, SQL } from "drizzle-orm";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import type { Database } from "../../db";
import type { ApiToken } from "../../db/schema";
import { project } from "../../db/schema/project";
import { workspaceMember } from "../../db/schema/workspace";
import type { ProjectRole, WorkspaceRole } from "../../shared/types/roles";
import type { AppEnv } from "../env";
import { resolveProjectAccess, resolveTaskAccess } from "../lib/access";
import { canAccessProject, hasScope, parseProjectIds } from "../lib/api-tokens";
import { errorResponse } from "../lib/error-response";
import { requireParam } from "../lib/params";
import { loadWorkspacePolicy } from "../lib/workspace-policy";

// ---------------------------------------------------------------------------
// PAT resource-binding policy (single source of truth)
// ---------------------------------------------------------------------------

/**
 * The minimal identity of a project needed to evaluate the PAT binding
 * policy: which project it is, and which workspace owns it. Both halves are
 * required — a token is bound to a workspace AND (optionally) narrowed to a
 * list of projects, so a check that sees only one half cannot decide.
 *
 * Every access resolver in the API already produces exactly this shape
 * (`ProjectAccessResult["project"]`, `c.get("currentProject")`), so call
 * sites never have to run an extra query to satisfy the policy.
 */
export type TokenBoundProject = { id: string; workspaceId: string };

/**
 * Is this Personal Access Token permitted to act on the given project?
 *
 * This is THE definition of PAT resource binding for the whole API. It is a
 * pure predicate so it can be reasoned about and unit-tested in isolation,
 * and so both the middleware factories below and the handlers that resolve
 * access inline enforce byte-identical policy (CLAUDE.md rule 4: one source
 * of truth, no per-route copies that can drift).
 *
 * Two independent constraints, both of which must hold:
 *
 *  1. **Workspace binding.** A token minted in workspace A may never act on
 *     workspace B even when its owning human is a member of both — the token
 *     is the workspace boundary, not the user. This is the invariant
 *     `docs/api/api-tokens.md` states as fact ("it cannot access any resource
 *     in those other workspaces"), and it is what makes "mint one token per
 *     workspace" a real containment boundary rather than advice.
 *  2. **Project selection.** `projectScope: "selected"` narrows the token to
 *     an explicit id list; `"all"` always passes constraint 2. Delegated to
 *     `canAccessProject` so the list-parsing and fail-closed semantics stay
 *     owned by `api-tokens.ts` rather than being re-derived here.
 *
 * Absence of a token is a pass, not a failure: cookie-authenticated requests
 * carry no PAT and must be completely unaffected by this policy. Their
 * authorization is the membership/role check that every caller performs
 * before consulting this function — this policy only ever *narrows* what an
 * already-authorized human could do.
 *
 * Why a project-shaped input rather than a bare id: the routes that motivated
 * this helper (subtasks, comments, task groups) carry no project id in the
 * URL at all. They discover the owning project by walking the parent chain,
 * and the workspace id comes back on the same row — so passing the resolved
 * project keeps the check free of extra round-trips and makes it impossible
 * to enforce only half the policy by accident.
 */
export function tokenAllowsProject(
  token: ApiToken | null | undefined,
  proj: TokenBoundProject,
): boolean {
  if (!token) return true;
  if (token.workspaceId !== proj.workspaceId) return false;
  return canAccessProject(token, proj.id);
}

/**
 * Is this Personal Access Token permitted to act on the given workspace?
 *
 * The workspace half of `tokenAllowsProject`, used by the workspace-level
 * middleware where no project is in play. Kept module-private: callers that
 * hold a project must go through `tokenAllowsProject` so they cannot
 * accidentally enforce only the workspace half and skip project selection.
 */
function tokenAllowsWorkspace(
  token: ApiToken | null | undefined,
  workspaceId: string,
): boolean {
  if (!token) return true;
  return token.workspaceId === workspaceId;
}

/**
 * Enforce {@link tokenAllowsProject} for the current request.
 *
 * Returns a ready-to-return `403` response when the request's PAT is not
 * permitted to touch `proj`, or `null` when the request may proceed (which
 * includes every cookie-authenticated request). Callers use it as:
 *
 * ```ts
 * const denied = enforceTokenProjectBinding(c, accessResult.project);
 * if (denied) return denied;
 * ```
 *
 * The response is the same bare `Forbidden` 403 that the membership and role
 * failures return, deliberately. A distinct status or message would tell a
 * probe holding a stolen token whether a given project merely lies outside
 * its selected list (project exists, human is a member) versus being
 * genuinely unreachable — which is exactly the map an attacker needs to
 * enumerate the token's shape and the workspace's project graph. Uniformity
 * is the security property here; do not "improve" this message.
 *
 * Handlers must call this AFTER their own membership/role check, mirroring
 * the middleware order below, so a caller who fails both checks is denied for
 * the human reason first and no PAT-specific signal is emitted at all.
 */
export function enforceTokenProjectBinding(
  c: Context<AppEnv>,
  proj: TokenBoundProject,
): Response | null {
  if (tokenAllowsProject(c.get("apiToken"), proj)) return null;
  return errorResponse(c, "Forbidden", 403);
}

/**
 * The set of project ids this token is narrowed to, or `null` when it is not
 * narrowed at all.
 *
 * `tokenAllowsProject` answers "may this token touch THIS project?" — the
 * right question when a request names one project. Workspace-level routes ask
 * the *inverse*: they read across every project in the workspace at once
 * (search, dashboards, activity, labels, the workspace task-group list) and so
 * need the policy in enumerable form, to push into the SQL `WHERE` clause
 * rather than to test row by row.
 *
 * Return values and why each one is what it is:
 *
 *  - `null` — **unrestricted**. Returned for a cookie session (no token at
 *    all) and for a `projectScope: "all"` token. `null` rather than "every id
 *    in the workspace" because the caller must be able to distinguish "add no
 *    filter" from "filter to this list", and enumerating the workspace's
 *    projects just to build a no-op filter would be both a wasted query and a
 *    correctness trap the first time a project is created mid-request.
 *  - `string[]` — the explicit `selected` list. May legitimately be **empty**
 *    (a token narrowed to nothing, or one whose `projectIds` column is absent
 *    or corrupt): `parseProjectIds` already fails closed to `[]`, and an empty
 *    allow-list must mean "sees nothing", never "sees everything".
 *  - `[]` for any *unknown* `projectScope` value, mirroring `canAccessProject`'s
 *    fail-closed default so a row written by a future schema cannot over-grant.
 *
 * This is an enumeration of the same policy `canAccessProject` decides, not a
 * second policy (CLAUDE.md rule 4). The two are held in agreement mechanically
 * by the `tokenProjectAllowList ⇔ tokenAllowsProject` equivalence test in
 * `authorize.test.ts`, which asserts for every scope mode that
 * `tokenAllowsProject(t, p)` equals `list === null || list.includes(p.id)`.
 * If you change either one, that test is what tells you the other drifted.
 *
 * ## PRECONDITION: this is the PROJECT half only
 *
 * `tokenAllowsProject` enforces TWO constraints — workspace binding and project
 * selection. This function enforces only the second. It never reads
 * `token.workspaceId`, so the equivalence above holds **only for projects in
 * the token's own workspace**: for a token bound to workspace B and a project
 * in workspace A, this list says "allowed" (`projectScope: "all"` ⇒ `null`)
 * while `tokenAllowsProject` correctly says "denied".
 *
 * Every caller must therefore already have established the workspace half —
 * either by sitting behind `requireWorkspaceMember` / `requireWorkspaceRole`
 * (which is why the workspace-level routes may use this safely), or by pairing
 * it with {@link tokenWorkspaceScopeFilter} in the same query. A route that
 * uses this with no workspace constraint at all is a cross-tenant leak; that
 * is not a hypothetical, it is exactly the shape of the `/notifications` bug
 * this policy was extended to cover.
 */
export function tokenProjectAllowList(
  token: ApiToken | null | undefined,
): string[] | null {
  if (!token) return null;
  if (token.projectScope === "all") return null;
  if (token.projectScope === "selected") return parseProjectIds(token.projectIds);
  return [];
}

/**
 * A Drizzle `WHERE` fragment restricting `projectIdColumn` to the projects the
 * request's PAT may see, or `undefined` when the request is unrestricted.
 *
 * Drop it straight into an existing `and(...)`: Drizzle discards `undefined`
 * operands, so an unrestricted request (every cookie session, and every
 * `projectScope: "all"` token) produces **byte-identical SQL to before this
 * policy existed**. That is the property that keeps the app's main read
 * endpoints — search, dashboards, activity — untouched for humans; a filter
 * that fired for cookie sessions would empty the entire UI, which is a far
 * worse outcome than the leak it is closing.
 *
 * The empty allow-list is compiled to a literal `1 = 0` instead of
 * `inArray(col, [])`. Drizzle's behaviour for an empty `inArray` has changed
 * across releases (throw in some versions, `false` in others), and "narrowed
 * to nothing" is precisely the case where a silent no-op filter would return
 * the whole workspace. Writing the impossible predicate ourselves makes the
 * fail-closed semantics independent of the ORM version.
 *
 * Pass the column that identifies the OWNING project of each row — usually
 * `project.id`, or `task.projectId` / `label.projectId` when the query does
 * not join `project`.
 *
 * Carries the same precondition as {@link tokenProjectAllowList}: this is the
 * PROJECT half only. Use it on a route already behind a workspace guard, or
 * pair it with {@link tokenWorkspaceScopeFilter}.
 */
export function tokenProjectScopeFilter(
  c: Context<AppEnv>,
  projectIdColumn: Column<ColumnBaseConfig<"string", string>>,
): SQL | undefined {
  const allowed = tokenProjectAllowList(c.get("apiToken"));
  if (allowed === null) return undefined;
  if (allowed.length === 0) return sql`1 = 0`;
  return inArray(projectIdColumn, allowed);
}

/**
 * A Drizzle `WHERE` fragment restricting `workspaceIdColumn` to the workspace
 * the request's PAT is bound to, or `undefined` for a cookie session.
 *
 * The SQL form of the workspace half of {@link tokenAllowsProject} — the half
 * `requireWorkspaceMember` / `requireWorkspaceRole` normally supply by
 * comparing the `:workspaceId` route parameter. It exists for the routes that
 * have NO workspace in their URL and therefore cannot mount those guards at
 * all: the notification feed is keyed by user, not by workspace, so a token
 * bound to workspace A would otherwise read rows belonging to every other
 * workspace its owning human is a member of.
 *
 * Unlike the project half there is no "narrowed vs. not" distinction to make:
 * every PAT is bound to exactly one workspace at mint time, so any token at
 * all restricts, and only the absence of a token is a no-op. That asymmetry is
 * why the two filters are separate functions rather than one — collapsing them
 * would invite a caller to apply "the filter" and get only one half.
 */
export function tokenWorkspaceScopeFilter(
  c: Context<AppEnv>,
  workspaceIdColumn: Column<ColumnBaseConfig<"string", string>>,
): SQL | undefined {
  const token = c.get("apiToken");
  if (!token) return undefined;
  return eq(workspaceIdColumn, token.workspaceId);
}

/**
 * Reject a project-narrowed PAT from an operation whose result is inherently
 * the WHOLE workspace.
 *
 * Returns a `403` when the request carries a `projectScope: "selected"` token,
 * and `null` otherwise — so cookie sessions and `all`-scope tokens are
 * unaffected. The canonical caller is the workspace export
 * (`GET /workspaces/:id/export`), and the reasoning is spelled out at that
 * call site: some responses cannot be meaningfully narrowed, and for those the
 * honest answer is a refusal rather than a partial document that claims in its
 * own envelope to be a complete workspace archive.
 *
 * Use this ONLY where partial output would be wrong or misleading. Every
 * endpoint that can simply return fewer rows should filter with
 * {@link tokenProjectScopeFilter} instead — a narrowed token seeing less is a
 * better developer experience than a narrowed token seeing an error, and it
 * keeps the failure mode of a mis-scoped token obvious (empty results) rather
 * than indistinguishable from a permissions misconfiguration.
 */
export function enforceTokenWorkspaceWideAccess(
  c: Context<AppEnv>,
): Response | null {
  if (tokenProjectAllowList(c.get("apiToken")) === null) return null;
  return errorResponse(c, "Forbidden", 403);
}

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
 *
 * The resolved `project` (id + owning workspace id) is returned alongside the
 * role because the caller needs both halves to evaluate the PAT binding
 * policy — see {@link tokenAllowsProject}. Returning it here rather than
 * re-reading `c.get("currentProject")` at each call site keeps the cached and
 * uncached paths yielding the same shape.
 */
async function getOrResolveProjectAccess(
  c: Context<AppEnv>,
  projectId: string,
  userId: string,
): Promise<
  | { role: ProjectRole; source: "workspace" | "project"; project: TokenBoundProject }
  | "not_found"
  | null
> {
  const cachedProject = c.get("currentProject");
  const cachedAccess = c.get("projectAccess");
  if (cachedProject && cachedAccess && cachedProject.id === projectId) {
    return { ...cachedAccess, project: cachedProject };
  }

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
  return { role: result.role, source: result.source, project: result.project };
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
 *
 * **This guard can only enforce the WORKSPACE half of the PAT policy.** It
 * sees a `:workspaceId` and nothing else, so it cannot know which projects a
 * given response will end up containing. A handler mounted behind it that
 * reads or writes project-owned rows (search, dashboards, activity, labels,
 * the workspace task-group list, webhooks carrying a `projectId`) MUST apply
 * {@link tokenProjectScopeFilter} / {@link enforceTokenProjectBinding}
 * itself — otherwise a token narrowed to one project is handed the whole
 * workspace, which is exactly the hole this comment exists to prevent
 * reopening.
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
    if (!tokenAllowsWorkspace(c.get("apiToken"), workspaceId)) {
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
 *
 * Like {@link requireWorkspaceMember}, this enforces only the workspace half
 * of the PAT policy — a higher required role is not a substitute for project
 * selection. Handlers behind it that touch project-owned rows must apply the
 * project half themselves.
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
    if (!tokenAllowsWorkspace(c.get("apiToken"), workspaceId)) {
      return errorResponse(c, "Forbidden", 403);
    }

    await next();
  };
}

/**
 * Requires that the authenticated user may bring a NEW project into existence
 * in the workspace this request targets.
 *
 * This is the single source of truth for the `allowMemberProjectCreation`
 * policy (`src/shared/types/workspace-policy.ts`). Owners and admins always
 * pass; a `member` passes only while the workspace leaves member creation on,
 * which is the default.
 *
 * ## Why it guards two routes, not one
 *
 * `POST /workspaces/:workspaceId/projects` is the obvious path. The
 * non-obvious one is `POST /projects/:projectId/duplicate`, and skipping it
 * would make the whole toggle decorative: `createProject` adds its caller as
 * project **admin**, so every member who created a project before the setting
 * was turned off still satisfies `requireProjectRole("admin")` on it and could
 * keep minting projects by duplicating that one. A policy about how many
 * projects a member may bring into existence has to be enforced on every path
 * that brings one into existence.
 *
 * Workspace import (`POST /workspaces/:workspaceId/import`) also creates
 * projects and is deliberately NOT listed here — it is already owner/admin
 * only, so this policy could never widen or narrow it.
 *
 * ## Why the workspace id has two sources
 *
 * The two mount points name the target workspace differently: the create route
 * carries it as a path parameter, while the duplicate route identifies a
 * project and must be told which workspace owns it. `requireProjectRole` runs
 * first there and caches exactly that (`currentProject`), so the fallback is a
 * read of an already-resolved value rather than an extra query. Resolving both
 * shapes here — instead of exporting two middlewares, or asking each route to
 * pass the id in — is what keeps the rule itself written once.
 *
 * ## Why this 403 explains itself
 *
 * The membership and PAT guards in this file answer a deliberately generic
 * "Forbidden" so a probe cannot distinguish "wrong token" from "no
 * membership". That reasoning does not transfer: everyone who reaches this
 * check has already proved workspace membership, and the policy they are
 * hitting is workspace configuration their own admins set and that the
 * settings UI shows them. There is nothing left to disclose, and a bare 403
 * would send integrations hunting for a scope or membership bug instead of
 * reading the setting.
 */
export function requireProjectCreation(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return errorResponse(c, "Unauthorized", 401);

    const workspaceId =
      c.req.param("workspaceId") ?? c.get("currentProject")?.workspaceId;

    // Not a client error: it means this middleware was mounted on a route that
    // supplies neither a `workspaceId` parameter nor a prior project-access
    // guard. Failing loudly beats silently allowing the request through a
    // policy check that had nothing to check.
    if (!workspaceId) {
      throw new Error(
        "requireProjectCreation: no workspaceId parameter and no resolved project on the request — mount it after a project-access guard, or on a route with a :workspaceId parameter",
      );
    }

    const membership = await getOrResolveWorkspaceMembership(c, workspaceId, user.id);
    if (!membership) return errorResponse(c, "Forbidden", 403);

    // Admins are never subject to the toggle, so the common case costs no
    // extra query — and turning the setting off can never lock out the people
    // who would have to turn it back on.
    if (membership.role === "owner" || membership.role === "admin") {
      await next();
      return;
    }

    const policy = await loadWorkspacePolicy(c.get("db"), workspaceId);
    if (!policy.allowMemberProjectCreation) {
      return errorResponse(
        c,
        "Only workspace owners and admins can create projects in this workspace",
        403,
      );
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

    // PAT binding guard — workspace binding + selected-project list, defined
    // once in `tokenAllowsProject` and shared with the handlers that resolve
    // project access inline (Rule 4: no per-route copies of the policy).
    // Same generic 403 as the membership-failure path to avoid disclosing
    // scope-list shape to an attacker.
    const denied = enforceTokenProjectBinding(c, access.project);
    if (denied) return denied;

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

    // PAT binding guard — see `requireProjectAccess` for rationale.
    const denied = enforceTokenProjectBinding(c, access.project);
    if (denied) return denied;

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

    // PAT binding guard. We use the project resolved from the task (the URL
    // only gives us a taskId) so the token's workspace binding and `selected`
    // list must both cover the *owning* project. Same generic 403 to keep the
    // response shape uniform with the membership-failure path.
    const denied = enforceTokenProjectBinding(c, result.access.project);
    if (denied) return denied;

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

    // PAT binding guard — mirrors requireTaskAccess. Applied here too because
    // this guard is the mutating-endpoint variant of the same check and must
    // enforce the token's binding identically.
    const denied = enforceTokenProjectBinding(c, result.access.project);
    if (denied) return denied;

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
 *
 * @param message Optional 403 body. The default describes the token-management
 *   surface this middleware was written for, and stayed accurate only while
 *   that was its sole mount. It has since spread to routes where it is simply
 *   false: a caller refused on `POST /api/invitations/accept` was being told
 *   "API tokens cannot manage other tokens", which names the wrong resource and
 *   sends an integration developer looking for a scope that does not exist. The
 *   policy is one rule — a machine credential must not obtain a second
 *   credential — but the credential differs per mount, so the wording has to.
 *   Optional, and defaulted, so existing mounts and their tests are unchanged.
 */
export function rejectPatAuth(
  message = "API tokens cannot manage other tokens",
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("apiToken")) {
      return errorResponse(c, message, 403);
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
