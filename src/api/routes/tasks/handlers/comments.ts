import { and, asc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../../db/schema/auth";
import { comment, task } from "../../../../db/schema/task";
import { createCommentSchema, updateCommentSchema } from "../../../../shared/schemas/comment";
import type { AppEnv } from "../../../env";
import { resolveProjectAccess } from "../../../lib/access";
import { errorResponse } from "../../../lib/error-response";
import { parseMentions } from "../../../lib/mentions";
import { createNotifications } from "../../../lib/notifications";
import { compoundCursorCondition, computeCompoundNextCursor, parseCompoundCursor, parseCursorParams } from "../../../lib/pagination";
import { requireParam } from "../../../lib/params";
import { validJson } from "../../../lib/validated";
import { dispatchWebhook } from "../../../lib/webhook-payloads";
import { logActivity } from "../log-activity";

// ---------------------------------------------------------------------------
// Comment Handlers
// ---------------------------------------------------------------------------

export async function createComment(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");
  const body = validJson(c, createCommentSchema);

  const id = crypto.randomUUID();
  const now = new Date();

  const newComment = {
    id,
    taskId,
    authorId: user.id,
    body: body.body,
    createdAt: now,
    updatedAt: now,
  };

  await db.batch([
    db.insert(comment).values(newComment),
    db.update(task).set({ updatedAt: now }).where(eq(task.id, taskId)),
  ] as const);

  try {
    const [parentTask] = await db
      .select({ title: task.title, projectId: task.projectId })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);

    if (parentTask) {
      const mentionedUserIds = await parseMentions(db, body.body, parentTask.projectId);
      if (mentionedUserIds.length > 0) {
        await createNotifications(db, mentionedUserIds, {
          type: "task_comment_mention",
          title: `${user.name} mentioned you in a comment on "${parentTask.title}"`,
          body: body.body.substring(0, 200),
          actorId: user.id,
          projectId: parentTask.projectId,
          taskId,
          commentId: id,
        });
      }
    }
  } catch (error) {
    console.error("Failed to process mentions or notifications for createComment:", error);
    // Non-fatal: comment was already created
  }

  try {
    await logActivity(db, {
      taskId,
      actorId: user.id,
      action: "comment_added",
      newValue: body.body.substring(0, 100),
    });
  } catch (error) {
    console.error("Failed to log activity for createComment:", error);
    // Non-fatal: comment was already created
  }

  // Non-blocking webhook dispatch for task.comment_created
  const currentProject = c.get("currentProject");
  if (currentProject) {
    dispatchWebhook(c, currentProject.id, [
      {
        event: "task.comment_created",
        data: {
          id: newComment.id,
          taskId: newComment.taskId,
          authorId: newComment.authorId,
          body: newComment.body,
          createdAt: newComment.createdAt.toISOString(),
          updatedAt: newComment.updatedAt.toISOString(),
        },
      },
    ]);
  }

  return c.json({ comment: { ...newComment, authorName: user.name } }, 201);
}

export async function updateComment(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const commentId = requireParam(c, "commentId");
  const body = validJson(c, updateCommentSchema);

  // Look up the comment
  const [found] = await db
    .select()
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);

  if (!found) {
    return errorResponse(c, "Comment not found", 404);
  }

  // Only the author can edit their own comment
  if (found.authorId !== user.id) {
    return errorResponse(c, "Forbidden", 403);
  }

  // Verify the user still has access to the project
  const [parentTask] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, found.taskId))
    .limit(1);

  if (!parentTask) {
    return errorResponse(c, "Parent task not found", 404);
  }

  const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

  if (!accessResult) {
    return errorResponse(c, "Forbidden", 403);
  }

  const now = new Date();

  const [[updated]] = await db.batch([
    db.update(comment).set({ body: body.body, updatedAt: now }).where(eq(comment.id, commentId)).returning(),
    db.update(task).set({ updatedAt: now }).where(eq(task.id, found.taskId)),
  ] as const);

  try {
    await logActivity(db, {
      taskId: found.taskId,
      actorId: user.id,
      action: "comment_updated",
    });
  } catch (error) {
    console.error("Failed to log activity for updateComment:", error);
    // Non-fatal: comment was already updated
  }

  return c.json({ comment: updated });
}

export async function deleteComment(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const commentId = requireParam(c, "commentId");

  // Look up the comment
  const [found] = await db
    .select()
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);

  if (!found) {
    return errorResponse(c, "Comment not found", 404);
  }

  // Non-authors must be a project admin to delete
  if (found.authorId !== user.id) {
    const [parentTask] = await db
      .select({ projectId: task.projectId })
      .from(task)
      .where(eq(task.id, found.taskId))
      .limit(1);

    if (!parentTask) {
      return errorResponse(c, "Parent task not found", 404);
    }

    const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

    if (!accessResult || accessResult.role !== "admin") {
      return errorResponse(c, "Forbidden", 403);
    }
  }

  const now = new Date();
  await db.batch([
    db.delete(comment).where(eq(comment.id, commentId)),
    db.update(task).set({ updatedAt: now }).where(eq(task.id, found.taskId)),
  ] as const);

  try {
    await logActivity(db, {
      taskId: found.taskId,
      actorId: user.id,
      action: "comment_deleted",
    });
  } catch (error) {
    console.error("Failed to log activity for deleteComment:", error);
    // Non-fatal: comment was already deleted
  }

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// List Comments (Paginated)
// ---------------------------------------------------------------------------

export async function listComments(c: Context<AppEnv>) {
  const db = c.get("db");
  const taskId = requireParam(c, "taskId");

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 20, maxLimit: 100 });

  const conditions = [eq(comment.taskId, taskId)];
  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(compoundCursorCondition(compound, comment.createdAt, comment.id, "asc"));
  }

  const comments = await db
    .select({
      id: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      authorName: userTable.name,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    })
    .from(comment)
    .leftJoin(userTable, eq(comment.authorId, userTable.id))
    .where(and(...conditions))
    .orderBy(asc(comment.createdAt), asc(comment.id))
    .limit(limit);

  const nextCursor = computeCompoundNextCursor(comments, limit, (r) => r.createdAt, (r) => r.id);

  return c.json({
    comments: comments.map((r) => ({
      ...r,
      authorName: r.authorName ?? "Unknown",
    })),
    nextCursor,
  });
}
