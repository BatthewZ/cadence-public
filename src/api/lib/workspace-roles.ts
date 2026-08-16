import type { WorkspaceRole } from "../../shared/types/roles";

/**
 * The workspace role hierarchy, and the two questions the API asks of it.
 *
 * ## Why this is a module rather than two private helpers
 *
 * Member governance is decided in two different route files — `updateMemberRole`
 * and `removeMember` in `routes/workspaces/workspaces.handlers.ts`, and
 * `createInvitation` in `routes/invitations/invitations.handlers.ts` — and they
 * are two doors onto the same end state. An admin blocked from *promoting* a
 * member to admin can reach an identical workspace by *inviting* a new admin
 * instead. While the rank table lived as a private declaration inside
 * `workspaces.handlers.ts`, the invitation route had to restate the rule as a
 * hand-written role equality, and a rule stated twice is a rule that eventually
 * disagrees with itself — with the copy nobody is looking at being the one that
 * drifts. One module, one statement of the hierarchy, per CLAUDE.md rule 4.
 *
 * This is server-side *enforcement*. `src/web/pages/WorkspaceSettings` mirrors
 * the same rules to decide which menu items to render; that mirror is an
 * affordance, not an authority, and must never become the thing this file
 * defers to.
 */

/**
 * Ordinal rank of each workspace role, used to compare the *actor* against
 * the *target* of a member-management action.
 *
 * Why this exists: `requireWorkspaceRole("owner", "admin")` gates both member
 * endpoints, but a gate is not a hierarchy — it only asks "is the caller
 * privileged?", never "is the caller more privileged than the person they are
 * acting on?". Without this comparison any admin could demote or remove any
 * peer admin, so a single freshly promoted admin could strip every other
 * admin with no owner involvement. Ranks make the rule expressible as one
 * strict inequality (`actor > target`) that is impossible to get subtly
 * wrong the way a chain of role string comparisons is.
 *
 * Deliberately not exported: callers ask the two predicates below rather than
 * comparing ranks themselves, so every new governance rule is added here where
 * the existing ones can be read alongside it.
 */
const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/**
 * Returns `true` when `actor` outranks `target` strictly.
 *
 * Strict (not `>=`) is the whole point: equal ranks must not be able to act
 * on each other. It also means an admin cannot change their own role — a
 * deliberate call. A "but it's yourself" exception is exactly the shape that
 * lets a caller who reaches the handler with a lower rank set their own role
 * upward, and self-demotion is a one-line ask of the owner rather than a
 * capability worth that risk.
 *
 * An absent `actor` (no `workspace_member` row for the caller) is `false`:
 * fail closed, so a handler that reaches this without its own membership check
 * denies rather than throws.
 */
export function outranks(
  actor: { role: WorkspaceRole } | undefined,
  target: { role: WorkspaceRole },
): boolean {
  if (!actor) return false;
  return WORKSPACE_ROLE_RANK[actor.role] > WORKSPACE_ROLE_RANK[target.role];
}

/**
 * Rank required to *grant* the `admin` role, mirroring the rank `outranks`
 * already requires to revoke it.
 *
 * ## Why granting had to be closed at the same time as revoking
 *
 * `outranks` stops an admin from demoting or removing a peer admin — only the
 * owner may take the admin role away. Left on its own that rule moves the
 * hazard rather than closing it: an admin who can still *promote* a plain
 * member to admin can manufacture peers who are, from that instant, immune to
 * every admin in the workspace including their creator. One admin could
 * repopulate the entire admin tier, and only the owner could ever undo any of
 * it. That is the same "no owner involvement" outcome the hierarchy exists to
 * prevent, reached from the creation side instead of the destruction side.
 *
 * Closing both directions leaves admins with exactly the authority the audit
 * described — "let admins manage members only" — and makes the admin tier a
 * set only the owner can change.
 *
 * ## Both doors, one rule
 *
 * Promotion is not the only way to mint an admin: `createInvitation` is gated
 * `requireWorkspaceRole("owner", "admin")` and `createInvitationSchema`
 * refuses only `owner`, so an admin blocked from promoting a member could
 * otherwise simply invite a brand-new admin and reach the identical end state
 * through a different door. A rule enforced on one of two equivalent paths is
 * not a rule; it is a speed bump that tells an attacker which door to use.
 * Both routes therefore consult {@link mayGrantAdmin}. (An admin could also
 * remove a member and re-invite them as an admin, but that needs the target to
 * accept, and the removal first destroys every project and team grant they
 * held — a loud, auditable act, not a quiet promotion.)
 */
const ADMIN_GRANT_MIN_RANK = WORKSPACE_ROLE_RANK.owner;

/**
 * Whether `actor` may hand out the `admin` role, on promotion or by invitation.
 * See {@link ADMIN_GRANT_MIN_RANK} for why one-sided enforcement would only
 * relocate the hazard.
 *
 * An absent `actor` is `false`, matching {@link outranks}: a caller with no
 * membership row in the workspace grants nothing. Neither call site can reach
 * this with an undefined actor today — both establish membership first — but
 * the fail-closed default means a future one cannot turn a missing row into a
 * grant.
 *
 * Note what this deliberately does NOT restrict: who may be invited or promoted
 * to plain `member`. Admins keep the whole of the authority the audit assigned
 * them; what they lose is the ability to enlarge the tier that outranks their
 * own peers.
 */
export function mayGrantAdmin(
  actor: { role: WorkspaceRole } | undefined,
): boolean {
  if (!actor) return false;
  return WORKSPACE_ROLE_RANK[actor.role] >= ADMIN_GRANT_MIN_RANK;
}
