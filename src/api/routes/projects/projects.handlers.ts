import { and, count, eq, getTableColumns, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { label } from "../../../db/schema/label";
import { project, projectMember } from "../../../db/schema/project";
import { task, taskGroup } from "../../../db/schema/task";
import { workspaceMember } from "../../../db/schema/workspace";
import { addProjectMemberSchema, createProjectSchema, duplicateProjectSchema, updateProjectSchema } from "../../../shared/schemas/project";
import type { ProjectRole } from "../../../shared/types/roles";
import type { AppEnv } from "../../env";
import { handleDeleteCover, handleUploadCover } from "../../lib/cover-image";
import { deferWork } from "../../lib/defer";
import { errorResponse } from "../../lib/error-response";
import { createNotification } from "../../lib/notifications";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import {
  buildMemberEventData,
  buildProjectEventData,
  computeChanges,
  fireWebhookEvent,
} from "../../lib/webhook-payloads";

export async function createProject(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createProjectSchema);

  const db = c.get("db");
  const now = new Date();
  const projectId = crypto.randomUUID();

  const newProject = {
    id: projectId,
    workspaceId,
    name: body.name,
    description: body.description ?? null,
    icon: body.icon ?? null,
    status: body.status ?? "active",
    budget: body.budget ?? null,
    theme: body.theme ?? null,
    autoAssignCreator: body.autoAssignCreator ?? false,
    createdAt: now,
    updatedAt: now,
  };

  const defaultGroups = [
    { name: "To Do", position: "a0", isCompletionGroup: false },
    { name: "In Progress", position: "a1", isCompletionGroup: false },
    { name: "Done", position: "a2", isCompletionGroup: true },
  ];

  // Atomic batch: project + admin member + default task groups in one round-trip
  await db.batch([
    db.insert(project).values(newProject),
    db.insert(projectMember).values({
      id: crypto.randomUUID(),
      projectId,
      userId: user.id,
      role: "admin",
      addedAt: now,
    }),
    db.insert(taskGroup).values(
      defaultGroups.map((g) => ({
        id: crypto.randomUUID(),
        projectId,
        name: g.name,
        position: g.position,
        isCompletionGroup: g.isCompletionGroup,
        createdAt: now,
        updatedAt: now,
      })),
    ),
  ] as const);

  // Non-blocking webhook dispatch for project.created
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: user.id, projectId }, [
    { event: "project.created", data: buildProjectEventData(newProject as Parameters<typeof buildProjectEventData>[0]) },
  ]);

  return c.json({ project: newProject }, 201);
}

export async function listProjects(c: Context<AppEnv>) {
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const db = c.get("db");
  const isElevated = membership.role === "owner" || membership.role === "admin";

  // For non-elevated members, restrict to projects they belong to
  const projects = isElevated
    ? await db
        .select()
        .from(project)
        .where(eq(project.workspaceId, workspaceId))
    : await db
        .select(getTableColumns(project))
        .from(project)
        .innerJoin(
          projectMember,
          and(
            eq(projectMember.projectId, project.id),
            eq(projectMember.userId, user.id),
          ),
        )
        .where(eq(project.workspaceId, workspaceId));

  // Get member counts and task counts for each project
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length === 0) {
    return c.json({ projects: [] });
  }

  const [memberCounts, taskCounts] = await db.batch([
    db
      .select({
        projectId: projectMember.projectId,
        count: count(),
      })
      .from(projectMember)
      .where(
        sql`${projectMember.projectId} IN ${projectIds}`,
      )
      .groupBy(projectMember.projectId),
    db
      .select({
        projectId: taskGroup.projectId,
        count: count(),
      })
      .from(taskGroup)
      .where(
        sql`${taskGroup.projectId} IN ${projectIds}`,
      )
      .groupBy(taskGroup.projectId),
  ] as const);

  const memberCountMap = new Map(
    memberCounts.map((mc) => [mc.projectId, mc.count]),
  );
  const taskCountMap = new Map(
    taskCounts.map((tc) => [tc.projectId, tc.count]),
  );

  const enrichedProjects = projects.map((p) => ({
    ...p,
    memberCount: memberCountMap.get(p.id) ?? 0,
    taskGroupCount: taskCountMap.get(p.id) ?? 0,
  }));

  return c.json({ projects: enrichedProjects });
}

export async function getProject(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  const db = c.get("db");

  const [found] = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  if (!found) {
    return errorResponse(c, "Project not found", 404);
  }

  return c.json({ project: found });
}

