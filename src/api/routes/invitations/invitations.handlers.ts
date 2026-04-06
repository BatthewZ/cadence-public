import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { invitation } from "../../../db/schema/invitation";
import { workspace, workspaceMember } from "../../../db/schema/workspace";
import { acceptInvitationSchema, createInvitationSchema } from "../../../shared/schemas/invitation";
import type { AppEnv } from "../../env";
import { deferWork } from "../../lib/defer";
import { errorResponse, throwWithContext } from "../../lib/error-response";
import { createNotification } from "../../lib/notifications";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import {
  buildInvitationEventData,
  buildMemberEventData,
  fireWebhookEvent,
} from "../../lib/webhook-payloads";

// ---------------------------------------------------------------------------
// createInvitation
// ---------------------------------------------------------------------------

export async function createInvitation(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createInvitationSchema);

  // Batch: check existing user by email + check existing pending invitation
  // These two lookups are independent (both use body.email / workspaceId).
  const [userResult, invitationResult] = await db.batch([
    db
      .select()
      .from(userTable)
      .where(eq(userTable.email, body.email))
      .limit(1),
    db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.workspaceId, workspaceId),
          eq(invitation.email, body.email),
          eq(invitation.status, "pending"),
        ),
      )
      .limit(1),
  ] as const);

  const [existingUser] = userResult;
  const [existingInvitation] = invitationResult;

  // Membership check is conditional — only runs if the user exists (needs existingUser.id)
  if (existingUser) {
    const [existingMember] = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, existingUser.id),
        ),
      )
      .limit(1);

    if (existingMember) {
      return errorResponse(c, "User is already a member of this workspace", 400);
    }
  }

  if (existingInvitation) {
    return errorResponse(c, "A pending invitation already exists for this email", 400);
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [created] = await db
    .insert(invitation)
    .values({
      id,
      workspaceId,
      email: body.email,
      role: body.role ?? "member",
      invitedBy: user.id,
      token,
      status: "pending",
      expiresAt,
      createdAt: now,
    })
    .returning();

  if (existingUser) {
    const recipientId = existingUser.id;
    deferWork(c, async () => {
      const [ws] = await db
        .select({ name: workspace.name })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1);

      await createNotification(db, {
        userId: recipientId,
        type: "invitation_received",
        title: ws
          ? `You've been invited to join workspace "${ws.name}"`
          : `You've been invited to join a workspace`,
        actorId: user.id,
        workspaceId,
        invitationId: id,
      });
    });
  }

  // Non-blocking webhook dispatch for invitation.created
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: user.id }, [
    { event: "invitation.created", data: buildInvitationEventData(created) },
  ]);

  return c.json({ invitation: created }, 201);
}

// ---------------------------------------------------------------------------
// listInvitations
// ---------------------------------------------------------------------------

export async function listInvitations(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  const invitations = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.workspaceId, workspaceId),
        eq(invitation.status, "pending"),
      ),
    );

  return c.json({ invitations });
}

// ---------------------------------------------------------------------------
// revokeInvitation
// ---------------------------------------------------------------------------

export async function revokeInvitation(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, id } = requireParams(c, "workspaceId", "id");

  const [existing] = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Invitation not found", 404);
  }

  await db
    .update(invitation)
    .set({ status: "revoked" })
    .where(eq(invitation.id, id));

  // Non-blocking webhook dispatch for invitation.revoked
  const user = c.get("user")!;
  const revokedInvitation = { ...existing, status: "revoked" as const };
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: user.id }, [
    { event: "invitation.revoked", data: buildInvitationEventData(revokedInvitation) },
  ]);

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// listMyPendingInvitations — returns pending invitations for the authenticated user
// ---------------------------------------------------------------------------

