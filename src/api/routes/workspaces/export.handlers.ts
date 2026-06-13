/**
 * Workspace export endpoint — `GET /api/workspaces/:workspaceId/export`.
 *
 * Produces the canonical, versioned JSON export document defined by
 * `workspaceExportSchema` (src/shared/schemas/workspace-export.ts). The
 * schema is the single source of truth: every builder in this file is
 * TYPED against the schema's inferred types, so a new task/project column
 * that isn't added to the contract is a compile failure here — not silent
 * data loss in someone's archive ("your data is never held hostage" as a
 * type error).
 *
 * Design constraints this implementation answers (full rationale in
 * swarm/plans/workspace-import-export.md, decisions 1, 2 and 4):
 *
 * - **One `db.batch()` of per-table workspace-wide SELECTs.** D1 batches
 *   are a single subrequest, so even a 15-table export costs ~2-3
 *   subrequests total (batch + workspace-row guard + ex-member directory
 *   lookup) — comfortably inside the Free-plan 50/invocation budget that
 *   self-hosters live under.
 *
 * - **Streamed serialization, one project at a time.** A heavy workspace
 *   serializes to tens of MB; the dangerous memory pattern in a 128 MB
 *   Worker isolate is holding the full assembled object graph AND the full
 *   JSON string simultaneously (~3-4x the document size). Instead, the
 *   envelope head is stringified once and each project subtree is built
 *   lazily and stringified individually inside the `ReadableStream`'s
 *   `pull()` — peak memory is the raw rows plus the LARGEST SINGLE
 *   project, and backpressure from the client throttles production. The
 *   output is still exactly one valid JSON document.
 *
 * - **Secrets never serialize.** Webhook rows carry `secret` and
 *   invitation rows carry `token`; the builders project rows down to
 *   exactly the strict-schema fields, and because `exportWebhookSchema` /
 *   `exportInvitationSchema` are `z.strictObject`, a future bug that
 *   spreads a raw DB row into the envelope fails the contract test loudly
 *   instead of leaking quietly.
 *
 * - **The `users` ref directory covers EX-members.** `assigneeId`,
 *   `completedBy`, comment `authorId` and activity `actorId` are
 *   `onDelete: set null` FKs to users who may no longer be workspace
 *   members. Their identities are real workspace data (who did the work),
 *   so every distinct referenced userId is resolved to `{ref, email,
 *   name}` — members via the batch's member+user join, everyone else via
 *   a follow-up lookup. Import later resolves `ref → email → member`.
 *
 * - **Attachments export as manifests** (`key` + authenticated relative
 *   `url`), not binaries — bundling N×10 MB blobs through the isolate
 *   would require job infrastructure the design explicitly avoids.
 *
 * - **Every export is audited** via `recordWorkspaceDataEvent` — a
 *   workspace-wide data egress must answer "who pulled a full copy and
 *   when" after the fact, for cookie sessions and PATs alike.
 */

import { eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";

import type { Database } from "../../../db";
import { user as userTable } from "../../../db/schema/auth";
import { invitation } from "../../../db/schema/invitation";
import { label, taskLabel } from "../../../db/schema/label";
import { project, projectMember } from "../../../db/schema/project";
import { comment, subtask, task, taskActivity, taskGroup } from "../../../db/schema/task";
import { taskAttachment } from "../../../db/schema/task-attachment";
import { team, teamMember } from "../../../db/schema/team";
import { upload } from "../../../db/schema/uploads";
import { webhook } from "../../../db/schema/webhook";
import { workspace, workspaceMember } from "../../../db/schema/workspace";
import { recurrenceRuleSchema } from "../../../shared/schemas/task";
import type {
  ExportedActivity,
  ExportedAttachment,
  ExportedComment,
  ExportedCoverImage,
  ExportedLabel,
  ExportedProject,
  ExportedSubtask,
  ExportedTask,
  ExportedTaskGroup,
  ExportedUser,
  WorkspaceExport,
} from "../../../shared/schemas/workspace-export";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
} from "../../../shared/schemas/workspace-export";
import {
  INVITATION_STATUSES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
} from "../../../shared/types/roles";
import { THEMES } from "../../../shared/types/theme";
import { WEBHOOK_EVENT_TYPES } from "../../../shared/types/webhook";
import type { AppEnv } from "../../env";
import { recordWorkspaceDataEvent } from "../../lib/audit-log";
import { errorResponse } from "../../lib/error-response";
import { requireParam } from "../../lib/params";

