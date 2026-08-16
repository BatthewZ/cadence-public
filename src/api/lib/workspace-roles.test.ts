import { describe, expect, it } from "vitest";

import type { WorkspaceRole } from "../../shared/types/roles";
import { mayGrantAdmin, outranks } from "./workspace-roles";

/**
 * Unit tests for the workspace role hierarchy.
 *
 * ## Why this file exists at all
 *
 * `workspace-roles.ts` is the single source of truth for member governance —
 * `updateMemberRole` and `removeMember` in `routes/workspaces`, and
 * `createInvitation` in `routes/invitations`, all defer to it. Those handler
 * suites exercise it, but only along the paths those endpoints happen to take,
 * and only for the role pairs those fixtures happen to seed. A hierarchy is a
 * *matrix*, and a matrix that is only ever sampled diagonally is a matrix whose
 * off-diagonal cells can be wrong for a long time without anyone noticing. The
 * whole audit finding this module closes was exactly that shape: `outranks` was
 * missing, so any admin could demote or remove any peer admin, and no handler
 * test failed because none of them seeded two admins.
 *
 * So the matrix is enumerated here explicitly, in one place, where a reader can
 * see all nine `outranks` cells and all four `mayGrantAdmin` cases at once and
 * check them against the rule as written rather than against a fixture.
 *
 * ## What each group is defending
 *
 * - **Strictness** (`admin` vs `admin`, `owner` vs `owner`): the comparison is
 *   `>`, not `>=`. Relaxing it to `>=` would silently restore the original
 *   vulnerability — one freshly promoted admin able to strip every other admin
 *   with no owner involvement — and would also let a caller act on their own
 *   membership row.
 * - **Downward denial** (`member` acting on anyone, `admin` acting on `owner`):
 *   the rank table must not be readable in reverse.
 * - **Fail-closed on `undefined`**: a caller with no `workspace_member` row is
 *   not a zero-rank participant, they are a non-participant. Both predicates
 *   must answer `false` rather than throwing or coercing, so that a future
 *   handler that reaches them before establishing membership denies instead of
 *   crashing (or, worse, granting via `undefined` arithmetic).
 * - **`mayGrantAdmin` owner-only**: closing revocation without closing granting
 *   only relocates the hazard — an admin who can still mint admins can
 *   manufacture peers who are immune to every other admin from the moment they
 *   are created. `admin` must be `false` here even though `admin` is otherwise
 *   a privileged role, which is precisely the cell most likely to be "fixed"
 *   back to `true` by someone who reads the endpoint's `requireWorkspaceRole`
 *   gate and assumes it is the whole rule.
 */

/** All workspace roles, enumerated so the matrices below cannot silently skip one. */
const ROLES: WorkspaceRole[] = ["owner", "admin", "member"];

describe("outranks", () => {
  /**
   * The full 3x3 actor/target matrix, written out rather than derived from the
   * rank table — deriving it from the same data structure the implementation
   * uses would make the test agree with any mutation of that table.
   */
  const EXPECTED: Record<WorkspaceRole, Record<WorkspaceRole, boolean>> = {
    owner: { owner: false, admin: true, member: true },
    admin: { owner: false, admin: false, member: true },
    member: { owner: false, admin: false, member: false },
  };

  for (const actor of ROLES) {
    for (const target of ROLES) {
      const expected = EXPECTED[actor][target];
      it(`${actor} ${expected ? "outranks" : "does not outrank"} ${target}`, () => {
        expect(outranks({ role: actor }, { role: target })).toBe(expected);
      });
    }
  }

  it("is strict, so equal ranks never outrank each other", () => {
    // Called out separately from the matrix because this is the cell that
    // encodes the audit finding: `>=` here re-opens admin-strips-admin.
    for (const role of ROLES) {
      expect(outranks({ role }, { role })).toBe(false);
    }
  });

  it("fails closed when the actor has no membership row", () => {
    for (const target of ROLES) {
      expect(outranks(undefined, { role: target })).toBe(false);
    }
  });
});

describe("mayGrantAdmin", () => {
  it("lets the owner hand out the admin role", () => {
    expect(mayGrantAdmin({ role: "owner" })).toBe(true);
  });

  it("refuses an admin, so the admin tier is a set only the owner can enlarge", () => {
    expect(mayGrantAdmin({ role: "admin" })).toBe(false);
  });

  it("refuses a plain member", () => {
    expect(mayGrantAdmin({ role: "member" })).toBe(false);
  });

  it("fails closed when the actor has no membership row", () => {
    expect(mayGrantAdmin(undefined)).toBe(false);
  });
});
