import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { project } from "../../../db/schema/project";
import { task } from "../../../db/schema/task";
import { workspace, workspaceMember } from "../../../db/schema/workspace";
import {
  createWorkspaceSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from "../../../shared/schemas/workspace";
import type { AppEnv } from "../../env";
import { errorResponse, throwWithContext } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import {
  buildMemberEventData,
  fireWebhookEvent,
  resolveUser,
} from "../../lib/webhook-payloads";

const DUPLICATE_SLUG_ERROR = "You already have a workspace with that URL";

export async function createWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const body = validJson(c, createWorkspaceSchema);

  const id = crypto.randomUUID();
  const now = new Date();

  const newWorkspace = {
    id,
    name: body.name,
    slug: body.slug,
    description: body.description ?? null,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.batch([
      db.insert(workspace).values(newWorkspace),
      db.insert(workspaceMember).values({
        id: crypto.randomUUID(),
        workspaceId: id,
        userId: user.id,
        role: "owner",
        joinedAt: now,
      }),
    ] as const);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      return errorResponse(c, DUPLICATE_SLUG_ERROR, 409);
    }
    throwWithContext(error, "createWorkspace");
  }

  return c.json({ workspace: newWorkspace }, 201);
}

export async function listWorkspaces(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  // Batch both queries in a single DB round-trip:
  // 1. Fetch workspaces the user belongs to
  // 2. Count members for every workspace the user belongs to (via subquery, no dependency on query 1)
  const [results, memberCounts] = await db.batch([
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        theme: workspace.theme,
        role: workspaceMember.role,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(eq(workspaceMember.userId, user.id)),
    db
      .select({
        workspaceId: workspaceMember.workspaceId,
        count: count(),
      })
      .from(workspaceMember)
      .where(
        sql`${workspaceMember.workspaceId} IN (SELECT ${workspaceMember.workspaceId} FROM ${workspaceMember} WHERE ${workspaceMember.userId} = ${user.id})`,
      )
      .groupBy(workspaceMember.workspaceId),
  ] as const);

  if (results.length === 0) {
    return c.json({ workspaces: [] });
  }

  const memberCountMap = new Map(
    memberCounts.map((mc) => [mc.workspaceId, mc.count]),
  );

  const workspaces = results.map((r) => ({
    ...r,
    memberCount: memberCountMap.get(r.id) ?? 0,
  }));

  return c.json({ workspaces });
}

export async function getWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  // Batch workspace fetch + member count in a single DB round-trip
  const [workspaceResult, memberCountResult] = await db.batch([
    db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db
      .select({ count: count() })
      .from(workspaceMember)
      .where(eq(workspaceMember.workspaceId, workspaceId)),
  ] as const);

  const found = workspaceResult[0];
  if (!found) {
    return errorResponse(c, "Workspace not found", 404);
  }

  return c.json({
    workspace: {
      ...found,
      memberCount: memberCountResult[0].count,
    },
  });
}

export async function updateWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, updateWorkspaceSchema);

  const now = new Date();

  let updated: typeof workspace.$inferSelect | undefined;

  try {
    const [row] = await db
      .update(workspace)
      .set({ ...body, updatedAt: now })
      .where(eq(workspace.id, workspaceId))
      .returning();
    updated = row;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      return errorResponse(c, DUPLICATE_SLUG_ERROR, 409);
    }
    throwWithContext(error, "updateWorkspace");
  }

  if (!updated) {
    return errorResponse(c, "Workspace not found", 404);
  }

  return c.json({ workspace: updated });
}

export async function deleteWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  // Must delete tasks before workspace because task.taskGroupId has
  // onDelete:"restrict", which blocks cascade deletion through
  // workspace → project → task_group when tasks still reference those groups.
  const projectIds = db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.workspaceId, workspaceId));

  await db.batch([
    db.delete(task).where(inArray(task.projectId, projectIds)),
    db.delete(workspace).where(eq(workspace.id, workspaceId)),
  ] as const);

  return c.json({ ok: true });
}

export async function listMembers(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  const rows = await db
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      joinedAt: workspaceMember.joinedAt,
      userName: userTable.name,
      userEmail: userTable.email,
      userImage: userTable.image,
    })
    .from(workspaceMember)
    .innerJoin(userTable, eq(workspaceMember.userId, userTable.id))
    .where(eq(workspaceMember.workspaceId, workspaceId));

  const members = rows.map((r) => ({
    id: r.memberId,
    userId: r.userId,
    role: r.role,
    joinedAt: r.joinedAt,
    user: {
      id: r.userId,
      name: r.userName,
      email: r.userEmail,
      image: r.userImage,
    },
  }));

  return c.json({ members });
}

export async function updateMemberRole(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, userId: targetUserId } = requireParams(c, "workspaceId", "userId");
  const { role } = validJson(c, updateMemberRoleSchema);

  // Check if target member exists
  const [target] = await db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!target) {
    return errorResponse(c, "Member not found", 404);
  }

  if (target.role === "owner") {
    return errorResponse(c, "Cannot change the owner's role", 403);
  }

  const oldRole = target.role;

  const [updated] = await db
    .update(workspaceMember)
    .set({ role })
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, targetUserId),
      ),
    )
    .returning();

  // Non-blocking webhook dispatch for workspace.member_role_changed
  const user = c.get("user")!;
  const roleChangedUser = await resolveUser(db, targetUserId);
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: user.id }, [
    { event: "workspace.member_role_changed", data: buildMemberEventData({ userId: targetUserId, workspaceId }, role, roleChangedUser), changes: { role: { from: oldRole, to: role } } },
  ]);

  return c.json({ member: updated });
}

export async function removeMember(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, userId: targetUserId } = requireParams(c, "workspaceId", "userId");

  // Check if target member exists
  const [target] = await db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!target) {
    return errorResponse(c, "Member not found", 404);
  }

  if (target.role === "owner") {
    return errorResponse(c, "Cannot remove the workspace owner", 403);
  }

  // Prevent members from removing themselves
  const currentUser = c.get("user")!;
  if (targetUserId === currentUser.id) {
    return errorResponse(c, "Cannot remove yourself from the workspace", 400);
  }

  await db
    .delete(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, targetUserId),
      ),
    );

  // Non-blocking webhook dispatch for workspace.member_removed
  const removedUser = await resolveUser(db, targetUserId);
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: currentUser.id }, [
    { event: "workspace.member_removed", data: buildMemberEventData({ userId: targetUserId, workspaceId }, target.role, removedUser) },
  ]);

  return c.json({ ok: true });
}
