/**
 * Workspace policy — the admin-configurable governance settings for a workspace.
 *
 * ## Why this is a named object and not a permission matrix
 *
 * Cadence's 43 role-gated routes collapse into four distinct role sets
 * (`owner+admin` and `owner` at the workspace level; `admin` and
 * `admin+member` at the project level). A role × capability matrix is the
 * right shape when capabilities need *independently* configurable role sets;
 * here they are near-perfectly correlated, so a matrix would be a wide grid of
 * four repeated columns and 43 opportunities to set one cell into a
 * combination nobody has tested.
 *
 * It would also cost the property that makes the current model auditable: role
 * rules are static, so `resolveProjectAccess` is *provably* the single choke
 * point and `use-permissions.ts` can mirror it rule-for-rule in code review.
 * Turning permissions into per-workspace data turns that mirror into a
 * cache-coherence problem and makes "who can delete a project?" a question
 * with no greppable answer.
 *
 * What a matrix cannot express at all are the two rules doing the real work,
 * because they are *scope-nesting* rules rather than role → capability cells:
 * workspace owner/admin is elevated to project admin, and a project role is
 * live only while the workspace membership behind it is. Those stay in
 * `src/api/lib/access.ts` either way.
 *
 * So this is the smaller thing that absorbs the same pressure: a typed object
 * of named toggles with defaults in code. Adding toggle #2 is a field on the
 * interface plus a default — no migration, no new plumbing path, and existing
 * workspaces pick it up correctly because absent keys resolve to the code
 * default rather than to whatever was backfilled. Revisit the matrix when two
 * toggles genuinely want *different* role sets; that divergence is the signal,
 * and it does not exist yet.
 *
 * ## Storage contract
 *
 * Persisted as JSON text in `workspace.policy`. The column is nullable and
 * every key is optional: `null`, `{}`, and a JSON object missing a key all
 * mean "use the code default". Nothing is ever backfilled, which is precisely
 * what keeps adding a toggle free.
 */

/**
 * The resolved, fully-populated policy for a workspace. Every field is
 * non-optional here — {@link resolveWorkspacePolicy} is the only way to build
 * one, and it fills every key from {@link DEFAULT_WORKSPACE_POLICY}. Consumers
 * therefore never write `?? someDefault` at a call site, which is what stops
 * the default for a toggle from drifting across the codebase.
 */
export interface WorkspacePolicy {
  /**
   * May a workspace `member` create projects (and duplicate ones they admin)?
   *
   * Owners and admins always can, regardless of this flag — it narrows the
   * `member` role only, so turning it off can never lock an admin out of their
   * own workspace.
   *
   * Defaults to `true`, matching the behaviour every existing workspace
   * already has. It is a governance preference and not a security control:
   * workspace owners/admins are elevated to project admin on every project by
   * `resolveProjectAccess`, so they can already see, edit and delete anything
   * a member creates. Turning it off buys tidiness and process, not
   * containment.
   */
  allowMemberProjectCreation: boolean;
}

/**
 * The code-side defaults. This is the single source of truth for "what does a
 * workspace that has never touched its policy behave like" — the DB column
 * deliberately carries no defaults of its own, so a new toggle takes effect
 * for every existing workspace the moment it is added here.
 */
export const DEFAULT_WORKSPACE_POLICY: WorkspacePolicy = {
  allowMemberProjectCreation: true,
};

/**
 * The policy keys, derived from the defaults so a new toggle cannot be added
 * without {@link resolveWorkspacePolicy} learning about it.
 *
 * The wire-level validator (`workspacePolicySchema` in
 * `src/shared/schemas/workspace.ts`) is kept in step by a `satisfies
 * z.ZodType<WorkspacePolicy>` clause instead, because Zod needs a per-key type
 * that a key list cannot supply.
 */
export const WORKSPACE_POLICY_KEYS = Object.keys(
  DEFAULT_WORKSPACE_POLICY,
) as ReadonlyArray<keyof WorkspacePolicy>;

/**
 * Resolve the stored `workspace.policy` column into a complete policy object.
 *
 * Accepts the raw column value (JSON text, or `null` for a workspace that has
 * never set a policy) and returns every key populated, taking each missing or
 * unusable key from {@link DEFAULT_WORKSPACE_POLICY}.
 *
 * ## Why this never throws
 *
 * A malformed or hand-edited `policy` column resolves to the documented
 * defaults instead of raising. The alternative — a parse error propagating out
 * of `getWorkspace` — would 500 the workspace detail endpoint, which is the
 * query every workspace route depends on to render at all. One corrupt JSON
 * blob would take a tenant's entire UI down to protect a preference whose
 * "off" state is tidiness rather than containment (see the field docs). Silent
 * fallback is the correct trade here specifically *because* the policy is not
 * a security boundary; a flag that gated data access would deserve the
 * opposite treatment and should not be added to this object.
 *
 * Per-key rather than whole-object fallback is deliberate: a future policy
 * with five toggles should not discard four valid ones because a fifth was
 * written as a string.
 */
export function resolveWorkspacePolicy(
  stored: string | null | undefined,
): WorkspacePolicy {
  if (!stored) return { ...DEFAULT_WORKSPACE_POLICY };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { ...DEFAULT_WORKSPACE_POLICY };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_WORKSPACE_POLICY };
  }

  const source = parsed as Record<string, unknown>;
  const resolved = { ...DEFAULT_WORKSPACE_POLICY };

  for (const key of WORKSPACE_POLICY_KEYS) {
    const value = source[key];
    // Only a correctly-typed value overrides the default. Every current key is
    // boolean; when a non-boolean toggle is added this becomes a per-key check.
    if (typeof value === "boolean") {
      resolved[key] = value;
    }
  }

  return resolved;
}