// ---------------------------------------------------------------------------
// Plain-text column validators
// ---------------------------------------------------------------------------
//
// Several DB columns are untyped TEXT (`task.priority`, `project.status`,
// `invitation.status`, the theme columns) or TEXT-encoded JSON
// (`task.recurrence_rule`, `webhook.events`). We PARSE them with the same
// enums the contract schema uses rather than casting, so a row that
// somehow carries an out-of-contract value fails the export loudly at the
// offending row instead of producing a file that import will reject with a
// far less actionable error (CLAUDE.md rule 10: never suppress signals).

const taskPriorityValue = z.enum(TASK_PRIORITIES);
const projectStatusValue = z.enum(PROJECT_STATUSES);
const invitationStatusValue = z.enum(INVITATION_STATUSES);
const themeValue = z.enum(THEMES).nullable();
/** `webhook.events` is stored as a TEXT JSON array; the contract expects a
 *  typed event-name array, so decode + validate in one step. */
const webhookEventsValue = z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1);

/** `task.recurrence_rule` is TEXT JSON written exclusively through
 *  `recurrenceRuleSchema`-validated payloads; decoding back through the
 *  same schema keeps the round-trip honest. */
function parseRecurrenceRule(text: string | null): ExportedTask["recurrenceRule"] {
  if (text === null) return null;
  return recurrenceRuleSchema.parse(JSON.parse(text));
}

/**
 * Fold the DB's flat `cover_image_key` / `cover_image_position` pair into
 * the contract's nullable manifest object. The `url` is the instance-
 * relative authenticated serve path — the R2 key format is
 * `purpose/userId/uuid.ext`, which maps 1:1 onto the
 * `GET /api/uploads/:purpose/:userId/:filename` route.
 */
function buildCoverImage(key: string | null, position: number | null): ExportedCoverImage | null {
  if (key === null) return null;
  return { key, url: `/api/uploads/${key}`, position };
}

// ---------------------------------------------------------------------------
// Row collection — one db.batch, grouped in JS
// ---------------------------------------------------------------------------

type WorkspaceRow = typeof workspace.$inferSelect;
/** Flat member+user join projection (the listMembers pattern) — the only
 *  fields the directory and members sections need. */
type MemberJoinRow = {
  userId: string;
  role: typeof workspaceMember.$inferSelect.role;
  joinedAt: Date;
  email: string;
  name: string;
};
type TeamRow = typeof team.$inferSelect;
type TeamMemberRow = typeof teamMember.$inferSelect;
type WebhookRow = typeof webhook.$inferSelect;
type InvitationRow = typeof invitation.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type ProjectMemberRow = typeof projectMember.$inferSelect;
type TaskGroupRow = typeof taskGroup.$inferSelect;
type LabelRow = typeof label.$inferSelect;
type TaskRow = typeof task.$inferSelect;
type SubtaskRow = typeof subtask.$inferSelect;
type CommentRow = typeof comment.$inferSelect;
type TaskLabelRow = typeof taskLabel.$inferSelect;
/** Flat task_attachment+upload join projection (the attachments.handlers.ts
 *  pattern) — exactly the manifest fields plus the grouping key. */
type AttachmentJoinRow = {
  taskId: string;
  filename: string;
  mimeType: string;
  size: number;
  key: string;
};
type TaskActivityRow = typeof taskActivity.$inferSelect;

