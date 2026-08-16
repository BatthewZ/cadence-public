import { and, asc, count, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Context } from "hono";

import type { Database } from "../../../db";
import { user as userTable } from "../../../db/schema/auth";
import { label } from "../../../db/schema/label";
import { project, projectMember } from "../../../db/schema/project";
import { task, taskGroup } from "../../../db/schema/task";
import { webhook } from "../../../db/schema/webhook";
import { workspaceMember } from "../../../db/schema/workspace";
import { generateKeyBetween, generateNKeysBetween } from "../../../shared/lib/fractional-index";
import { addProjectMemberSchema, createProjectSchema, duplicateProjectSchema, reorderProjectSchema, updateProjectMemberRoleSchema, updateProjectSchema } from "../../../shared/schemas/project";
import type { ProjectRole } from "../../../shared/types/roles";
import type { AppEnv } from "../../env";
import { resolveProjectAccess } from "../../lib/access";
import type { CoverSourceUpdate } from "../../lib/cover-image";
import { handleApplyUnsplashCover, handleDeleteCover, handleUploadCover } from "../../lib/cover-image";
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
  resolveUser,
} from "../../lib/webhook-payloads";
import { tokenProjectScopeFilter } from "../../middleware/authorize";

/**
 * Of `userIds`, which are still members of `workspaceId`?
 *
 * This is the single authority behind every path that creates a
 * `project_member` row for someone other than the caller — `addMember` and
 * `duplicateProject`. It exists as one function rather than two open-coded
 * queries because the two paths MUST NOT drift: a `project_member` row whose
 * user has no `workspace_member` row is an ORPHAN, and `resolveProjectAccess`
 * deliberately grants it nothing. Creating one is therefore never correct, and
 * a future qualification on membership (a `deactivated` flag, say) has to
 * change the rule in exactly one place or the two paths will disagree about who
 * may be added to a project.
 *
 * Scoped by `userIds` rather than "all members of the workspace" so the cost is
 * proportional to the request, not to the size of the workspace.
 */
