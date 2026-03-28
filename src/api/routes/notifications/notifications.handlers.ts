import { and, count, desc, eq, lt } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { notification } from "../../../db/schema/notification";
import type { AppEnv } from "../../env";
import { computeNextCursor, parseCursorDate, parseCursorParams } from "../../lib/pagination";

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

export async function listNotifications(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  const unreadOnly = c.req.query("unreadOnly") === "true";
  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 30, maxLimit: 100 });

  const conditions = [eq(notification.userId, user.id)];
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

export async function getUnreadCount(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  const [result] = await db
    .select({ count: count() })
    .from(notification)
    .where(
      and(eq(notification.userId, user.id), eq(notification.read, false)),
    );

  return c.json({ count: result?.count ?? 0 });
}

// ---------------------------------------------------------------------------
// markAsRead
// ---------------------------------------------------------------------------

export async function markAsRead(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { id } = c.req.param();

  const [updated] = await db
    .update(notification)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(notification.id, id), eq(notification.userId, user.id)))
    .returning({ id: notification.id });

  if (!updated) {
    return c.json({ error: "Notification not found" }, 404);
  }

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// markAllAsRead
// ---------------------------------------------------------------------------

export async function markAllAsRead(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  await db
    .update(notification)
    .set({ read: true, readAt: new Date() })
    .where(
      and(eq(notification.userId, user.id), eq(notification.read, false)),
    );

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// deleteNotification
// ---------------------------------------------------------------------------

export async function deleteNotification(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { id } = c.req.param();

  const [deleted] = await db
    .delete(notification)
    .where(and(eq(notification.id, id), eq(notification.userId, user.id)))
    .returning({ id: notification.id });

  if (!deleted) {
    return c.json({ error: "Notification not found" }, 404);
  }

  return c.json({ ok: true });
}