type ExportRowSets = {
  workspaceRows: WorkspaceRow[];
  memberRows: MemberJoinRow[];
  teamRows: TeamRow[];
  teamMemberRows: TeamMemberRow[];
  webhookRows: WebhookRow[];
  invitationRows: InvitationRow[];
  projectRows: ProjectRow[];
  projectMemberRows: ProjectMemberRow[];
  taskGroupRows: TaskGroupRow[];
  labelRows: LabelRow[];
  taskRows: TaskRow[];
  subtaskRows: SubtaskRow[];
  commentRows: CommentRow[];
  taskLabelRows: TaskLabelRow[];
  attachmentRows: AttachmentJoinRow[];
  activityRows: TaskActivityRow[];
};

/**
 * Run every per-table workspace-wide SELECT in ONE `db.batch()` (a single
 * D1 subrequest and a consistent snapshot — `batch()` executes as one
 * SQLite transaction, so the export can never interleave with a
 * concurrent write and produce a task pointing at a group the file
 * doesn't contain).
 *
 * `task_activity` routinely outnumbers tasks 10-20x, so its SELECT is
 * only added to the batch when the caller opted in via
 * `?includeActivity=true` — the default export stays small and fast.
 *
 * Ordering (`position` for groups/tasks/subtasks, `createdAt` for
 * comments/attachments/activity) makes the document deterministic, which
 * the round-trip property test relies on and which makes diffing two
 * exports of the same workspace meaningful.
 *
 * Scoping uses `inArray(<fk>, <id subquery>)` (the `deleteWorkspace`
 * precedent) and flat join projections (the `listMembers` /
 * `attachments.handlers.ts` precedent) rather than nested table-object
 * selections — the nested form mis-maps columns under the D1 driver in
 * multi-join selects, which the contract test caught as swapped
 * attachment fields.
 */
