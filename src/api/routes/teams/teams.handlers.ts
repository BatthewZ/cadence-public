import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user } from "../../../db/schema/auth";
import { team, teamMember } from "../../../db/schema/team";
import { workspaceMember } from "../../../db/schema/workspace";
import { addTeamMemberSchema, createTeamSchema, updateTeamSchema } from "../../../shared/schemas/team";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";

// ---------------------------------------------------------------------------
// createTeam
// ---------------------------------------------------------------------------

export async function createTeam(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createTeamSchema);

  const id = crypto.randomUUID();
  const now = new Date();

  const [created] = await db
    .insert(team)
    .values({
      id,
      workspaceId,
      name: body.name,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json({ team: created }, 201);
}

// ---------------------------------------------------------------------------
// listTeams
// ---------------------------------------------------------------------------

export async function listTeams(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  const teams = await db
    .select({
      id: team.id,
      workspaceId: team.workspaceId,
      name: team.name,
      description: team.description,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      memberCount: sql<number>`count(${teamMember.id})`.as("memberCount"),
    })
    .from(team)
    .leftJoin(teamMember, eq(team.id, teamMember.teamId))
    .where(eq(team.workspaceId, workspaceId))
    .groupBy(team.id);

  return c.json({ teams });
}

// ---------------------------------------------------------------------------
// getTeamDetail
// ---------------------------------------------------------------------------

export async function getTeamDetail(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, teamId } = requireParams(c, "workspaceId", "teamId");

  const [existing] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Team not found", 404);
  }

  const members = await db
    .select({
      id: teamMember.id,
      userId: teamMember.userId,
      role: teamMember.role,
      joinedAt: teamMember.joinedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(teamMember)
    .innerJoin(user, eq(teamMember.userId, user.id))
    .where(eq(teamMember.teamId, teamId));

  return c.json({ ...existing, members });
}

// ---------------------------------------------------------------------------
// updateTeam
// ---------------------------------------------------------------------------

export async function updateTeam(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, teamId } = requireParams(c, "workspaceId", "teamId");
  const body = validJson(c, updateTeamSchema);

  const [existing] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Team not found", 404);
  }

  const now = new Date();

  const [updated] = await db
    .update(team)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      updatedAt: now,
    })
    .where(eq(team.id, teamId))
    .returning();

  return c.json({ team: updated });
}

// ---------------------------------------------------------------------------
// deleteTeam
// ---------------------------------------------------------------------------

export async function deleteTeam(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, teamId } = requireParams(c, "workspaceId", "teamId");

  const [existing] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Team not found", 404);
  }

  await db.delete(team).where(eq(team.id, teamId));

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// addTeamMember
// ---------------------------------------------------------------------------

export async function addTeamMember(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, teamId } = requireParams(c, "workspaceId", "teamId");
  const body = validJson(c, addTeamMemberSchema);
  const { userId, role } = body;

  // Batch all 3 validation queries in a single round-trip
  const [teamResult, wsMemberResult, existingResult] = await db.batch([
    db.select().from(team)
      .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
      .limit(1),
    db.select().from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
      .limit(1),
    db.select().from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
      .limit(1),
  ] as const);

  if (!teamResult[0]) {
    return errorResponse(c, "Team not found", 404);
  }
  if (!wsMemberResult[0]) {
    return errorResponse(c, "User is not a member of this workspace", 400);
  }
  if (existingResult[0]) {
    return errorResponse(c, "User is already a member of this team", 409);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const [member] = await db
    .insert(teamMember)
    .values({
      id,
      teamId,
      userId,
      role: role ?? "member",
      joinedAt: now,
    })
    .returning();

  return c.json({ member }, 201);
}

// ---------------------------------------------------------------------------
// removeTeamMember
// ---------------------------------------------------------------------------

export async function removeTeamMember(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, teamId, userId } = requireParams(c, "workspaceId", "teamId", "userId");

  // Batch both verification queries in a single round-trip (both are independent)
  const [teamResult, memberResult] = await db.batch([
    db.select().from(team)
      .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
      .limit(1),
    db.select().from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
      .limit(1),
  ] as const);

  if (!teamResult[0]) {
    return errorResponse(c, "Team not found", 404);
  }

  if (!memberResult[0]) {
    return errorResponse(c, "Member not found", 404);
  }

  await db
    .delete(teamMember)
    .where(
      and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)),
    );

  return c.json({ ok: true });
}