export async function listMyPendingInvitations(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const db = c.get("db");

  const rows = await db
    .select({
      id: invitation.id,
      token: invitation.token,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      inviterId: userTable.id,
      inviterName: userTable.name,
      inviterEmail: userTable.email,
    })
    .from(invitation)
    .leftJoin(workspace, eq(invitation.workspaceId, workspace.id))
    .leftJoin(userTable, eq(invitation.invitedBy, userTable.id))
    .where(
      and(
        eq(invitation.email, user.email),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    );

  const invitations = rows.map((r) => ({
    id: r.id,
    token: r.token,
    role: r.role,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    workspace: r.workspaceId
      ? { id: r.workspaceId, name: r.workspaceName }
      : null,
    invitedBy: r.inviterId
      ? { id: r.inviterId, name: r.inviterName, email: r.inviterEmail }
      : null,
  }));

  return c.json({ invitations });
}

// ---------------------------------------------------------------------------
// getInvitation (public — no auth required)
// ---------------------------------------------------------------------------

export async function getInvitation(c: Context<AppEnv>) {
  const db = c.get("db");
  const token = requireParam(c, "token");

  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.token, token))
    .limit(1);

  if (!inv) {
    return errorResponse(c, "Invitation not found", 404);
  }

  if (inv.status !== "pending") {
    return errorResponse(c, `Invitation is ${inv.status}`, 400);
  }

  if (inv.expiresAt < new Date()) {
    return errorResponse(c, "Invitation has expired", 400);
  }

  // Batch workspace + inviter lookups (both independent, both only need IDs from inv)
  let ws: { id: string; name: string } | undefined;
  let inviter: { id: string; name: string | null; email: string } | null = null;

  if (inv.invitedBy) {
    // Both workspace and inviter lookups are independent — batch them
    const [wsResult, inviterResult] = await db.batch([
      db
        .select({ id: workspace.id, name: workspace.name })
        .from(workspace)
        .where(eq(workspace.id, inv.workspaceId))
        .limit(1),
      db
        .select({ id: userTable.id, name: userTable.name, email: userTable.email })
        .from(userTable)
        .where(eq(userTable.id, inv.invitedBy))
        .limit(1),
    ] as const);

    [ws] = wsResult;
    inviter = inviterResult[0] ?? null;
  } else {
    // No inviter to look up — just fetch workspace
    [ws] = await db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, inv.workspaceId))
      .limit(1);
  }

  return c.json({
    invitation: {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      workspace: ws ? { id: ws.id, name: ws.name } : null,
      invitedBy: inviter,
    },
  });
}

// ---------------------------------------------------------------------------
// acceptInvitation
// ---------------------------------------------------------------------------

export async function acceptInvitation(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const db = c.get("db");
  const body = validJson(c, acceptInvitationSchema);

  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.token, body.token))
    .limit(1);

  if (!inv) {
    return errorResponse(c, "Invitation not found", 404);
  }

  if (inv.status !== "pending") {
    return errorResponse(c, `Invitation is ${inv.status}`, 409);
  }

  if (inv.expiresAt < new Date()) {
    return errorResponse(c, "Invitation has expired", 400);
  }

  // Verify the accepting user's email matches the invitation
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    return errorResponse(c, "This invitation was sent to a different email address", 403);
  }

  // Check if user is already a workspace member
  const [existingMember] = await db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, inv.workspaceId),
        eq(workspaceMember.userId, user.id),
      ),
    )
    .limit(1);

  if (existingMember) {
    return errorResponse(c, "You are already a member of this workspace", 400);
  }

  const now = new Date();
  const newMemberId = crypto.randomUUID();

  // Create workspace member
  await db.insert(workspaceMember).values({
    id: newMemberId,
    workspaceId: inv.workspaceId,
    userId: user.id,
    role: inv.role,
    invitedBy: inv.invitedBy,
    joinedAt: now,
  });

  // Update invitation status — if this fails, clean up the member record to avoid orphaned membership
  try {
    await db
      .update(invitation)
      .set({ status: "accepted", acceptedAt: now })
      .where(eq(invitation.id, inv.id));
  } catch (error) {
    // Roll back the workspace member insertion to keep state consistent
    await db
      .delete(workspaceMember)
      .where(eq(workspaceMember.id, newMemberId))
      .catch((cleanupErr) =>
        console.error("Failed to clean up orphaned workspace member after invitation status update failure:", { userId: user.id, workspaceId: inv.workspaceId, memberId: newMemberId, invitationId: inv.id }, cleanupErr),
      );
    throwWithContext(error, "acceptInvitation");
  }

  // Non-blocking webhook dispatch for invitation.accepted and workspace.member_joined
  const acceptedInvitation = { ...inv, status: "accepted" as const };
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId: inv.workspaceId, actorId: user.id }, [
    { event: "invitation.accepted", data: buildInvitationEventData(acceptedInvitation) },
    { event: "workspace.member_joined", data: buildMemberEventData({ userId: user.id, workspaceId: inv.workspaceId }, inv.role) },
  ]);

  return c.json({ ok: true, workspaceId: inv.workspaceId });
}
