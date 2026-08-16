import { and, count, eq, exists, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../../db";
import { user as userTable } from "../../../db/schema/auth";
import { project, projectMember } from "../../../db/schema/project";
import { task } from "../../../db/schema/task";
import { team, teamMember } from "../../../db/schema/team";
import { workspace, workspaceMember } from "../../../db/schema/workspace";
import {
  createWorkspaceSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from "../../../shared/schemas/workspace";
import type { WorkspaceRole } from "../../../shared/types/roles";
import { resolveWorkspacePolicy } from "../../../shared/types/workspace-policy";
import type { AppEnv } from "../../env";
import { errorResponse, throwWithContext } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import {
  buildMemberEventData,
  fireWebhookEvent,
  resolveUser,
} from "../../lib/webhook-payloads";
import { mayGrantAdmin, outranks } from "../../lib/workspace-roles";
import {
  enforceTokenWorkspaceWideAccess,
  tokenWorkspaceScopeFilter,
} from "../../middleware/authorize";

const DUPLICATE_SLUG_ERROR = "You already have a workspace with that URL";

export async function createWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const body = validJson(c, createWorkspaceSchema);

  const id = crypto.randomUUID();
  const now = new Date();

  const newWorkspace = {
    id,
    name: body.name,
    slug: body.slug,
    description: body.description ?? null,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.batch([
      db.insert(workspace).values(newWorkspace),
      db.insert(workspaceMember).values({
        id: crypto.randomUUID(),
        workspaceId: id,
        userId: user.id,
        role: "owner",
        joinedAt: now,
      }),
    ] as const);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      return errorResponse(c, DUPLICATE_SLUG_ERROR, 409);
    }
    throwWithContext(error, "createWorkspace");
  }

  return c.json({ workspace: newWorkspace }, 201);
}

export async function listWorkspaces(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  // A PAT is bound to exactly one workspace at mint time, and this route is
  // the one place that answered without honouring that binding: it selects by
  // the USER, so a token bound to workspace A returned the name, slug and
  // owner of every other workspace its holder happened to belong to — other
  // tenants' names, to a credential scoped away from them.
  //
  // `tokenWorkspaceScopeFilter` is a no-op for cookie sessions (they have no
  // token), so a browser still sees the full switcher. It restricts for ANY
  // token including `projectScope: "all"`, because this is the workspace
  // binding rather than project scope — the two are separate controls.
  const workspaceBinding = tokenWorkspaceScopeFilter(c, workspaceMember.workspaceId);

  // Batch both queries in a single DB round-trip:
  // 1. Fetch workspaces the user belongs to
  // 2. Count members for every workspace the user belongs to (via subquery, no dependency on query 1)
  //
  // Query 2 is deliberately NOT given the binding, and that is safe only
  // because of how its result is consumed: the counts are loaded into a map
  // that is read exclusively by id from query 1's already-filtered rows, so an
  // unbound count can never reach the response. If that lookup is ever
  // replaced by something that iterates `memberCounts` directly, this query
  // must be filtered too — it currently returns a row per workspace the USER
  // belongs to, not per workspace the TOKEN may see.
  const [results, memberCounts] = await db.batch([
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        theme: workspace.theme,
        role: workspaceMember.role,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(and(eq(workspaceMember.userId, user.id), workspaceBinding)),
    db
      .select({
        workspaceId: workspaceMember.workspaceId,
        count: count(),
      })
      .from(workspaceMember)
      .where(
        sql`${workspaceMember.workspaceId} IN (SELECT ${workspaceMember.workspaceId} FROM ${workspaceMember} WHERE ${workspaceMember.userId} = ${user.id})`,
      )
      .groupBy(workspaceMember.workspaceId),
  ] as const);

  if (results.length === 0) {
    return c.json({ workspaces: [] });
  }

  const memberCountMap = new Map(
    memberCounts.map((mc) => [mc.workspaceId, mc.count]),
  );

  const workspaces = results.map((r) => ({
    ...r,
    memberCount: memberCountMap.get(r.id) ?? 0,
  }));

  return c.json({ workspaces });
}

