import type { Database } from "../../db";
import { notification } from "../../db/schema/notification";
import type { NotificationType } from "../../shared/types/roles";

interface CreateNotificationOpts {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  actorId?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  commentId?: string;
  invitationId?: string;
}

/**
 * Insert an in-app notification for a specific user.
 *
 * Skips creating the notification when the actor is the same as the
 * recipient — users should not be notified about their own actions.
 */
export async function createNotification(
  db: Database,
  opts: CreateNotificationOpts,
): Promise<void> {
  if (opts.actorId && opts.actorId === opts.userId) return;

  await db.insert(notification).values({
    id: crypto.randomUUID(),
    userId: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body ?? null,
    read: false,
    actorId: opts.actorId ?? null,
    workspaceId: opts.workspaceId ?? null,
    projectId: opts.projectId ?? null,
    taskId: opts.taskId ?? null,
    commentId: opts.commentId ?? null,
    invitationId: opts.invitationId ?? null,
    createdAt: new Date(),
  });
}

/**
 * Create notifications for multiple recipients at once.
 *
 * Filters out the actor from the recipient list so users are never
 * notified about their own actions.
 */
export async function createNotifications(
  db: Database,
  recipientIds: string[],
  opts: Omit<CreateNotificationOpts, "userId">,
): Promise<void> {
  const validRecipients = recipientIds.filter((id) => id !== opts.actorId);
  if (validRecipients.length === 0) return;

  const now = new Date();
  await db.insert(notification).values(
    validRecipients.map((userId) => ({
      id: crypto.randomUUID(),
      userId,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
      read: false,
      actorId: opts.actorId ?? null,
      workspaceId: opts.workspaceId ?? null,
      projectId: opts.projectId ?? null,
      taskId: opts.taskId ?? null,
      commentId: opts.commentId ?? null,
      invitationId: opts.invitationId ?? null,
      createdAt: now,
    })),
  );
}