async function selectExportRows(
  db: Database,
  workspaceId: string,
  includeActivity: boolean,
): Promise<ExportRowSets> {
  // Correlated id sets, inlined as subqueries — no extra round-trips.
  const projectIds = db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.workspaceId, workspaceId));
  const taskIds = db
    .select({ id: task.id })
    .from(task)
    .where(inArray(task.projectId, projectIds));
  const teamIds = db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.workspaceId, workspaceId));

  const qWorkspace = db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const qMembers = db
    .select({
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      joinedAt: workspaceMember.joinedAt,
      email: userTable.email,
      name: userTable.name,
    })
    .from(workspaceMember)
    .innerJoin(userTable, eq(workspaceMember.userId, userTable.id))
    .where(eq(workspaceMember.workspaceId, workspaceId));
  const qTeams = db
    .select()
    .from(team)
    .where(eq(team.workspaceId, workspaceId))
    .orderBy(team.createdAt);
  const qTeamMembers = db
    .select()
    .from(teamMember)
    .where(inArray(teamMember.teamId, teamIds));
  const qWebhooks = db
    .select()
    .from(webhook)
    .where(eq(webhook.workspaceId, workspaceId))
    .orderBy(webhook.createdAt);
  const qInvitations = db
    .select()
    .from(invitation)
    .where(eq(invitation.workspaceId, workspaceId))
    .orderBy(invitation.createdAt);
  const qProjects = db
    .select()
    .from(project)
    .where(eq(project.workspaceId, workspaceId))
    .orderBy(project.createdAt);
  const qProjectMembers = db
    .select()
    .from(projectMember)
    .where(inArray(projectMember.projectId, projectIds));
  const qTaskGroups = db
    .select()
    .from(taskGroup)
    .where(inArray(taskGroup.projectId, projectIds))
    .orderBy(taskGroup.position);
  const qLabels = db
    .select()
    .from(label)
    .where(inArray(label.projectId, projectIds))
    .orderBy(label.createdAt);
  const qTasks = db
    .select()
    .from(task)
    .where(inArray(task.projectId, projectIds))
    .orderBy(task.position);
  const qSubtasks = db
    .select()
    .from(subtask)
    .where(inArray(subtask.taskId, taskIds))
    .orderBy(subtask.position);
  const qComments = db
    .select()
    .from(comment)
    .where(inArray(comment.taskId, taskIds))
    .orderBy(comment.createdAt);
  const qTaskLabels = db
    .select()
    .from(taskLabel)
    .where(inArray(taskLabel.taskId, taskIds));
  const qAttachments = db
    .select({
      taskId: taskAttachment.taskId,
      filename: upload.filename,
      mimeType: upload.mimeType,
      size: upload.size,
      key: upload.key,
    })
    .from(taskAttachment)
    .innerJoin(upload, eq(taskAttachment.uploadId, upload.id))
    .where(inArray(taskAttachment.taskId, taskIds))
    .orderBy(taskAttachment.createdAt);

  if (includeActivity) {
    const qActivity = db
      .select()
      .from(taskActivity)
      .where(inArray(taskActivity.taskId, taskIds))
      .orderBy(taskActivity.createdAt);

    const [
      workspaceRows,
      memberRows,
      teamRows,
      teamMemberRows,
      webhookRows,
      invitationRows,
      projectRows,
      projectMemberRows,
      taskGroupRows,
      labelRows,
      taskRows,
      subtaskRows,
      commentRows,
      taskLabelRows,
      attachmentRows,
      activityRows,
    ] = await db.batch([
      qWorkspace,
      qMembers,
      qTeams,
      qTeamMembers,
      qWebhooks,
      qInvitations,
      qProjects,
      qProjectMembers,
      qTaskGroups,
      qLabels,
      qTasks,
      qSubtasks,
      qComments,
      qTaskLabels,
      qAttachments,
      qActivity,
    ] as const);

    return {
      workspaceRows,
      memberRows,
      teamRows,
      teamMemberRows,
      webhookRows,
      invitationRows,
      projectRows,
      projectMemberRows,
      taskGroupRows,
      labelRows,
      taskRows,
      subtaskRows,
      commentRows,
      taskLabelRows,
      attachmentRows,
      activityRows,
    };
  }

  const [
    workspaceRows,
    memberRows,
    teamRows,
    teamMemberRows,
    webhookRows,
    invitationRows,
    projectRows,
    projectMemberRows,
    taskGroupRows,
    labelRows,
    taskRows,
    subtaskRows,
    commentRows,
    taskLabelRows,
    attachmentRows,
  ] = await db.batch([
    qWorkspace,
    qMembers,
    qTeams,
    qTeamMembers,
    qWebhooks,
    qInvitations,
    qProjects,
    qProjectMembers,
    qTaskGroups,
    qLabels,
    qTasks,
    qSubtasks,
    qComments,
    qTaskLabels,
    qAttachments,
  ] as const);

  const activityRows: TaskActivityRow[] = [];

  return {
    workspaceRows,
    memberRows,
    teamRows,
    teamMemberRows,
    webhookRows,
    invitationRows,
    projectRows,
    projectMemberRows,
    taskGroupRows,
    labelRows,
    taskRows,
    subtaskRows,
    commentRows,
    taskLabelRows,
    attachmentRows,
    activityRows,
  };
}

// ---------------------------------------------------------------------------
// User ref directory
// ---------------------------------------------------------------------------

/**
 * D1 caps bound parameters at 100 per statement; chunking the ex-member
 * id list keeps the directory lookup correct for pathological archives
 * (>90 distinct departed users) instead of failing the whole export. In
 * the overwhelmingly common case this is exactly one SELECT.
 */
const USER_LOOKUP_CHUNK = 90;

/**
 * Build the top-level `users` ref directory: every current member (email
 * and name already joined in the batch) plus every userId referenced by
 * project/team membership, task assignee/completedBy, comment author or
 * activity actor that is NOT a current member. Those references are
 * `onDelete: set null` FKs, so a non-null id is guaranteed to still
 * resolve in the `user` table even after the human left the workspace —
 * and their identity must stay in the archive, because "who did this
 * work" is workspace data, not membership data.
 */