export async function getWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  // Batch workspace fetch + member count in a single DB round-trip
  const [workspaceResult, memberCountResult] = await db.batch([
    db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db
      .select({ count: count() })
      .from(workspaceMember)
      .where(eq(workspaceMember.workspaceId, workspaceId)),
  ] as const);

  const found = workspaceResult[0];
  if (!found) {
    return errorResponse(c, "Workspace not found", 404);
  }

  return c.json({
    workspace: {
      ...found,
      // The wire format is the RESOLVED policy object, never the raw column.
      // Two reasons this conversion belongs here rather than on the client:
      // the client would otherwise have to own a second copy of the defaults
      // (and could drift from the server's), and it would have to distinguish
      // "policy is null" from "policy is loading" — a distinction that has bitten
      // this codebase before, because an absent value is indistinguishable from
      // a restrictive one. Shipping a complete object means every consumer reads
      // a plain boolean and nobody writes `?? true` at a call site.
      policy: resolveWorkspacePolicy(found.policy),
      memberCount: memberCountResult[0].count,
    },
  });
}

export async function updateWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, updateWorkspaceSchema);

  const now = new Date();

  // `policy` is the one field that MERGES rather than replaces, so it cannot
  // ride along in the `...body` spread — the rest of the body are scalar
  // columns whose new value is exactly what was sent.
  const { policy: policyPatch, ...scalarFields } = body;

  let updated: typeof workspace.$inferSelect | undefined;

  try {
    const [row] = await db
      .update(workspace)
      .set({
        ...scalarFields,
        // Merge in SQL via RFC 7396 (`json_patch`), not read-modify-write in
        // the handler. Two settings tabs saving different toggles at the same
        // time would otherwise race, and the loser's change would vanish with
        // no error shown — the worst failure mode a settings screen has,
        // because the UI confirms a save that did not survive. `coalesce`
        // handles the never-configured workspace, whose column is NULL.
        //
        // The patch object is bound as a parameter rather than interpolated,
        // so a policy key can never reach the SQL text itself.
        ...(policyPatch
          ? {
              policy: sql`json_patch(coalesce(${workspace.policy}, '{}'), ${JSON.stringify(policyPatch)})`,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(workspace.id, workspaceId))
      .returning();
    updated = row;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      return errorResponse(c, DUPLICATE_SLUG_ERROR, 409);
    }
    throwWithContext(error, "updateWorkspace");
  }

  if (!updated) {
    return errorResponse(c, "Workspace not found", 404);
  }

  // Same wire format as `getWorkspace` — a resolved policy object, so the
  // client can write the mutation's response straight into its cache without
  // the two endpoints disagreeing about the shape of a workspace.
  return c.json({
    workspace: { ...updated, policy: resolveWorkspacePolicy(updated.policy) },
  });
}

export async function deleteWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  // Refuse a project-narrowed token, for the same reason the workspace export
  // does — and the asymmetry is why this is not optional. Export is a READ of
  // the whole workspace and already answers 403 here; this is the DESTRUCTION
  // of the whole workspace, including every project the token was never
  // selected for. A token that may not read P2 must not be able to delete it.
  //
  // Refusal rather than a filter: there is no partial form of this operation.
  // Deleting only the token's selected projects would not be a smaller version
  // of "delete the workspace", it would be a different operation the caller
  // did not ask for, and it would leave the workspace row behind.
  const denied = enforceTokenWorkspaceWideAccess(c);
  if (denied) return denied;

  // Must delete tasks before workspace because task.taskGroupId has
  // onDelete:"restrict", which blocks cascade deletion through
  // workspace → project → task_group when tasks still reference those groups.
  const projectIds = db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.workspaceId, workspaceId));

  await db.batch([
    db.delete(task).where(inArray(task.projectId, projectIds)),
    db.delete(workspace).where(eq(workspace.id, workspaceId)),
  ] as const);

  return c.json({ ok: true });
}

