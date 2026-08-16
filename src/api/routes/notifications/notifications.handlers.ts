import type { SQL } from "drizzle-orm";
import { and, count, desc, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { notification } from "../../../db/schema/notification";
import { project } from "../../../db/schema/project";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { computeNextCursor, parseCursorDate, parseCursorParams } from "../../lib/pagination";
import { requireParam } from "../../lib/params";
import {
  tokenProjectScopeFilter,
  tokenWorkspaceScopeFilter,
} from "../../middleware/authorize";

// ---------------------------------------------------------------------------
// PAT scoping
// ---------------------------------------------------------------------------

/**
 * Restrict the notification feed to what the request's Personal Access Token
 * is scoped to. Returns `undefined` for cookie sessions, which must keep
 * seeing their whole inbox unchanged.
 *
 * ## Why this endpoint needs its own rule
 *
 * Notifications are the one tenant-data surface in the API keyed by **user**
 * rather than by workspace: `/notifications` mounts `requireAuth` alone, with
 * no `:workspaceId` in the URL and therefore no `requireWorkspaceMember` to
 * supply the token's workspace binding. Yet the rows are unmistakably tenant
 * data — `notification` carries `projectId`, `taskId` and `commentId`, and the
 * producers embed project content *verbatim* in `title`/`body`: the assigned
 * task's title (`task-crud.ts`), the completed task's title
 * (`completion.ts`), and a 200-character excerpt of the comment that mentioned
 * you (`handlers/comments.ts`). Left unscoped, a token narrowed to one project
 * reads sibling task titles and comment text out of the inbox without ever
 * touching a project route, and a token bound to workspace A reads workspace
 * B's entirely.
 *
 * ## The rule, per row shape
 *
 * Rows fall into exactly three shapes, and the producer audit above is what
 * makes the classification safe rather than hopeful:
 *
 *  1. **`projectId` set** — project-owned, and the only shape that ever
 *     contains project content. Visible when the owning project satisfies the
 *     FULL binding: it lives in the token's workspace AND is on the token's
 *     selected list. The workspace half is checked on `project.workspaceId`
 *     rather than `notification.workspaceId` because the task-notification
 *     producers set `projectId` and leave `workspaceId` null — trusting the
 *     denormalised column here would let those rows through.
 *  2. **`projectId` null, `workspaceId` set** — workspace-owned. Today the
 *     only producer is `invitation_received` (`invitations.handlers.ts`),
 *     whose content is a workspace name. Visible when the workspace is the
 *     token's own. These are deliberately NOT hidden from a narrowed token:
 *     project scope narrows project-owned data, and the token's workspace
 *     binding is the right and sufficient control for workspace-owned data —
 *     the same call made for members, teams and invitations. (Contrast the
 *     workspace-wide *webhook*, which IS hidden: it is a conduit for every
 *     project's events, so it is project data in effect.)
 *  3. **Both null** — tied to no tenant at all. Visible; there is nothing to
 *     narrow, and hiding these would silently break future account-level
 *     notices for machine clients.
 *
 * The `EXISTS` subquery (rather than a `LEFT JOIN`) is what lets the identical
 * predicate serve the list, the unread count, the single-row read/delete and
 * the mark-all sweep. Uniformity matters more than the marginal plan cost: the
 * mutations are where a divergent copy would be least visible and most
 * damaging, since a narrowed token that could mark-read or delete a sibling
 * project's notification would silently destroy a human's inbox state.
 */
function tokenNotificationScope(c: Context<AppEnv>): SQL | undefined {
  const token = c.get("apiToken");
  if (!token) return undefined;

  const db = c.get("db");
  const projectOwned = exists(
    db
      .select({ one: sql`1` })
      .from(project)
      .where(
        and(
          eq(project.id, notification.projectId),
          tokenWorkspaceScopeFilter(c, project.workspaceId),
          tokenProjectScopeFilter(c, project.id),
        ),
      ),
  );

  return or(
    projectOwned,
    and(
      isNull(notification.projectId),
      or(
        isNull(notification.workspaceId),
        tokenWorkspaceScopeFilter(c, notification.workspaceId),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

/**
 * `GET /notifications`
 *
 * The current user's notification feed, newest first, cursor-paginated.
 *
 * Always filtered by `userId` — a notification belongs to exactly one person.
 * PAT callers are additionally narrowed by {@link tokenNotificationScope};
 * cookie sessions are unaffected.
 */
export async function listNotifications(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  const unreadOnly = c.req.query("unreadOnly") === "true";
  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 30, maxLimit: 100 });

  const conditions = [eq(notification.userId, user.id)];
  const patScope = tokenNotificationScope(c);
  if (patScope) {
    conditions.push(patScope);
  }
  if (unreadOnly) {
    conditions.push(eq(notification.read, false));
  }
  const cursorDate = parseCursorDate(cursor);
  if (cursorDate) {
    conditions.push(lt(notification.createdAt, cursorDate));
  }

  const notifications = await db
    .select({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      read: notification.read,
      workspaceId: notification.workspaceId,
      projectId: notification.projectId,
      taskId: notification.taskId,
      commentId: notification.commentId,
      invitationId: notification.invitationId,
      actorId: notification.actorId,
      actorName: userTable.name,
      actorImage: userTable.image,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    })
    .from(notification)
    .leftJoin(userTable, eq(notification.actorId, userTable.id))
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt))
    .limit(limit);

  const nextCursor = computeNextCursor(notifications, limit, (n) => n.createdAt);

  return c.json({ notifications, nextCursor });
}

// ---------------------------------------------------------------------------
// getUnreadCount
// ---------------------------------------------------------------------------

/**
 * `GET /notifications/unread-count`
 *
 * Scoped identically to the feed itself — an unscoped count would tell a
 * narrowed token how much activity it is not allowed to read, and would make
 * the badge disagree with the list it labels.
 */
export async function getUnreadCount(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  const [result] = await db
    .select({ count: count() })
    .from(notification)
    .where(
      and(
        eq(notification.userId, user.id),
        eq(notification.read, false),
        tokenNotificationScope(c),
      ),
    );

  return c.json({ count: result?.count ?? 0 });
}

// ---------------------------------------------------------------------------
// markAsRead
// ---------------------------------------------------------------------------

/**
 * `PATCH /notifications/:id/read`
 *
 * The PAT scope is folded into the `WHERE`, not checked separately, so an
 * out-of-scope row is simply not matched and answers the existing
 * `404 Notification not found` — byte-identical to a row that does not exist
 * or belongs to another user. That is deliberate: a distinct 403 here would
 * confirm to a narrowed token that a given notification id exists, which is
 * the one thing the filter is meant to hide.
 */
export async function markAsRead(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const id = requireParam(c, "id");

  const [updated] = await db
    .update(notification)
    .set({ read: true, readAt: new Date() })
    .where(
      and(
        eq(notification.id, id),
        eq(notification.userId, user.id),
        tokenNotificationScope(c),
      ),
    )
    .returning({ id: notification.id });

  if (!updated) {
    return errorResponse(c, "Notification not found", 404);
  }

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// markAllAsRead
// ---------------------------------------------------------------------------

/**
 * `POST /notifications/mark-all-read`
 *
 * "All" means all the caller can see. A narrowed token sweeping the human's
 * entire inbox would be a destructive write against projects it cannot read —
 * the notifications would still exist, but the human would never notice them.
 */
export async function markAllAsRead(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  await db
    .update(notification)
    .set({ read: true, readAt: new Date() })
    .where(
      and(
        eq(notification.userId, user.id),
        eq(notification.read, false),
        tokenNotificationScope(c),
      ),
    );

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// deleteNotification
// ---------------------------------------------------------------------------

/**
 * `DELETE /notifications/:id`
 *
 * Same invisible-row treatment as {@link markAsRead}: an out-of-scope id is
 * not matched and answers `404`. Deletion is irreversible, so this is also the
 * endpoint where a missing scope check would be least recoverable.
 */
export async function deleteNotification(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const id = requireParam(c, "id");

  const [deleted] = await db
    .delete(notification)
    .where(
      and(
        eq(notification.id, id),
        eq(notification.userId, user.id),
        tokenNotificationScope(c),
      ),
    )
    .returning({ id: notification.id });

  if (!deleted) {
    return errorResponse(c, "Notification not found", 404);
  }

  return c.json({ ok: true });
}