export async function updateProject(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, updateProjectSchema);

  const db = c.get("db");
  const now = new Date();

  // Capture pre-update state for webhook change detection
  const [beforeUpdate] = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  // Use .returning() to get the updated row in one round-trip instead of update + fetch
  const [updated] = await db
    .update(project)
    .set({ ...body, updatedAt: now })
    .where(eq(project.id, projectId))
    .returning();

  if (!updated) {
    return errorResponse(c, "Project not found", 404);
  }

  // Non-blocking webhook dispatch for project.updated (and project.archived if status changed)
  if (beforeUpdate) {
    const workspaceId = updated.workspaceId;
    const data = buildProjectEventData(updated);
    const changes = computeChanges(beforeUpdate, updated, ["name", "description", "status", "icon", "budget", "autoAssignCreator"]);
    const webhookEvents: Parameters<typeof fireWebhookEvent>[3] = [
      { event: "project.updated", data, changes },
    ];
    if (beforeUpdate.status !== "archived" && updated.status === "archived") {
      webhookEvents.push({ event: "project.archived", data });
    }
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: user.id, projectId }, webhookEvents);
  }

  return c.json({ project: updated });
}

export async function deleteProject(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const projectId = requireParam(c, "projectId");
  const db = c.get("db");

  const [found] = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  if (!found) {
    return errorResponse(c, "Project not found", 404);
  }

  // Batch deletes: tasks first (task.taskGroupId has onDelete:"restrict"),
  // then project. D1 batch executes in order, preserving FK constraint behavior.
  await db.batch([
    db.delete(task).where(eq(task.projectId, projectId)),
    db.delete(project).where(eq(project.id, projectId)),
  ] as const);

  // Non-blocking webhook dispatch for project.deleted (using pre-deletion data)
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId: found.workspaceId, actorId: user.id, projectId }, [
    { event: "project.deleted", data: buildProjectEventData(found) },
  ]);

  return c.json({ ok: true });
}

export async function duplicateProject(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, duplicateProjectSchema);
  const db = c.get("db");

  // Batch-read source project, task groups, labels, and members in one round-trip
  const [sourceResult, sourceGroups, sourceLabels, sourceMembers] = await db.batch([
    db.select().from(project).where(eq(project.id, projectId)).limit(1),
    db.select().from(taskGroup).where(eq(taskGroup.projectId, projectId)),
    db.select().from(label).where(eq(label.projectId, projectId)),
    db.select().from(projectMember).where(eq(projectMember.projectId, projectId)),
  ] as const);

  const source = sourceResult[0];
  if (!source) {
    return errorResponse(c, "Project not found", 404);
  }

  const now = new Date();
  const newProjectId = crypto.randomUUID();

  // Truncate name so "name (copy)" fits within 100 chars
  const suffix = " (copy)";
  const maxBaseLength = 100 - suffix.length;
  const baseName = source.name.length > maxBaseLength
    ? source.name.slice(0, maxBaseLength)
    : source.name;

  const newProject = {
    id: newProjectId,
    workspaceId: source.workspaceId,
    name: baseName + suffix,
    description: source.description,
    icon: source.icon,
    status: "active" as const,
    budget: source.budget,
    theme: source.theme,
    autoAssignCreator: source.autoAssignCreator,
    coverImageKey: null,
    coverImagePosition: null,
    createdAt: now,
    updatedAt: now,
  };

  // Build member records — duplicating user is always admin
  const memberRecords: { id: string; projectId: string; userId: string; role: ProjectRole; addedAt: Date }[] = [];

  if (body.includeMembers) {
    for (const m of sourceMembers) {
      if (m.userId === user.id) continue; // skip — will be added as admin below
      memberRecords.push({
        id: crypto.randomUUID(),
        projectId: newProjectId,
        userId: m.userId,
        role: m.role,
        addedAt: now,
      });
    }
  }

  // Always add duplicating user as admin
  memberRecords.push({
    id: crypto.randomUUID(),
    projectId: newProjectId,
    userId: user.id,
    role: "admin",
    addedAt: now,
  });

  // Build task group records
  const newGroups = sourceGroups.map((g) => ({
    id: crypto.randomUUID(),
    projectId: newProjectId,
    name: g.name,
    color: g.color,
    isCompletionGroup: g.isCompletionGroup,
    position: g.position,
    createdAt: now,
    updatedAt: now,
  }));

  // Build label records
  const newLabels = sourceLabels.map((l) => ({
    id: crypto.randomUUID(),
    projectId: newProjectId,
    name: l.name,
    color: l.color,
    createdAt: now,
  }));

  // Atomic batch write
  const batchOps: BatchItem<"sqlite">[] = [
    db.insert(project).values(newProject),
    db.insert(projectMember).values(memberRecords),
  ];
  if (newGroups.length > 0) batchOps.push(db.insert(taskGroup).values(newGroups));
  if (newLabels.length > 0) batchOps.push(db.insert(label).values(newLabels));
  await db.batch(batchOps as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  // Non-blocking webhook dispatch for project.created
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId: source.workspaceId, actorId: user.id, projectId: newProjectId }, [
    { event: "project.created", data: buildProjectEventData(newProject as Parameters<typeof buildProjectEventData>[0]) },
  ]);

  return c.json({ project: newProject }, 201);
}

