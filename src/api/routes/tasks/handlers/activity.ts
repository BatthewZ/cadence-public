import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../../db/schema/auth";
import { taskActivity } from "../../../../db/schema/task";
import type { AppEnv } from "../../../env";
import { compoundCursorCondition, computeCompoundNextCursor, parseCompoundCursor, parseCursorParams } from "../../../lib/pagination";
import { requireParam } from "../../../lib/params";

// ---------------------------------------------------------------------------
// Activity Handlers
// ---------------------------------------------------------------------------

export async function getTaskActivity(c: Context<AppEnv>) {
  const db = c.get("db");
  const taskId = requireParam(c, "taskId");

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 5, maxLimit: 100 });

  const conditions = [eq(taskActivity.taskId, taskId)];
  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(compoundCursorCondition(compound, taskActivity.createdAt, taskActivity.id, "desc"));
  }

  const activities = await db
    .select({
      id: taskActivity.id,
      taskId: taskActivity.taskId,
      actorId: taskActivity.actorId,
      actorName: userTable.name,
      actorImage: userTable.image,
      action: taskActivity.action,
      field: taskActivity.field,
      oldValue: taskActivity.oldValue,
      newValue: taskActivity.newValue,
      createdAt: taskActivity.createdAt,
    })
    .from(taskActivity)
    .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
    .where(and(...conditions))
    .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
    .limit(limit);

  const nextCursor = computeCompoundNextCursor(activities, limit, (a) => a.createdAt, (a) => a.id);

  return c.json({ activities, nextCursor });
}