async function buildUserDirectory(db: Database, rows: ExportRowSets): Promise<ExportedUser[]> {
  const memberIds = new Set<string>(rows.memberRows.map((m) => m.userId));

  const referenced = new Set<string>();
  const reference = (id: string | null) => {
    if (id !== null && !memberIds.has(id)) referenced.add(id);
  };

  for (const m of rows.teamMemberRows) reference(m.userId);
  for (const m of rows.projectMemberRows) reference(m.userId);
  for (const t of rows.taskRows) {
    reference(t.assigneeId);
    reference(t.completedBy);
  }
  for (const cm of rows.commentRows) reference(cm.authorId);
  for (const a of rows.activityRows) reference(a.actorId);

  const users: ExportedUser[] = rows.memberRows.map((m) => ({
    ref: m.userId,
    email: m.email,
    name: m.name,
  }));

  const missing = [...referenced];
  for (let i = 0; i < missing.length; i += USER_LOOKUP_CHUNK) {
    const chunk = missing.slice(i, i + USER_LOOKUP_CHUNK);
    const found = await db
      .select({ id: userTable.id, email: userTable.email, name: userTable.name })
      .from(userTable)
      .where(inArray(userTable.id, chunk));
    for (const u of found) {
      users.push({ ref: u.id, email: u.email, name: u.name });
    }
  }

  return users;
}

// ---------------------------------------------------------------------------
// Envelope builders — typed by the contract schema
// ---------------------------------------------------------------------------

/**
 * Everything in the document EXCEPT `projects`, which is streamed
 * separately (see module JSDoc). Typed as `Omit<WorkspaceExport,
 * "projects">` so head fields stay pinned to the contract at compile time
 * even though the full envelope object never exists in memory at once.
 */
type ExportEnvelopeHead = Omit<WorkspaceExport, "projects">;