export async function listMembers(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  const db = c.get("db");

  const members = await db
    .select({
      id: projectMember.id,
      projectId: projectMember.projectId,
      userId: projectMember.userId,
      role: projectMember.role,
      addedAt: projectMember.addedAt,
      user: {
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        image: userTable.image,
      },
    })
    .from(projectMember)
    .innerJoin(userTable, eq(projectMember.userId, userTable.id))
    .where(eq(projectMember.projectId, projectId));

  return c.json({ members });
}

export async function addMember(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, addProjectMemberSchema);

  const db = c.get("db");

  // Fetch project + check existing membership in a single round-trip
  const [projResult, existingResult] = await db.batch([
    db.select({ name: project.name, workspaceId: project.workspaceId })
      .from(project).where(eq(project.id, projectId)).limit(1),
    db.select().from(projectMember)
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, body.userId)))
      .limit(1),
  ] as const);

  const proj = projResult[0];
  if (!proj) {
    return errorResponse(c, "Project not found", 404);
  }

  // Workspace membership check needs workspaceId from the project query
  const [wsMember] = await db.select().from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, proj.workspaceId), eq(workspaceMember.userId, body.userId)))
    .limit(1);

  if (!wsMember) {
    return errorResponse(c, "User is not a member of the workspace", 400);
  }
  if (existingResult[0]) {
    return errorResponse(c, "User is already a project member", 409);
  }

  const now = new Date();
  const member = {
    id: crypto.randomUUID(),
    projectId,
    userId: body.userId,
    role: body.role,
    addedAt: now,
  };

  await db.batch([
    db.insert(projectMember).values(member),
    db.update(project).set({ updatedAt: now }).where(eq(project.id, projectId)),
  ] as const);

  // Defer notification — runs after response is sent
  deferWork(c, () => createNotification(db, {
    userId: body.userId,
    type: "project_member_added",
    title: `You were added to project "${proj.name}"`,
    actorId: user.id,
    workspaceId: proj.workspaceId,
    projectId,
  }));

  // Non-blocking webhook dispatch for project.member_added
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId: proj.workspaceId, actorId: user.id, projectId }, [
    { event: "project.member_added", data: buildMemberEventData({ userId: body.userId, projectId }, body.role) },
  ]);

  return c.json({ member }, 201);
}

export async function removeMember(c: Context<AppEnv>) {
  const actor = c.get("user")!;
  const { projectId, userId } = requireParams(c, "projectId", "userId");
  const db = c.get("db");

  // Batch independent lookups: member check + project (for webhook workspaceId)
  const [memberResult, projResult] = await db.batch([
    db
      .select()
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, projectId),
          eq(projectMember.userId, userId),
        ),
      )
      .limit(1),
    db
      .select({ workspaceId: project.workspaceId })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1),
  ] as const);

  const member = memberResult[0];

  if (!member) {
    return errorResponse(c, "Member not found", 404);
  }

  const now = new Date();
  await db.batch([
    db.delete(projectMember).where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
      ),
    ),
    db.update(project).set({ updatedAt: now }).where(eq(project.id, projectId)),
  ] as const);

  // Non-blocking webhook dispatch for project.member_removed
  const proj = projResult[0];
  if (proj) {
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: proj.workspaceId, actorId: actor.id, projectId }, [
      { event: "project.member_removed", data: buildMemberEventData({ userId, projectId }, member.role) },
    ]);
  }

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Cover Image Handlers
// ---------------------------------------------------------------------------

export async function uploadProjectCover(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  return handleUploadCover(c, {
    purpose: "project-cover",
    getEntity: async (db) => {
      const [proj] = await db
        .select({ id: project.id, coverImageKey: project.coverImageKey })
        .from(project)
        .where(eq(project.id, projectId))
        .limit(1);
      return proj ?? null;
    },
    setEntityCover: async (db, key, updatedAt) => {
      await db
        .update(project)
        .set({ coverImageKey: key, updatedAt })
        .where(eq(project.id, projectId));
    },
  });
}

export async function deleteProjectCover(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  return handleDeleteCover(c, {
    purpose: "project-cover",
    entityLabel: "project",
    getEntity: async (db) => {
      const [proj] = await db
        .select({ id: project.id, coverImageKey: project.coverImageKey })
        .from(project)
        .where(eq(project.id, projectId))
        .limit(1);
      return proj ?? null;
    },
    setEntityCover: async (db, _key, updatedAt) => {
      await db
        .update(project)
        .set({ coverImageKey: null, updatedAt })
        .where(eq(project.id, projectId));
    },
  });
}