async function selectWorkspaceMemberIds(
  db: Database,
  workspaceId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        inArray(workspaceMember.userId, userIds),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/** Shared orderBy for position-aware project listing: positioned first, then by createdAt. */
const projectPositionOrder = [
  sql`CASE WHEN ${project.position} IS NULL THEN 1 ELSE 0 END`,
  asc(project.position),
  asc(project.createdAt),
] as const;

/** Fetch the last fractional-index position for a workspace and generate the next one. */
async function getNextProjectPosition(db: Database, workspaceId: string): Promise<string> {
  const [last] = await db
    .select({ position: project.position })
    .from(project)
    .where(eq(project.workspaceId, workspaceId))
    .orderBy(desc(project.position))
    .limit(1);
  return generateKeyBetween(last?.position ?? null, null);
}

export async function createProject(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createProjectSchema);

  const db = c.get("db");
  const now = new Date();
  const projectId = crypto.randomUUID();

  const position = await getNextProjectPosition(db, workspaceId);

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
    position,
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

/**
 * `GET /workspaces/:workspaceId/projects`
 *
 * Lists the projects in a workspace the caller can see, enriched with member
 * and task-group counts, and lazily backfills fractional-index positions for
 * rows created before positions existed.
 *
 * Visibility is the intersection of two rules. The human rule: owners/admins
 * see every project in the workspace, plain members only those they belong to.
 * The token rule (`tokenProjectScopeFilter`): a PAT with
 * `projectScope: "selected"` sees only the projects on its list. The token
 * rule is applied in SQL, before the position backfill, so a narrowed token
 * can neither read nor write-back positions for a project it was denied.
 *
 * This is the endpoint that decides what a narrowed integration believes the
 * workspace contains, so leaving it unfiltered would have leaked project
 * names, descriptions, icons and budgets for exactly the projects the operator
 * deliberately withheld. Both rules are no-ops for a cookie session, which is
 * how the web UI keeps seeing everything its user is entitled to.
 */
export async function listProjects(c: Context<AppEnv>) {
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const db = c.get("db");
  const isElevated = membership.role === "owner" || membership.role === "admin";
  const inWorkspace = and(
    eq(project.workspaceId, workspaceId),
    tokenProjectScopeFilter(c, project.id),
  );

  // For non-elevated members, restrict to projects they belong to
  const projects = isElevated
    ? await db
        .select()
        .from(project)
        .where(inWorkspace)
        .orderBy(...projectPositionOrder)
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
        .where(inWorkspace)
        .orderBy(...projectPositionOrder);

  // Lazy backfill: assign positions to projects that don't have one yet
  const unpositioned = projects.filter(p => !p.position);
  if (unpositioned.length > 0) {
    const positioned = projects.filter(p => p.position);
    const lastPosition = positioned.length > 0
      ? positioned.sort((a, b) => (a.position! > b.position! ? 1 : -1)).at(-1)!.position
      : null;
    unpositioned.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const newPositions = generateNKeysBetween(lastPosition, null, unpositioned.length);
    const updates = unpositioned.map((p, i) =>
      db.update(project).set({ position: newPositions[i] }).where(eq(project.id, p.id))
    );
    await db.batch(updates as [typeof updates[0], ...typeof updates]);
    for (let i = 0; i < unpositioned.length; i++) {
      Object.assign(unpositioned[i], { position: newPositions[i] });
    }
  }

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

  // Field-by-field rather than `...body`: a blind spread makes the set of
  // writable columns invisible at the write site, which is how `coverImageKey`
  // became client-writable. `serveUpload` authorizes a `project-cover` download
  // by matching the requested R2 key against `project.cover_image_key`, so a
  // client that can write that column can point its own project at another
  // workspace's object and read it through its own access. Both cover SOURCE
  // columns (`coverImageKey`, `coverUnsplash`) are absent here and must stay
  // absent. `api/lib/cover-image.ts` is the only writer of a NON-NULL
  // `coverImageKey` anywhere in the API, and the key it writes is one the server
  // just minted for the caller's own upload — that is what makes the download
  // check an authorization check. (The workspace importer also writes
  // `coverUnsplash` from an uploaded export; that column holds absolute Unsplash
  // URLs rather than a key into our storage, so it grants no read capability,
  // and the importer nulls `coverImageKey` alongside it so XOR still holds.)
  // `coverImagePosition` is a framing offset with no authorization meaning, so
  // it stays patchable.
  const updateData = {
    updatedAt: now,
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.status !== undefined && { status: body.status }),
    ...(body.icon !== undefined && { icon: body.icon }),
    ...(body.coverImagePosition !== undefined && { coverImagePosition: body.coverImagePosition }),
    ...(body.theme !== undefined && { theme: body.theme }),
    ...(body.budget !== undefined && { budget: body.budget }),
    ...(body.autoAssignCreator !== undefined && { autoAssignCreator: body.autoAssignCreator }),
  };

  // Use .returning() to get the updated row in one round-trip instead of update + fetch
  const [updated] = await db
    .update(project)
    .set(updateData)
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

    // Archiving a project makes its project-scoped webhooks obsolete — delete them.
    // Workspace-scoped webhooks still receive the project.archived event above.
    if (beforeUpdate.status !== "archived" && updated.status === "archived") {
      await db.delete(webhook).where(eq(webhook.projectId, projectId));
    }
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

export async function reorderProject(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, reorderProjectSchema);
  const now = new Date();

  const [updated] = await db
    .update(project)
    .set({ position: body.position, updatedAt: now })
    .where(eq(project.id, projectId))
    .returning();

  if (!updated) {
    return errorResponse(c, "Project not found", 404);
  }

  return c.json({ project: updated });
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

  const dupPosition = await getNextProjectPosition(db, source.workspaceId);

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
    coverUnsplash: null,
    position: dupPosition,
    createdAt: now,
    updatedAt: now,
  };

  // Build member records — duplicating user is always admin
  const memberRecords: { id: string; projectId: string; userId: string; role: ProjectRole; addedAt: Date }[] = [];

  // Source members who were dropped because they are no longer workspace
  // members. Returned to the caller so the omission is visible (see below).
  const skippedMemberIds: string[] = [];

  if (body.includeMembers) {
    // -----------------------------------------------------------------------
    // Copying `project_member` rows verbatim would propagate ORPHANED rows:
    // when a user is removed from the workspace their `project_member` rows are
    // left behind, and an orphaned row confers no access on its own — but
    // duplicating one mints a FRESH row on a new project, spreading the stale
    // state and re-arming the class of bug that treating those rows as
    // authoritative would reopen. `addMember` already refuses to create a
    // `project_member` row for a non-workspace-member ("User is not a member of
    // the workspace", 400); duplication is the same write and applies the same
    // rule through the same helper (`selectWorkspaceMemberIds`) so the two can
    // never drift. Workspace owners are safe because workspace creation always
    // inserts an owner `workspace_member` row in the same batch as the
    // workspace itself (workspaces.handlers.ts), and it can neither be removed
    // nor demoted.
    //
    // Skip rather than refuse: a member leaving the workspace is routine and
    // invisible to the person clicking Duplicate, so a 400 would permanently
    // brick duplication of any project that ever had someone leave — a hygiene
    // fix causing a functionality outage. Instead the stale members are dropped
    // and reported in `skippedMemberIds` on the 201 so the caller can surface
    // "N members were not copied" rather than silently losing them.
    // -----------------------------------------------------------------------
    const workspaceMemberIds = await selectWorkspaceMemberIds(
      db,
      source.workspaceId,
      sourceMembers.map((m) => m.userId),
    );

    for (const m of sourceMembers) {
      if (m.userId === user.id) continue; // skip — will be added as admin below
      if (!workspaceMemberIds.has(m.userId)) {
        skippedMemberIds.push(m.userId);
        continue;
      }
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

  // `skippedMemberIds` is always present (empty on a clean duplicate) so clients
  // can branch on `.length` without probing for the field. It exists so dropping
  // an offboarded member from the copy is visible rather than silent.
  return c.json({ project: newProject, skippedMemberIds }, 201);
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

  // Workspace membership check needs workspaceId from the project query.
  // Shares `selectWorkspaceMemberIds` with `duplicateProject` so both paths that
  // create a `project_member` row for another user apply one identical rule —
  // an orphaned membership row grants nothing, so minting one is never correct.
  const wsMemberIds = await selectWorkspaceMemberIds(db, proj.workspaceId, [body.userId]);

  if (!wsMemberIds.has(body.userId)) {
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
  const addedUser = await resolveUser(db, body.userId);
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId: proj.workspaceId, actorId: user.id, projectId }, [
    { event: "project.member_added", data: buildMemberEventData({ userId: body.userId, projectId }, body.role, addedUser) },
  ]);

  return c.json({ member }, 201);
}