function buildEnvelopeHead(
  ws: WorkspaceRow,
  rows: ExportRowSets,
  users: ExportedUser[],
  exportedBy: string,
  exportedAt: Date,
): ExportEnvelopeHead {
  const teamMembersByTeam = groupBy(rows.teamMemberRows, (m) => m.teamId);

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    exportedBy,
    workspace: {
      name: ws.name,
      slug: ws.slug,
      description: ws.description,
      theme: themeValue.parse(ws.theme),
    },
    users,
    members: rows.memberRows.map((m) => ({
      userRef: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
    teams: rows.teamRows.map((t) => ({
      name: t.name,
      description: t.description,
      members: (teamMembersByTeam.get(t.id) ?? []).map((m) => ({
        userRef: m.userId,
        role: m.role,
      })),
    })),
    // Projected down to EXACTLY the strict-schema fields — `secret`,
    // `consecutiveFailures` and the rest of the raw row must never reach
    // the serializer (the strict schema turns a violation into a loud
    // contract-test failure rather than a silent strip).
    webhooks: rows.webhookRows.map((w) => ({
      name: w.name,
      url: w.url,
      events: webhookEventsValue.parse(JSON.parse(w.events)),
      active: w.active,
      projectId: w.projectId,
    })),
    // Same strict projection: `token` (the secret acceptance credential)
    // and its lifetime fields are deliberately absent.
    invitations: rows.invitationRows.map((i) => ({
      email: i.email,
      role: i.role,
      status: invitationStatusValue.parse(i.status),
    })),
  };
}

/**
 * Pre-grouped row indexes shared by every per-project builder. Building
 * the maps ONCE is what keeps the streamed serialization O(rows) instead
 * of O(projects x rows) — each project's `pull()` does pure map lookups.
 */
type ProjectBuildContext = {
  includeActivity: boolean;
  membersByProject: Map<string, ProjectMemberRow[]>;
  groupsByProject: Map<string, TaskGroupRow[]>;
  labelsByProject: Map<string, LabelRow[]>;
  tasksByProject: Map<string, TaskRow[]>;
  labelIdsByTask: Map<string, TaskLabelRow[]>;
  subtasksByTask: Map<string, SubtaskRow[]>;
  commentsByTask: Map<string, CommentRow[]>;
  attachmentsByTask: Map<string, AttachmentJoinRow[]>;
  activityByTask: Map<string, TaskActivityRow[]>;
};

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

function buildProjectContext(rows: ExportRowSets, includeActivity: boolean): ProjectBuildContext {
  return {
    includeActivity,
    membersByProject: groupBy(rows.projectMemberRows, (m) => m.projectId),
    groupsByProject: groupBy(rows.taskGroupRows, (g) => g.projectId),
    labelsByProject: groupBy(rows.labelRows, (l) => l.projectId),
    tasksByProject: groupBy(rows.taskRows, (t) => t.projectId),
    labelIdsByTask: groupBy(rows.taskLabelRows, (tl) => tl.taskId),
    subtasksByTask: groupBy(rows.subtaskRows, (s) => s.taskId),
    commentsByTask: groupBy(rows.commentRows, (c) => c.taskId),
    attachmentsByTask: groupBy(rows.attachmentRows, (a) => a.taskId),
    activityByTask: groupBy(rows.activityRows, (a) => a.taskId),
  };
}

function buildSubtask(row: SubtaskRow): ExportedSubtask {
  return {
    title: row.title,
    completed: row.completed,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildComment(row: CommentRow): ExportedComment {
  return {
    body: row.body,
    authorRef: row.authorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Manifest entry only — the binary stays in the source instance's R2;
 *  `url` is the authenticated download path (see module JSDoc). */
function buildAttachment(row: AttachmentJoinRow): ExportedAttachment {
  return {
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    key: row.key,
    url: `/api/uploads/${row.key}`,
  };
}

function buildActivity(row: TaskActivityRow): ExportedActivity {
  return {
    actorRef: row.actorId,
    action: row.action,
    field: row.field,
    oldValue: row.oldValue,
    newValue: row.newValue,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildTask(row: TaskRow, ctx: ProjectBuildContext): ExportedTask {
  const base: ExportedTask = {
    id: row.id,
    taskGroupId: row.taskGroupId,
    title: row.title,
    description: row.description,
    assigneeRef: row.assigneeId,
    priority: taskPriorityValue.parse(row.priority),
    completed: row.completed,
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    completedByRef: row.completedBy,
    startDate: row.startDate === null ? null : row.startDate.toISOString(),
    dueDate: row.dueDate === null ? null : row.dueDate.toISOString(),
    cost: row.cost,
    icon: row.icon,
    coverImage: buildCoverImage(row.coverImageKey, row.coverImagePosition),
    coverUnsplash: row.coverUnsplash,
    recurrenceRule: parseRecurrenceRule(row.recurrenceRule),
    recurrenceParentId: row.recurrenceParentId,
    recurrenceSeriesId: row.recurrenceSeriesId,
    sourceUid: row.sourceUid,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    labelIds: (ctx.labelIdsByTask.get(row.id) ?? []).map((tl) => tl.labelId),
    subtasks: (ctx.subtasksByTask.get(row.id) ?? []).map(buildSubtask),
    comments: (ctx.commentsByTask.get(row.id) ?? []).map(buildComment),
    attachments: (ctx.attachmentsByTask.get(row.id) ?? []).map(buildAttachment),
  };

  // `activity` is OMITTED (not an empty array) when the caller didn't opt
  // in — the contract marks it `.optional()` and consumers distinguish
  // "exported without history" from "task has no history".
  if (ctx.includeActivity) {
    base.activity = (ctx.activityByTask.get(row.id) ?? []).map(buildActivity);
  }

  return base;
}

function buildTaskGroup(row: TaskGroupRow): ExportedTaskGroup {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isCompletionGroup: row.isCompletionGroup,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildLabel(row: LabelRow): ExportedLabel {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildProject(row: ProjectRow, ctx: ProjectBuildContext): ExportedProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: projectStatusValue.parse(row.status),
    icon: row.icon,
    coverImage: buildCoverImage(row.coverImageKey, row.coverImagePosition),
    coverUnsplash: row.coverUnsplash,
    theme: themeValue.parse(row.theme),
    budget: row.budget,
    autoAssignCreator: row.autoAssignCreator,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    members: (ctx.membersByProject.get(row.id) ?? []).map((m) => ({
      userRef: m.userId,
      role: m.role,
    })),
    taskGroups: (ctx.groupsByProject.get(row.id) ?? []).map(buildTaskGroup),
    labels: (ctx.labelsByProject.get(row.id) ?? []).map(buildLabel),
    tasks: (ctx.tasksByProject.get(row.id) ?? []).map((t) => buildTask(t, ctx)),
  };
}

// ---------------------------------------------------------------------------
// Streamed serialization
// ---------------------------------------------------------------------------

/**
 * Serialize the envelope as ONE valid JSON document, emitted in chunks:
 * the head (everything but `projects`) is stringified once and spliced
 * open before its closing brace, then each project is BUILT AND
 * STRINGIFIED LAZILY inside `pull()`, then the document is closed.
 *
 * Why `pull()` and not enqueue-everything-in-`start()`: pull-based
 * production is driven by consumer backpressure, so at no point do the
 * full object graph and the full serialized string coexist — peak memory
 * is the raw rows plus one project's subtree (the entire reason decision
 * 1 chose streamed-single-document over a buffered response). Each
 * project's assembled object becomes garbage as soon as its chunk is
 * enqueued.
 */
function buildExportStream(
  head: ExportEnvelopeHead,
  projectBuilders: Array<() => ExportedProject>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // headJson is a non-empty JSON object literal (format/formatVersion are
  // always present), so slicing off its final "}" and appending the
  // projects array opener yields a prefix of a valid JSON document.
  const headJson = JSON.stringify(head);
  let emittedHead = false;
  let nextProject = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!emittedHead) {
        emittedHead = true;
        controller.enqueue(encoder.encode(`${headJson.slice(0, -1)},"projects":[`));
        return;
      }
      const build = projectBuilders[nextProject];
      if (build) {
        const projectJson = JSON.stringify(build());
        controller.enqueue(
          encoder.encode(nextProject === 0 ? projectJson : `,${projectJson}`),
        );
        nextProject += 1;
        return;
      }
      controller.enqueue(encoder.encode("]}"));
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * `GET /api/workspaces/:workspaceId/export[?includeActivity=true]`
 *
 * Synchronous (no job infra — see plan decision 4: response size is
 * unenforced on Workers, memory is bounded by per-project streaming, and
 * the whole read is ~2-3 subrequests). Route-level guards (wired in
 * workspaces.routes.ts): `requireAuth` + `requireWorkspaceRole("owner",
 * "admin")` + 5/hour rate limit — a workspace-wide egress is deliberately
 * the most-restricted read in the API.
 */
export async function exportWorkspace(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");

  const includeActivityParam = c.req.query("includeActivity");
  const includeActivity = includeActivityParam === "1" || includeActivityParam === "true";

  const rows = await selectExportRows(db, workspaceId, includeActivity);
  const ws = rows.workspaceRows[0];
  if (!ws) {
    return errorResponse(c, "Workspace not found", 404);
  }

  const users = await buildUserDirectory(db, rows);

  const exportedAt = new Date();
  const head = buildEnvelopeHead(ws, rows, users, user.email, exportedAt);
  const ctx = buildProjectContext(rows, includeActivity);
  const projectBuilders = rows.projectRows.map((p) => () => buildProject(p, ctx));

  // Audit BEFORE handing the stream to the client: the egress decision is
  // already made, and deferWork keeps the insert off the response path.
  recordWorkspaceDataEvent(c, {
    workspaceId,
    actorUserId: user.id,
    action: "export",
    metadata: {
      includeActivity,
      projects: rows.projectRows.length,
      tasks: rows.taskRows.length,
    },
  });

  // slug is constrained to /^[a-z0-9-]+$/ at every write path, so it is
  // header-safe by construction (no quoting/injection hazard).
  const datePart = exportedAt.toISOString().slice(0, 10);
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${ws.slug}-export-${datePart}.json"`,
  );
  return c.body(buildExportStream(head, projectBuilders));
}
