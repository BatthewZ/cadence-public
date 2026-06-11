import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { apiToken } from "../../../../db/schema/api-token";
import { user as userTable } from "../../../../db/schema/auth";
import { project, projectMember } from "../../../../db/schema/project";
import { task, taskActivity } from "../../../../db/schema/task";
import type { AppEnv } from "../../../env";
import { compoundCursorCondition, computeCompoundNextCursor, parseCompoundCursor, parseCursorParams } from "../../../lib/pagination";
import { requireParam } from "../../../lib/params";
import { isElevatedRole } from "./helpers";

/**
 * GET /projects/:projectId/activity
 *
 * Returns a paginated activity feed across all tasks in the project,
 * including the task title for context in each activity item.
 */
export async function projectActivity(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 15, maxLimit: 50 });

  const conditions = [eq(task.projectId, projectId)];

  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(
      compoundCursorCondition(compound, taskActivity.createdAt, taskActivity.id, "desc")
    );
  }

  // LEFT JOIN api_token so requests authenticated via a Personal Access
  // Token surface the token's display name to the UI, enabling
  // "via <TokenName>" attribution. A NULL apiTokenId or a hard-deleted
  // token row both produce a null tokenName, which the UI handles.
  const activities = await db
    .select({
      id: taskActivity.id,
      taskId: taskActivity.taskId,
      taskTitle: task.title,
      actorId: taskActivity.actorId,
      actorName: userTable.name,
      actorImage: userTable.image,
      action: taskActivity.action,
      field: taskActivity.field,
      oldValue: taskActivity.oldValue,
      newValue: taskActivity.newValue,
      createdAt: taskActivity.createdAt,
      apiTokenId: taskActivity.apiTokenId,
      tokenName: apiToken.name,
    })
    .from(taskActivity)
    .innerJoin(task, eq(taskActivity.taskId, task.id))
    .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
    .leftJoin(apiToken, eq(taskActivity.apiTokenId, apiToken.id))
    .where(and(...conditions))
    .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
    .limit(limit);

  const nextCursor = computeCompoundNextCursor(
    activities,
    limit,
    (a) => a.createdAt,
    (a) => a.id
  );

  return c.json({ activities, nextCursor });
}

/**
 * GET /workspaces/:workspaceId/activity
 *
 * Returns a paginated workspace-wide activity feed across all projects
 * the user can access, including project context for each activity item.
 */
export async function workspaceActivity(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const isElevated = isElevatedRole(membership.role);

  const { limit, cursor } = parseCursorParams(c, { defaultLimit: 15, maxLimit: 50 });

  const conditions = [eq(project.workspaceId, workspaceId)];

  const compound = parseCompoundCursor(cursor);
  if (compound) {
    conditions.push(
      compoundCursorCondition(compound, taskActivity.createdAt, taskActivity.id, "desc")
    );
  }

  const activityFields = {
    id: taskActivity.id,
    taskId: taskActivity.taskId,
    taskTitle: task.title,
    projectId: project.id,
    projectName: project.name,
    actorId: taskActivity.actorId,
    actorName: userTable.name,
    actorImage: userTable.image,
    action: taskActivity.action,
    field: taskActivity.field,
    oldValue: taskActivity.oldValue,
    newValue: taskActivity.newValue,
    createdAt: taskActivity.createdAt,
    apiTokenId: taskActivity.apiTokenId,
    tokenName: apiToken.name,
  };

  // LEFT JOIN api_token to surface the token display name for
  // PAT-authored activity rows. NULL apiTokenId (cookie-auth) and
  // hard-deleted tokens both produce a null tokenName.
  const activitiesQuery = isElevated
    ? db
        .select(activityFields)
        .from(taskActivity)
        .innerJoin(task, eq(taskActivity.taskId, task.id))
        .innerJoin(project, eq(task.projectId, project.id))
        .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
        .leftJoin(apiToken, eq(taskActivity.apiTokenId, apiToken.id))
        .where(and(...conditions))
        .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
        .limit(limit)
    : db
        .select(activityFields)
        .from(taskActivity)
        .innerJoin(task, eq(taskActivity.taskId, task.id))
        .innerJoin(project, eq(task.projectId, project.id))
        .innerJoin(
          projectMember,
          and(eq(projectMember.projectId, project.id), eq(projectMember.userId, user.id))
        )
        .leftJoin(userTable, eq(taskActivity.actorId, userTable.id))
        .leftJoin(apiToken, eq(taskActivity.apiTokenId, apiToken.id))
        .where(and(...conditions))
        .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
        .limit(limit);

  const activities = await activitiesQuery;

  const nextCursor = computeCompoundNextCursor(
    activities,
    limit,
    (a) => a.createdAt,
    (a) => a.id
  );

  return c.json({ activities, nextCursor });
}