/**
 * Change an existing project member's role.
 *
 * ## Why project governance is flatter than workspace governance
 *
 * The workspace equivalent (`updateMemberRole` in `workspaces.handlers.ts`)
 * runs every action through a rank hierarchy: only someone strictly senior may
 * re-role a target, and minting an admin is owner-only. That machinery exists
 * because a workspace admin tier is self-sustaining — an admin who could
 * promote peers could manufacture accomplices immune to every other admin, with
 * no owner able to be involved.
 *
 * Projects are not that shape and deliberately do not copy it:
 *
 * - There is no `owner` project role, so a rank rule would have to treat two
 *   admins as peers, and strict-rank peers cannot act on each other. That would
 *   leave this endpoint *stricter than the delete next to it*: an admin barred
 *   from demoting a peer admin could simply remove them from the project
 *   entirely, which `removeMember` has always allowed. A rule that is trivially
 *   routed around by an adjacent endpoint is not a rule, and the inconsistency
 *   would be the thing people actually hit.
 * - Project admin is never a terminal authority. `resolveProjectAccess` elevates
 *   every workspace owner/admin to project `admin` (`source: "workspace"`), so
 *   any damage done here is always repairable from above — unlike a workspace
 *   whose admin tier really can be captured.
 *
 * So the gate is exactly the gate on the rest of project member management:
 * `requireProjectRole("admin")`. If projects ever grow an owner tier, the rank
 * table belongs in a `project-roles.ts` alongside `workspace-roles.ts`, applied
 * to this handler AND to `removeMember` in the same change.
 *
 * ## What IS refused
 *
 * Changing your own role, which is the one move whose damage is not repairable
 * by the person making it. A project admin who is only a plain workspace member
 * holds no elevation to fall back on: demoting their own row to `viewer` drops
 * them out of the project settings page that submitted the request, and the undo
 * requires someone else. The workspace hierarchy refuses self-role-change for
 * the same reason (see `outranks` in `api/lib/workspace-roles.ts`, which is
 * strict `>` precisely so that self-action is impossible), so the two scopes
 * agree on the one rule where a disagreement would surprise.
 */