export async function listMembers(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  const rows = await db
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      joinedAt: workspaceMember.joinedAt,
      userName: userTable.name,
      userEmail: userTable.email,
      userImage: userTable.image,
    })
    .from(workspaceMember)
    .innerJoin(userTable, eq(workspaceMember.userId, userTable.id))
    .where(eq(workspaceMember.workspaceId, workspaceId));

  const members = rows.map((r) => ({
    id: r.memberId,
    userId: r.userId,
    role: r.role,
    joinedAt: r.joinedAt,
    user: {
      id: r.userId,
      name: r.userName,
      email: r.userEmail,
      image: r.userImage,
    },
  }));

  return c.json({ members });
}

// ---------------------------------------------------------------------------
// Member governance helpers
// ---------------------------------------------------------------------------
//
// The hierarchy itself (`outranks`, `mayGrantAdmin`) lives in
// `api/lib/workspace-roles.ts` because `createInvitation` is a second door onto
// the same end state and must apply the identical rule. Only the *data access*
// for these two handlers lives here.

/**
 * Load the acting user's and the target user's workspace memberships in a
 * single round-trip.
 *
 * Why the actor's row is read from the database rather than taken from
 * `c.get("workspaceMembership")` (which `requireWorkspaceRole` populates):
 * the context value is a *cache* filled by middleware, so trusting it would
 * make the hierarchy rule depend on middleware ordering staying correct
 * forever. Authorization decisions that can revoke another person's access
 * should be derived from the same source of truth they protect. Reading both
 * rows in one `IN (…)` query means this costs no extra round-trip over the
 * single-target lookup it replaced.
 *
 * When actor and target are the same user, both fields point at the one row.
 */
async function loadActorAndTarget(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
): Promise<{
  actor: { userId: string; role: WorkspaceRole } | undefined;
  target: { userId: string; role: WorkspaceRole } | undefined;
}> {
  const rows = await db
    .select({ userId: workspaceMember.userId, role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        inArray(workspaceMember.userId, [actorUserId, targetUserId]),
      ),
    );

  return {
    actor: rows.find((r) => r.userId === actorUserId),
    target: rows.find((r) => r.userId === targetUserId),
  };
}

export async function updateMemberRole(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, userId: targetUserId } = requireParams(c, "workspaceId", "userId");
  const { role } = validJson(c, updateMemberRoleSchema);
  const actingUser = c.get("user")!;

  const { actor, target } = await loadActorAndTarget(
    db,
    workspaceId,
    actingUser.id,
    targetUserId,
  );

  // Fail closed FIRST, before any branch that could describe the target. A
  // caller with no membership row must learn nothing about this workspace's
  // roster — answering "Cannot change the owner's role" would confirm to a
  // non-member which account owns it. Unreachable behind
  // `requireWorkspaceRole`, but this handler must not depend on a middleware
  // mount for a decision this consequential.
  if (!actor) {
    return errorResponse(c, "Forbidden", 403);
  }

  if (!target) {
    return errorResponse(c, "Member not found", 404);
  }

  if (target.role === "owner") {
    return errorResponse(c, "Cannot change the owner's role", 403);
  }

  // Rank hierarchy: only someone strictly senior to the target may change
  // their role. In practice this means admins manage plain members and only
  // the owner may demote an admin.
  if (!outranks(actor, target)) {
    return errorResponse(
      c,
      target.role === "admin"
        ? "Only the workspace owner can change an admin's role"
        : "You do not have permission to change this member's role",
      403,
    );
  }

  // Granting `admin` is owner-only, symmetrically with revoking it — see
  // `mayGrantAdmin` in `api/lib/workspace-roles.ts` for why a one-sided rule
  // would only relocate the hazard, and why `createInvitation` shares it.
  //
  // Deliberately AFTER the rank comparison, even though it reads like the more
  // specific check. Both orders are equally safe — the only caller who can
  // pass `outranks` without owner rank is an admin acting on a plain member,
  // which this then refuses — but they differ in which reason the caller is
  // told. The members UI pre-selects the target's CURRENT role, so an admin
  // who opens the role dialog on a peer admin and submits it unchanged sends
  // `role: "admin"`. Checked first, that caller would be told they may not
  // *grant* admin, when the constraint actually binding on them is that they
  // may not touch an admin at all. Checked here, every caller is told the rule
  // that is really stopping them.
  if (role === "admin" && !mayGrantAdmin(actor)) {
    return errorResponse(
      c,
      "Only the workspace owner can grant the admin role",
      403,
    );
  }

  const oldRole = target.role;

  // `role = oldRole` pins the write to the row the rank check was made
  // against. Without it the hierarchy is advisory rather than enforced: if
  // the owner promotes the target to admin between our read and this write,
  // an admin's in-flight request lands on a row that now outranks what they
  // were allowed to touch. Zero rows updated means the role moved under us,
  // which is a conflict to report — not a silent no-op returning 200.
  const [updated] = await db
    .update(workspaceMember)
    .set({ role })
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, targetUserId),
        eq(workspaceMember.role, oldRole),
      ),
    )
    .returning();

  if (!updated) {
    return errorResponse(
      c,
      "This member's role changed while you were editing. Please retry.",
      409,
    );
  }

  // Non-blocking webhook dispatch for workspace.member_role_changed
  const roleChangedUser = await resolveUser(db, targetUserId);
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: actingUser.id }, [
    { event: "workspace.member_role_changed", data: buildMemberEventData({ userId: targetUserId, workspaceId }, role, roleChangedUser), changes: { role: { from: oldRole, to: role } } },
  ]);

  return c.json({ member: updated });
}

