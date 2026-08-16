import type { Database } from "../../db";
import { resolveProjectAccess } from "./access";

/**
 * Single source of truth for "may this user be assigned work in this project?".
 *
 * ## Why this exists
 *
 * `assigneeId` used to be written straight from the request body with no check
 * at all. Because a `task_assigned` notification carries the task **title** and
 * the **actor's name**, assigning a task to an arbitrary user id leaked both to
 * an account with no relationship to the workspace — and the task then appeared
 * in their "My Tasks" list, which filters by assignee rather than by
 * membership. It also doubled as an unbounded notification-spam primitive
 * against any known user id. Every assignment site in the task routes therefore
 * goes through this module before an assignee reaches the database or a
 * notification.
 *
 * ## Known gap (deliberate, not an oversight)
 *
 * `src/api/routes/workspaces/import/executor.ts` writes `task.assigneeId` from
 * an import file's user-ref map without calling this module. That map only
 * resolves refs to members of the *workspace*, so an imported task can land on
 * a workspace member who is not on the imported project — a weaker instance of
 * the same class (owner/admin-only entry point, no notification is sent, the
 * task is merely visible in that member's My Tasks list). Closing it means
 * intersecting the ref map with each project's own member set, which also
 * requires updating `import/executor.test.ts`, whose fixture currently asserts
 * the permissive behaviour. Tracked separately rather than fixed here.
 *
 * ## Why it delegates to `resolveProjectAccess`
 *
 * The obvious implementation — look for a `project_member` row — is **wrong**.
 * Workspace owners and admins are elevated to project admin without ever having
 * a `project_member` row (see {@link resolveProjectAccess}), so a membership-row
 * check would reject the two roles most likely to be handed work in a small
 * workspace. Rather than re-deriving those rules here (a second copy that would
 * drift the first time the access model changes), we ask the same resolver the
 * request guards use. Access policy stays in exactly one place; this module only
 * supplies the *assignment* semantics on top of it.
 */

/**
 * Error message returned when a request names an assignee who cannot reach the
 * project. Exported so handlers and tests assert the identical string and the
 * wording can never drift between the two enforcement points.
 *
 * Deliberately does not distinguish "no such user" from "user exists but has no
 * access" — telling an attacker which user ids exist would hand back a user
 * enumeration oracle in exchange for a slightly nicer error.
 */
export const ASSIGNEE_NOT_ASSIGNABLE_MESSAGE =
  "Assignee must have access to this project";

/**
 * True when `userId` can access `projectId` and may therefore hold its tasks.
 *
 * Mirrors request-time authorization exactly: workspace owners/admins qualify
 * through elevation, direct project members qualify through their project role,
 * and everyone else — including plain workspace members with no project
 * membership — does not. A non-existent project or user id resolves to `false`.
 *
 * Handlers call this for a **request-supplied** assignee and answer a failure
 * with 400, not 403: the caller is authorized, it is the *payload* that names
 * someone unreachable, and a 403 would wrongly suggest the actor may not assign
 * at all. `null`/`undefined` assignees (clear / leave alone) are legitimate and
 * are short-circuited by the caller before reaching this function. For an
 * assignee *inherited* from an existing row, use
 * {@link retainAssignableAssignee} instead.
 */
export async function canUserBeAssigned(
  db: Database,
  projectId: string,
  userId: string,
): Promise<boolean> {
  return (await resolveProjectAccess(db, projectId, userId)) !== null;
}

/**
 * Filter an **inherited** assignee — one copied forward from an existing task by
 * duplicate, recurring-spawn, or a completion notification, rather than named by
 * the caller.
 *
 * Returns the id when the assignee can still reach the project, `null` when they
 * cannot. These paths must not 400: the assignee was valid when it was written,
 * and a later membership change (offboarding, project removal) is not the fault
 * of the person clicking "Duplicate" or "Complete". Failing the whole operation
 * would turn an unrelated membership change into a broken button, so the stale
 * assignee is dropped instead — which also stops the copy from re-notifying
 * someone who has since lost access, so every assignee this module writes
 * references someone who can open the task.
 */
export async function retainAssignableAssignee(
  db: Database,
  projectId: string,
  assigneeId: string | null,
): Promise<string | null> {
  if (!assigneeId) return null;
  return (await canUserBeAssigned(db, projectId, assigneeId)) ? assigneeId : null;
}