export async function updateMemberRole(c: Context<AppEnv>) {
  const actor = c.get("user")!;
  const { projectId, userId: targetUserId } = requireParams(c, "projectId", "userId");
  const { role } = validJson(c, updateProjectMemberRoleSchema);
  const db = c.get("db");

  // Fail closed on the actor's own authority before reading anything about the
  // target, and decide it here rather than trusting that a middleware ran.
  // `requireProjectRole("admin")` mounts on this route and caches its answer,
  // so on every real request this is the cached value and costs nothing; the
  // `resolveProjectAccess` fallback is what stops a future route edit that drops
  // the middleware from turning this into an open endpoint. Same instinct as the
  // workspace handler's leading `if (!actor)` — a decision this consequential
  // must not depend on a mount elsewhere in the file.
  const access =
    c.get("projectAccess") ?? (await resolveProjectAccess(db, projectId, actor.id));
  if (!access || access.role !== "admin") {
    return errorResponse(c, "Forbidden", 403);
  }

  if (targetUserId === actor.id) {
    return errorResponse(c, "You cannot change your own project role", 403);
  }

  // Batch independent lookups: the target's membership row + the project (for
  // the webhook's workspaceId), mirroring `removeMember`.
  const [memberResult, projResult] = await db.batch([
    db
      .select()
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, projectId),
          eq(projectMember.userId, targetUserId),
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

  // A workspace owner/admin with no `project_member` row has an *effective*
  // project role but no row to edit, and lands here as a 404 — correct, because
  // their elevation comes from the workspace roster and is changed there.
  if (!member) {
    return errorResponse(c, "Member not found", 404);
  }

  const oldRole = member.role;

  // Submitting the role the member already has is a no-op, not a change. The
  // dialog pre-selects the current role, so "open the menu, look, press Update"
  // is a normal thing for a human to do — and it must not emit a
  // `member_role_changed` webhook whose `from` equals its `to`, which would
  // teach every integration downstream to filter our events for us. Returning
  // 200 with the unchanged row keeps the client's success path intact.
  if (oldRole === role) {
    return c.json({ member });
  }

  // `role = oldRole` pins the write to the row the checks above were made
  // against, so a concurrent change is a reportable conflict rather than a
  // silent overwrite: if another admin re-roles this member between our read
  // and this write, the update matches zero rows and the caller is told their
  // view was stale instead of having their stale choice win. Not batched with
  // the `updatedAt` bump below because that decision needs this result.
  const [updated] = await db
    .update(projectMember)
    .set({ role })
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, targetUserId),
        eq(projectMember.role, oldRole),
      ),
    )
    .returning();

  if (!updated) {
    return errorResponse(
      c,
      "This member's role changed while you were editing. Please retry.",
      409,
    );
  }

  await db
    .update(project)
    .set({ updatedAt: new Date() })
    .where(eq(project.id, projectId));

  // Non-blocking webhook dispatch for project.member_role_changed
  const proj = projResult[0];
  if (proj) {
    const roleChangedUser = await resolveUser(db, targetUserId);
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: proj.workspaceId, actorId: actor.id, projectId }, [
      { event: "project.member_role_changed", data: buildMemberEventData({ userId: targetUserId, projectId }, role, roleChangedUser), changes: { role: { from: oldRole, to: role } } },
    ]);
  }

  return c.json({ member: updated });
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
    const removedUser = await resolveUser(db, userId);
    fireWebhookEvent(db, () => c.executionCtx, { workspaceId: proj.workspaceId, actorId: actor.id, projectId }, [
      { event: "project.member_removed", data: buildMemberEventData({ userId, projectId }, member.role, removedUser) },
    ]);
  }

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Cover Image Handlers
// ---------------------------------------------------------------------------

/**
 * Select both cover-source columns for a project. Callers use this to detect
 * which cover source (R2 or Unsplash) is currently set so they can clean up
 * the appropriate artifact when swapping sources. See XOR invariant in
 * `src/api/lib/cover-image.ts`.
 */
async function selectProjectCoverEntity(db: Database, projectId: string) {
  const [proj] = await db
    .select({
      id: project.id,
      coverImageKey: project.coverImageKey,
      coverUnsplash: project.coverUnsplash,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return proj ?? null;
}

/**
 * Atomically write both cover-source columns for a project. Always pass BOTH
 * fields to preserve the XOR invariant documented in `lib/cover-image.ts`.
 */
async function writeProjectCover(
  db: Database,
  projectId: string,
  cover: CoverSourceUpdate,
  updatedAt: Date,
) {
  await db
    .update(project)
    .set({ ...cover, updatedAt })
    .where(eq(project.id, projectId));
}

export async function uploadProjectCover(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  return handleUploadCover(c, {
    purpose: "project-cover",
    getEntity: (db) => selectProjectCoverEntity(db, projectId),
    setEntityCover: (db, cover, updatedAt) => writeProjectCover(db, projectId, cover, updatedAt),
  });
}

export async function applyProjectUnsplashCover(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  return handleApplyUnsplashCover(c, {
    purpose: "project-cover",
    getEntity: (db) => selectProjectCoverEntity(db, projectId),
    setEntityCover: (db, cover, updatedAt) => writeProjectCover(db, projectId, cover, updatedAt),
  });
}

export async function deleteProjectCover(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  return handleDeleteCover(c, {
    purpose: "project-cover",
    entityLabel: "project",
    getEntity: (db) => selectProjectCoverEntity(db, projectId),
    setEntityCover: (db, cover, updatedAt) => writeProjectCover(db, projectId, cover, updatedAt),
  });
}