/**
 * Remove a user from a workspace, revoking every access grant that workspace
 * membership was the premise for.
 *
 * ## Why this deletes more than the `workspace_member` row
 *
 * Deleting only the membership row made offboarding cosmetic. The removed
 * user disappeared from the members list and their workspace list went
 * empty — so the product *said* they were gone — while every
 * `project_member` row they held kept granting full read, write and CSV
 * export on those projects, and every `team_member` row kept listing them in
 * the workspace's teams and member counts. The foreign keys do not help:
 * `project_member.userId` and `team_member.userId` cascade on *user*
 * deletion, never on losing workspace membership.
 *
 * The write half is what makes this urgent rather than untidy — a removed
 * contractor could keep creating and editing tasks indefinitely.
 *
 * All three deletes go in one `db.batch`, which D1 executes as a single
 * implicit transaction: a partial revocation (workspace row gone, project
 * rows surviving) is exactly the dangerous state we are eliminating, so it
 * must not be reachable through a mid-sequence failure either. The subquery
 * scoping (`projectId IN (SELECT … WHERE workspaceId = ?)`) is what keeps
 * the blast radius to this workspace — the same user's memberships in other
 * workspaces are untouched.
 *
 * Defence in depth for rows that predate this fix, or that some future path
 * orphans anyway, lives in `resolveProjectAccess` — see `api/lib/access.ts`.
 */
