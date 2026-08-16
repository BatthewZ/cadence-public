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
import { enforceTokenProjectBinding } from "../../../middleware/authorize";
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
    console.error("Failed to process mentions or notifications for createComment:", { taskId, userId: user.id, commentId: id }, error);
    // Non-fatal: comment was already created
  }

  try {
    await logActivity(db, {
      taskId,
      actorId: user.id,
      action: "comment_added",
      newValue: body.body.substring(0, 100),
      apiTokenId: c.get("apiToken")?.id ?? null,
    });
  } catch (error) {
    console.error("Failed to log activity for createComment:", { taskId, userId: user.id, commentId: id }, error);
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
          author: { id: user.id, name: user.name, email: user.email },
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

  // PAT binding guard. `/comments/:commentId` carries no projectId or taskId,
  // so no project/task middleware can run here and the token's workspace
  // binding and selected-project list would otherwise go unchecked — the
  // author check above is about the human, not the credential. Shared policy,
  // same generic 403 as the middleware.
  const denied = enforceTokenProjectBinding(c, accessResult.project);
  if (denied) return denied;

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
      apiTokenId: c.get("apiToken")?.id ?? null,
    });
  } catch (error) {
    console.error("Failed to log activity for updateComment:", error);
    // Non-fatal: comment was already updated
  }

  // Enrich with authorName to mirror createComment/listComments responses —
  // the web `Comment` contract pins authorName as required, and the author-only
  // guard above (403 for non-authors) guarantees the actor IS the author, so
  // user.name is the correct value without an extra lookup.
  return c.json({ comment: { ...updated, authorName: user.name } });
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

  // Resolve the owning project so access can be checked against it.
  const [parentTask] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, found.taskId))
    .limit(1);

  if (!parentTask) {
    return errorResponse(c, "Parent task not found", 404);
  }

  // Authorization, resolved UNCONDITIONALLY for every caller.
  //
  // The rule to preserve is about DIRECTION, not literal shape. `updateComment`
  // above pre-filters on authorship first, but only in the DENY direction
  // (`authorId !== user.id` → 403), which fails closed and is safe. What must
  // never appear is the ALLOW-side mirror — `if (authorId === user.id)` used to
  // skip ahead — because that grants without ever asking whether the caller
  // still has access. Do not "match updateComment" by copying its ordering and
  // flipping the comparison; that reintroduces exactly the bug below.
  //
  // Authorship is not authorization. `comment.authorId` records who wrote the
  // row historically; it says nothing about whether that person may still
  // touch the project today. Membership is revocable and authorship is not, so
  // an `if (authorId === user.id)` short-circuit placed BEFORE this call
  // hands every past author a permanent write key to a project they have been
  // removed from: deleting the comment is itself a write, and it bumps the
  // parent task's `updatedAt` for everyone still in the project. That was a
  // real hole here — the access resolution used to live inside the non-author
  // branch, so an offboarded user could still delete their own comments while
  // `updateComment`, which always resolved access, correctly refused them the
  // same second. Resolve first, decide after; the author check is a
  // NARROWING of an already-granted access, never a bypass of it.
  //
  // Any access level is enough for the author (matching `updateComment`, where
  // a viewer may edit their own words); non-authors need project admin.
  const accessResult = await resolveProjectAccess(db, parentTask.projectId, user.id);

  if (!accessResult) {
    return errorResponse(c, "Forbidden", 403);
  }

  if (found.authorId !== user.id && accessResult.role !== "admin") {
    return errorResponse(c, "Forbidden", 403);
  }

  // PAT binding guard — see `updateComment`. Placed after the human check so
  // a caller failing both is denied for the human reason first and no
  // PAT-specific signal leaks. It is a second, independent gate: the human
  // check above says the person may act, this one says the credential may.
  const denied = enforceTokenProjectBinding(c, accessResult.project);
  if (denied) return denied;

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
      apiTokenId: c.get("apiToken")?.id ?? null,
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