export async function removeMember(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, userId: targetUserId } = requireParams(c, "workspaceId", "userId");
  const currentUser = c.get("user")!;

  // Refuse a project-narrowed token. This handler's cascade deletes the
  // target's `project_member` rows across EVERY project in the workspace
  // (see the batch below), so a token selected for P1 alone would otherwise
  // write into P2..Pn — projects it cannot even read.
  //
  // Refusal, not a filter, and the batch below is the reason: narrowing the
  // cascade to the token's projects would revoke some project rows while
  // leaving the workspace membership and the rest intact. That is precisely
  // the half-revoked state finding 01 was fixed to eliminate, so filtering
  // here would reintroduce the original vulnerability in a new place.
  //
  // Placed before the roster reads deliberately. It answers the same
  // "Forbidden" 403 as the fail-closed non-member branch below, so it adds no
  // membership-enumeration oracle of the kind finding 21 closed.
  const denied = enforceTokenWorkspaceWideAccess(c);
  if (denied) return denied;

  const { actor, target } = await loadActorAndTarget(
    db,
    workspaceId,
    currentUser.id,
    targetUserId,
  );

  // Fail closed FIRST — a caller with no membership row must learn nothing
  // about this workspace's roster, not even which account owns it. See the
  // matching note in `updateMemberRole`.
  if (!actor) {
    return errorResponse(c, "Forbidden", 403);
  }

  if (!target) {
    return errorResponse(c, "Member not found", 404);
  }

  // Self-removal is checked BEFORE the owner guard. Both are true when an
  // owner targets themselves, and "Cannot remove the workspace owner" is a
  // confusing thing to read about your own row — the accurate reason is that
  // nobody may remove themselves here (there is no leave-workspace action
  // yet). The owner is still protected: the guard below catches every other
  // caller, so the workspace can never be orphaned.
  if (targetUserId === currentUser.id) {
    return errorResponse(c, "Cannot remove yourself from the workspace", 400);
  }

  if (target.role === "owner") {
    return errorResponse(c, "Cannot remove the workspace owner", 403);
  }

  // Rank hierarchy — see `outranks`. Admins may remove plain members; only
  // the owner may remove an admin.
  if (!outranks(actor, target)) {
    return errorResponse(
      c,
      target.role === "admin"
        ? "Only the workspace owner can remove an admin"
        : "You do not have permission to remove this member",
      403,
    );
  }

  // Subqueries, not fetched id lists: the projects and teams of a workspace
  // are unbounded, and D1 has a hard limit on bound parameters per statement.
  const workspaceProjectIds = db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.workspaceId, workspaceId));

  const workspaceTeamIds = db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.workspaceId, workspaceId));

  // Pins all three statements to the role the rank check was made against,
  // so the hierarchy is enforced at write time rather than merely advised.
  // If the owner promotes the target to admin between our read and this
  // batch, an admin's in-flight removal would otherwise land on a row that
  // now outranks them. Every statement carries the SAME condition so the
  // batch stays all-or-nothing — guarding only the `workspace_member` delete
  // would trade the race for a half-revoked user (project rows gone,
  // membership intact), which is the very state this handler exists to
  // eliminate. The membership delete re-states the predicate directly
  // instead of via EXISTS because it targets that row itself.
  //
  // Statement ORDER is a correctness constraint, not formatting. D1 runs a
  // batch as one implicit transaction with the statements in sequence, so the
  // `workspace_member` delete must stay LAST: hoist it and the two `EXISTS`
  // guards below it would be evaluating a row this same batch had already
  // removed, every guard would read false, and the cascade would silently
  // no-op — leaving exactly the half-revoked user described above, with the
  // membership row gone. Do not reorder this array.
  const roleUnchanged = exists(
    db
      .select({ ok: sql`1` })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, targetUserId),
          eq(workspaceMember.role, target.role),
        ),
      ),
  );

  const [, , removedRows] = await db.batch([
    db
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.userId, targetUserId),
          inArray(projectMember.projectId, workspaceProjectIds),
          roleUnchanged,
        ),
      ),
    db
      .delete(teamMember)
      .where(
        and(
          eq(teamMember.userId, targetUserId),
          inArray(teamMember.teamId, workspaceTeamIds),
          roleUnchanged,
        ),
      ),
    db
      .delete(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, targetUserId),
          eq(workspaceMember.role, target.role),
        ),
      )
      .returning({ id: workspaceMember.id }),
  ] as const);

  // Nothing deleted means the role moved under us and every statement
  // no-opped together. Report the conflict rather than returning `ok: true`
  // for a removal that did not happen.
  if (removedRows.length === 0) {
    return errorResponse(
      c,
      "This member's role changed while you were removing them. Please retry.",
      409,
    );
  }

  // Non-blocking webhook dispatch for workspace.member_removed
  const removedUser = await resolveUser(db, targetUserId);
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: currentUser.id }, [
    { event: "workspace.member_removed", data: buildMemberEventData({ userId: targetUserId, workspaceId }, target.role, removedUser) },
  ]);

  return c.json({ ok: true });
}
