import { desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Database } from "../../../../db";
import { user } from "../../../../db/schema/auth";
import { label, taskLabel } from "../../../../db/schema/label";
import { project, projectMember } from "../../../../db/schema/project";
import { comment, subtask, task, taskGroup } from "../../../../db/schema/task";
import { workspaceMember } from "../../../../db/schema/workspace";
import { generateNKeysBetween } from "../../../../shared/lib/fractional-index";
import type {
  ExportedProject,
} from "../../../../shared/schemas/workspace-export";
import type {
  ImportCounts,
  ImportDocument,
  ImportFailedProject,
  ImportUnmatchedUser,
} from "../../../../shared/schemas/workspace-import";

/**
 * Import executor: writes a validated {@link ImportDocument} into the target
 * workspace as NEW projects (plan design decision 5 — import never touches
 * existing content, so it is collision-free by construction).
 *
 * The invariants this module exists to hold, and WHY:
 *
 * - **Member-only user matching (security).** File `ref` → directory email →
 *   user is resolved ONLY against the target workspace's members
 *   ({@link resolveUserMap}). Matching arbitrary platform users by email
 *   would both leak account existence (an importer could probe "does
 *   x@y.com have an account?" by watching whether a task gets assigned) and
 *   grant content references to people who never joined the workspace.
 *   Unmatched refs fall back to `null` — every referencing column
 *   (`assigneeId`, `completedBy`, `authorId`) is nullable by design.
 *
 * - **Param-derived chunk math (D1 correctness).** D1 hard-caps statements
 *   at 100 bound parameters. Rows per INSERT is computed as
 *   `floor(90 / Object.keys(row).length)` from the ACTUAL row object —
 *   never a hand-written column-count constant, because adding one column
 *   to a table silently invalidates a constant and the failure only shows
 *   up in production-size imports (this exact bug shipped during the
 *   calendar plan; the derived math is the proven mitigation).
 *
 * - **All-or-nothing per project (compensating delete).** Each project's
 *   graph spans multiple sequential `db.batch()` calls (each batch is one
 *   atomic D1 transaction, but the sequence is not). On any mid-project
 *   failure the partial graph is removed with `DELETE task WHERE projectId`
 *   **then** `DELETE project` — exactly the order `deleteProject` uses,
 *   because `task.taskGroupId` is `onDelete: restrict` (deleting the
 *   project first would cascade `task_group` into restricted tasks and
 *   fail). Everything else hangs off those two: `subtask`/`comment`/
 *   `task_label` cascade from `task`; `task_group`/`label`/`project_member`
 *   cascade from `project` (verified against `src/db/schema/`). The failed
 *   project is reported and the remaining projects still import.
 */

/**
 * Conservative bound-parameter budget per INSERT statement. D1's hard limit
 * is 100; 90 leaves headroom so the math never sits exactly on the cliff.
 */
export const D1_SAFE_BOUND_PARAMS = 90;

/**
 * Statements per `db.batch()` call. D1 documents no per-batch statement
 * ceiling; rather than bet on an undocumented limit, batches are capped at
 * 100 statements and run sequentially (the compensating delete closes the
 * atomicity gap between them).
 */
export const MAX_STATEMENTS_PER_BATCH = 100;

/** What `executeImport` returns; the HTTP handler adds `dryRun`,
 *  `sourceFormat` and the parse-stage `skipped` ledger to complete an
 *  `ImportResult`. */
export interface ImportExecutionReport {
  counts: ImportCounts;
  unmatchedUsers: ImportUnmatchedUser[];
  failedProjects: ImportFailedProject[];
  warnings: string[];
}

/** What `previewImport` returns (dry run — zero writes). */
export interface ImportPreviewReport {
  counts: ImportCounts;
  unmatchedUsers: ImportUnmatchedUser[];
  warnings: string[];
}

/** Resolution of the file's user directory against the target workspace. */
export interface ResolvedUsers {
  /** File `ref` → target workspace member userId. Refs absent here resolve
   *  to `null` on every referencing column. */
  refToUserId: Map<string, string>;
  /** Directory entries with no member match, with the distinct-task counts
   *  the preview UI needs ("invite them first, or import anyway?"). */
  unmatchedUsers: ImportUnmatchedUser[];
}

/**
 * Resolve the file's `users` directory against the TARGET workspace's
 * members in one query (members ⋈ user emails). Emails compare
 * case-insensitively — email mailbox names are case-preserving but
 * practically case-insensitive, and a restore must not unassign a whole
 * workspace because one instance stored `Alice@…` and the other `alice@…`.
 *
 * SECURITY: this is deliberately a workspace-member query, not a `user`
 * table query — see the module JSDoc. Do not "optimize" it into a global
 * email lookup.
 */
export async function resolveUserMap(
  db: Database,
  workspaceId: string,
  doc: ImportDocument,
): Promise<ResolvedUsers> {
  const members = await db
    .select({ userId: workspaceMember.userId, email: user.email })
    .from(workspaceMember)
    .innerJoin(user, eq(workspaceMember.userId, user.id))
    .where(eq(workspaceMember.workspaceId, workspaceId));

  const memberIdByEmail = new Map<string, string>(
    members.map((m) => [m.email.toLowerCase(), m.userId]),
  );

  const refToUserId = new Map<string, string>();
  const unmatchedRefs: { ref: string; email: string; name: string }[] = [];
  for (const entry of doc.users) {
    const userId = memberIdByEmail.get(entry.email.toLowerCase());
    if (userId !== undefined) {
      refToUserId.set(entry.ref, userId);
    } else {
      unmatchedRefs.push(entry);
    }
  }

  // Distinct tasks per ref: a task counts once for a user no matter how many
  // of its fields (assignee/completedBy/comment authors) reference them —
  // the report answers "how many tasks lose this person?", not "how many
  // columns become null?".
  const taskCountByRef = new Map<string, number>();
  for (const p of doc.projects) {
    for (const t of p.tasks) {
      const refs = new Set<string>();
      if (t.assigneeRef !== null) refs.add(t.assigneeRef);
      if (t.completedByRef !== null) refs.add(t.completedByRef);
      for (const c of t.comments) {
        if (c.authorRef !== null) refs.add(c.authorRef);
      }
      for (const ref of refs) {
        taskCountByRef.set(ref, (taskCountByRef.get(ref) ?? 0) + 1);
      }
    }
  }

  return {
    refToUserId,
    unmatchedUsers: unmatchedRefs.map((u) => ({
      email: u.email,
      name: u.name,
      taskCount: taskCountByRef.get(u.ref) ?? 0,
    })),
  };
}

/**
 * Dry-run analysis: same user matching and same per-project repair pass as
 * {@link executeImport}, zero writes. Sharing `repairProject` is the point —
 * the warnings a user confirms in the preview are exactly the warnings the
 * commit will act on, because they come from the same code.
 */
export async function previewImport(
  db: Database,
  workspaceId: string,
  doc: ImportDocument,
): Promise<ImportPreviewReport> {
  const { unmatchedUsers } = await resolveUserMap(db, workspaceId, doc);
  const counts = zeroCounts();
  const warnings: string[] = [];

  for (const source of doc.projects) {
    const repaired = repairProject(source);
    warnings.push(...repaired.warnings);
    addProjectToCounts(counts, repaired.project);
  }

  return { counts, unmatchedUsers, warnings };
}

/**
 * Write the document into the workspace. Per project, in FK order:
 *
 * 1. `project` + `project_member` + `task_group` + `label` (one batch run)
 * 2. `task` chunks (reference project, groups, users)
 * 3. `subtask` + `comment` + `task_label` chunks (reference tasks/labels)
 *
 * Phases are separate sequential batch runs because tasks FK onto groups
 * and child rows FK onto tasks — and D1 batches execute in statement order
 * within a transaction, so each phase's parents are committed (or at least
 * ordered) before its children bind to them. A failure in any phase
 * triggers the compensating delete described in the module JSDoc; the
 * project is reported in `failedProjects` and the loop continues.
 */
export async function executeImport(
  db: Database,
  workspaceId: string,
  importingUserId: string,
  doc: ImportDocument,
): Promise<ImportExecutionReport> {
  const { refToUserId, unmatchedUsers } = await resolveUserMap(db, workspaceId, doc);

  // One read for ALL fresh positions: imported projects append after the
  // workspace's current last project, in file order (mirrors
  // `getNextProjectPosition` in projects.handlers.ts, generalized to N keys).
  const positions = await nextProjectPositions(db, workspaceId, doc.projects.length);

  const counts = zeroCounts();
  const failedProjects: ImportFailedProject[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < doc.projects.length; i++) {
    const source = doc.projects[i];

    let repairWarnings: string[];
    let plan: ProjectRowPlan;
    try {
      const repaired = repairProject(source);
      repairWarnings = repaired.warnings;
      plan = buildProjectRows(repaired.project, {
        workspaceId,
        importingUserId,
        refToUserId,
        position: positions[i],
      });
    } catch (err) {
      // Row building failed before any write — nothing to roll back.
      failedProjects.push({ name: source.name, error: errorMessage(err) });
      continue;
    }

    try {
      // Phase 1: project root + everything that FKs only onto project/user.
      await runBatches(db, [
        db.insert(project).values(plan.projectRow),
        ...chunkRowsForInsert(plan.memberRows).map((rows) =>
          db.insert(projectMember).values(rows),
        ),
        ...chunkRowsForInsert(plan.groupRows).map((rows) =>
          db.insert(taskGroup).values(rows),
        ),
        ...chunkRowsForInsert(plan.labelRows).map((rows) => db.insert(label).values(rows)),
      ]);
      // Phase 2: tasks (FK onto project + groups).
      await runBatches(
        db,
        chunkRowsForInsert(plan.taskRows).map((rows) => db.insert(task).values(rows)),
      );
      // Phase 3: task children (FK onto tasks/labels).
      await runBatches(db, [
        ...chunkRowsForInsert(plan.subtaskRows).map((rows) =>
          db.insert(subtask).values(rows),
        ),
        ...chunkRowsForInsert(plan.commentRows).map((rows) =>
          db.insert(comment).values(rows),
        ),
        ...chunkRowsForInsert(plan.taskLabelRows).map((rows) =>
          db.insert(taskLabel).values(rows),
        ),
      ]);
    } catch (err) {
      const failure: ImportFailedProject = {
        name: source.name,
        error: errorMessage(err),
      };
      try {
        // Compensating delete — tasks BEFORE project (task.taskGroupId is
        // onDelete:restrict; see module JSDoc). Children cascade.
        await db.batch([
          db.delete(task).where(eq(task.projectId, plan.projectId)),
          db.delete(project).where(eq(project.id, plan.projectId)),
        ] as const);
      } catch (rollbackErr) {
        // Never mask the original failure, but be honest that cleanup also
        // failed — an operator needs to know orphan rows may exist.
        failure.error += ` (rollback may be incomplete: ${errorMessage(rollbackErr)})`;
      }
      failedProjects.push(failure);
      continue;
    }

    // Only successful projects contribute counts and repair warnings — a
    // rolled-back project's "recurrence link removed" warning would be
    // noise about rows that no longer exist. Counting from `source` is
    // exact: repair only drops label LINKS, which are not a counted entity.
    addProjectToCounts(counts, source);
    warnings.push(...repairWarnings);
  }

  return { counts, unmatchedUsers, failedProjects, warnings };
}

// ---------------------------------------------------------------------------
// Chunking math (exported for direct unit testing — the D1 limit failure
// mode only appears on production-size imports, so the math itself must be
// provably correct at unit scale)
// ---------------------------------------------------------------------------

/**
 * Rows per multi-row INSERT for this row shape: `floor(90 / columnCount)`,
 * with columnCount derived from the row OBJECT (`Object.keys`). See the
 * module JSDoc for why this is never a constant. Minimum 1 so a
 * pathologically wide row still inserts (one row per statement).
 */
export function rowsPerStatement(row: object): number {
  return Math.max(1, Math.floor(D1_SAFE_BOUND_PARAMS / Object.keys(row).length));
}

/**
 * Split rows into chunks sized by {@link rowsPerStatement}. All rows of one
 * table are built with an identical, fully-explicit key set (every column
 * present, nullable columns as explicit `null`), so the first row's key
 * count is representative — building rows with omitted optional keys would
 * make both the math wrong and the multi-row VALUES binding inconsistent.
 */
export function chunkRowsForInsert<T extends object>(rows: readonly T[]): T[][] {
  if (rows.length === 0) return [];
  const size = rowsPerStatement(rows[0]);
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * Split a statement list into ≤{@link MAX_STATEMENTS_PER_BATCH}-statement
 * groups, preserving order (FK parents stay ahead of their children).
 */
export function chunkStatements<T>(statements: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < statements.length; i += MAX_STATEMENTS_PER_BATCH) {
    groups.push(statements.slice(i, i + MAX_STATEMENTS_PER_BATCH));
  }
  return groups;
}

/** Run statements as sequential ≤100-statement `db.batch()` transactions. */
async function runBatches(db: Database, statements: BatchItem<"sqlite">[]): Promise<void> {
  for (const group of chunkStatements(statements)) {
    if (group.length === 0) continue;
    await db.batch(group as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}

// ---------------------------------------------------------------------------
// Document repair (shared by preview + execute so warnings match the writes)
// ---------------------------------------------------------------------------

/** A repairable-reference pass over one project. */
export interface RepairedProject {
  project: ExportedProject;
  warnings: string[];
}

/**
 * Repair dangling intra-file references that have an honest fallback:
 *
 * - `recurrenceParentId` pointing at a task not in the file → `null` plus a
 *   warning. The column is a self-FK; importing it unmapped would either
 *   fail the FK or, worse, point at an unrelated task in the target.
 * - `labelIds` entries with no matching project label → dropped plus a
 *   warning (a label LINK can be dropped without losing the task), and
 *   de-duplicated (the DB has a UNIQUE (taskId, labelId) index; a file
 *   repeating a link must not fail the whole project over idempotent data).
 *
 * Dangling `taskGroupId` is NOT repairable (tasks must live in a group —
 * NOT NULL + restrict FK) and is rejected at parse time; the executor
 * re-checks it defensively in {@link buildProjectRows} and fails that
 * project cleanly if the engine is ever called with an unvalidated doc.
 *
 * `recurrenceSeriesId` needs no repair: in the live schema it is an opaque
 * grouping UUID (minted fresh when a rule is created — see task-crud.ts),
 * NOT a task reference, so it is remapped wholesale in
 * {@link buildProjectRows} instead.
 */
export function repairProject(source: ExportedProject): RepairedProject {
  const warnings: string[] = [];
  const taskIds = new Set(source.tasks.map((t) => t.id));
  const labelIds = new Set(source.labels.map((l) => l.id));

  let anyChanged = false;
  const tasks = source.tasks.map((t) => {
    let changed = false;

    let recurrenceParentId = t.recurrenceParentId;
    if (recurrenceParentId !== null && !taskIds.has(recurrenceParentId)) {
      warnings.push(
        `Project "${source.name}": task "${t.title}" references a recurrence parent that is not in the file; the recurrence link was removed.`,
      );
      recurrenceParentId = null;
      changed = true;
    }

    const keptLabelIds: string[] = [];
    const seenLabelIds = new Set<string>();
    let droppedLabels = 0;
    for (const id of t.labelIds) {
      if (!labelIds.has(id)) {
        droppedLabels += 1;
        continue;
      }
      if (seenLabelIds.has(id)) continue; // silent dedupe — idempotent data
      seenLabelIds.add(id);
      keptLabelIds.push(id);
    }
    if (droppedLabels > 0) {
      warnings.push(
        `Project "${source.name}": task "${t.title}" references ${droppedLabels} label${droppedLabels === 1 ? "" : "s"} that ${droppedLabels === 1 ? "is" : "are"} not in the file; the label link${droppedLabels === 1 ? " was" : "s were"} removed.`,
      );
    }
    if (keptLabelIds.length !== t.labelIds.length) changed = true;

    if (!changed) return t;
    anyChanged = true;
    return { ...t, recurrenceParentId, labelIds: keptLabelIds };
  });

  return {
    project: anyChanged ? { ...source, tasks } : source,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Row building (the duplicateProject ID-remap pattern, applied to the full
// content graph)
// ---------------------------------------------------------------------------

type ProjectInsert = typeof project.$inferInsert;
type ProjectMemberInsert = typeof projectMember.$inferInsert;
type TaskGroupInsert = typeof taskGroup.$inferInsert;
type LabelInsert = typeof label.$inferInsert;
type TaskInsert = typeof task.$inferInsert;
type SubtaskInsert = typeof subtask.$inferInsert;
type CommentInsert = typeof comment.$inferInsert;
type TaskLabelInsert = typeof taskLabel.$inferInsert;

interface ProjectRowPlan {
  projectId: string;
  projectRow: ProjectInsert;
  memberRows: ProjectMemberInsert[];
  groupRows: TaskGroupInsert[];
  labelRows: LabelInsert[];
  taskRows: TaskInsert[];
  subtaskRows: SubtaskInsert[];
  commentRows: CommentInsert[];
  taskLabelRows: TaskLabelInsert[];
}

interface BuildContext {
  workspaceId: string;
  importingUserId: string;
  refToUserId: ReadonlyMap<string, string>;
  /** Fresh fractional-index position appended after existing projects. */
  position: string;
}

/**
 * Build every insert row for one project with fresh UUIDs and remapped FKs
 * (`Map<oldId, newId>` per entity type — the `duplicateProject` pattern,
 * projects.handlers.ts:318+).
 *
 * Conventions:
 * - Content timestamps (`createdAt`/`updatedAt`/`completedAt`) come from the
 *   FILE — creation dates are user data and a restore must preserve them.
 *   Provenance-of-this-import timestamps (`project_member.addedAt`,
 *   `task_label.createdAt`) are `now` — those rows are genuinely created by
 *   this import; the export format does not even carry values for them.
 * - `position` strings are reused verbatim for groups/tasks/subtasks: a new
 *   project (and new tasks) are fresh uniqueness namespaces, and Cadence
 *   exports carry already-unique-per-parent fractional keys.
 * - Cover binaries don't round-trip: `coverImageKey`/`coverImagePosition`
 *   are explicitly null. `coverUnsplash` is pure JSON metadata and imports.
 * - The importing user is ALWAYS the project's admin (mirrors
 *   `duplicateProject`): every imported project must have at least one
 *   member who can manage it, and the one person guaranteed to exist and
 *   to have intended this import is the importer.
 * - Every row object spells out EVERY column (nullable ones as explicit
 *   null) — required for the param-derived chunk math; see
 *   {@link chunkRowsForInsert}.
 */
function buildProjectRows(source: ExportedProject, ctx: BuildContext): ProjectRowPlan {
  const now = new Date();
  const projectId = crypto.randomUUID();

  const projectRow: ProjectInsert = {
    id: projectId,
    workspaceId: ctx.workspaceId,
    name: source.name,
    description: source.description,
    status: source.status,
    icon: source.icon,
    coverImageKey: null,
    coverImagePosition: null,
    coverUnsplash: source.coverUnsplash,
    createdAt: new Date(source.createdAt),
    updatedAt: new Date(source.updatedAt),
    theme: source.theme,
    budget: source.budget,
    autoAssignCreator: source.autoAssignCreator,
    position: ctx.position,
  };

  // Members: file roles for email-matched workspace members, de-duplicated
  // by TARGET userId (two file refs may resolve to one local user; the DB
  // has UNIQUE (projectId, userId)). The importer is forced admin and their
  // file entry (if any) is superseded.
  const memberRows: ProjectMemberInsert[] = [];
  const seenUserIds = new Set<string>([ctx.importingUserId]);
  for (const m of source.members) {
    const userId = ctx.refToUserId.get(m.userRef);
    if (userId === undefined || seenUserIds.has(userId)) continue;
    seenUserIds.add(userId);
    memberRows.push({
      id: crypto.randomUUID(),
      projectId,
      userId,
      role: m.role,
      addedAt: now,
    });
  }
  memberRows.push({
    id: crypto.randomUUID(),
    projectId,
    userId: ctx.importingUserId,
    role: "admin",
    addedAt: now,
  });

  const groupIdByOld = new Map<string, string>(
    source.taskGroups.map((g) => [g.id, crypto.randomUUID()]),
  );
  const groupRows: TaskGroupInsert[] = source.taskGroups.map((g) => ({
    id: requireMapped(groupIdByOld, g.id, "task group"),
    projectId,
    name: g.name,
    color: g.color,
    isCompletionGroup: g.isCompletionGroup,
    position: g.position,
    createdAt: new Date(g.createdAt),
    updatedAt: new Date(g.updatedAt),
  }));

  const labelIdByOld = new Map<string, string>(
    source.labels.map((l) => [l.id, crypto.randomUUID()]),
  );
  const labelRows: LabelInsert[] = source.labels.map((l) => ({
    id: requireMapped(labelIdByOld, l.id, "label"),
    projectId,
    name: l.name,
    color: l.color,
    createdAt: new Date(l.createdAt),
  }));

  // Pre-mint ALL task ids before building rows so recurrenceParentId can
  // reference a task that appears later in the array.
  const taskIdByOld = new Map<string, string>(
    source.tasks.map((t) => [t.id, crypto.randomUUID()]),
  );
  // Series ids are opaque grouping UUIDs (not task refs): each distinct
  // source value gets ONE fresh UUID so series stay grouped in the target
  // without ever colliding with the source instance's ids.
  const seriesIdByOld = new Map<string, string>();

  const taskRows: TaskInsert[] = source.tasks.map((t) => {
    const newGroupId = groupIdByOld.get(t.taskGroupId);
    if (newGroupId === undefined) {
      // Parse-level integrity validation rejects this; the throw keeps the
      // engine safe (clean per-project failure) if it's ever driven directly.
      throw new Error(
        `Task "${t.title}" references task group "${t.taskGroupId}", which does not exist in project "${source.name}"`,
      );
    }
    return {
      id: requireMapped(taskIdByOld, t.id, "task"),
      projectId,
      taskGroupId: newGroupId,
      title: t.title,
      description: t.description,
      // Unmatched refs → null: the member-only matching decision (module
      // JSDoc). `?? null` (not requireMapped) is the contract, not a fallback.
      assigneeId: t.assigneeRef !== null ? (ctx.refToUserId.get(t.assigneeRef) ?? null) : null,
      priority: t.priority,
      completed: t.completed,
      completedAt: t.completedAt !== null ? new Date(t.completedAt) : null,
      completedBy:
        t.completedByRef !== null ? (ctx.refToUserId.get(t.completedByRef) ?? null) : null,
      startDate: t.startDate !== null ? new Date(t.startDate) : null,
      dueDate: t.dueDate !== null ? new Date(t.dueDate) : null,
      cost: t.cost,
      icon: t.icon,
      coverImageKey: null,
      coverImagePosition: null,
      coverUnsplash: t.coverUnsplash,
      // DB stores the rule as JSON text (same serialization as task-crud.ts).
      recurrenceRule: t.recurrenceRule !== null ? JSON.stringify(t.recurrenceRule) : null,
      // repairProject nulled danglers, so a non-null value maps; `?? null`
      // keeps the row total even if repair is bypassed.
      recurrenceParentId:
        t.recurrenceParentId !== null
          ? (taskIdByOld.get(t.recurrenceParentId) ?? null)
          : null,
      recurrenceSeriesId:
        t.recurrenceSeriesId !== null
          ? remapSeriesId(seriesIdByOld, t.recurrenceSeriesId)
          : null,
      sourceUid: t.sourceUid,
      position: t.position,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
    };
  });

  const subtaskRows: SubtaskInsert[] = [];
  const commentRows: CommentInsert[] = [];
  const taskLabelRows: TaskLabelInsert[] = [];
  for (const t of source.tasks) {
    const newTaskId = requireMapped(taskIdByOld, t.id, "task");
    for (const s of t.subtasks) {
      subtaskRows.push({
        id: crypto.randomUUID(),
        taskId: newTaskId,
        title: s.title,
        completed: s.completed,
        position: s.position,
        createdAt: new Date(s.createdAt),
      });
    }
    for (const c of t.comments) {
      commentRows.push({
        id: crypto.randomUUID(),
        taskId: newTaskId,
        authorId: c.authorRef !== null ? (ctx.refToUserId.get(c.authorRef) ?? null) : null,
        body: c.body,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
      });
    }
    for (const oldLabelId of t.labelIds) {
      const newLabelId = labelIdByOld.get(oldLabelId);
      // repairProject dropped danglers; skipping (not throwing) keeps the
      // executor's behavior identical to the repair it advertises.
      if (newLabelId === undefined) continue;
      taskLabelRows.push({
        id: crypto.randomUUID(),
        taskId: newTaskId,
        labelId: newLabelId,
        createdAt: now,
      });
    }
  }

  return {
    projectId,
    projectRow,
    memberRows,
    groupRows,
    labelRows,
    taskRows,
    subtaskRows,
    commentRows,
    taskLabelRows,
  };
}

/** One fresh UUID per distinct source series id (see call site). */
function remapSeriesId(seriesIdByOld: Map<string, string>, oldId: string): string {
  const existing = seriesIdByOld.get(oldId);
  if (existing !== undefined) return existing;
  const fresh = crypto.randomUUID();
  seriesIdByOld.set(oldId, fresh);
  return fresh;
}

/** Map lookup that fails loudly instead of inserting `undefined` — a remap
 *  miss here is an executor bug, and a thrown message names the entity
 *  instead of letting D1 report a meaningless NOT NULL violation. */
function requireMapped(map: ReadonlyMap<string, string>, oldId: string, kind: string): string {
  const mapped = map.get(oldId);
  if (mapped === undefined) {
    throw new Error(`Internal import error: no remapped id for ${kind} "${oldId}"`);
  }
  return mapped;
}

/**
 * Fresh end-of-list positions for `count` new projects in one read —
 * `generateNKeysBetween(last, null, n)` appends after the workspace's
 * current last positioned project (NULL positions sort before any key, so
 * `DESC LIMIT 1` finds the max real key; an all-NULL workspace starts at
 * the generator's base key).
 */
async function nextProjectPositions(
  db: Database,
  workspaceId: string,
  count: number,
): Promise<string[]> {
  if (count === 0) return [];
  const [last] = await db
    .select({ position: project.position })
    .from(project)
    .where(eq(project.workspaceId, workspaceId))
    .orderBy(desc(project.position))
    .limit(1);
  return generateNKeysBetween(last?.position ?? null, null, count);
}

function zeroCounts(): ImportCounts {
  return { projects: 0, taskGroups: 0, tasks: 0, labels: 0, subtasks: 0, comments: 0 };
}

function addProjectToCounts(counts: ImportCounts, p: ExportedProject): void {
  counts.projects += 1;
  counts.taskGroups += p.taskGroups.length;
  counts.labels += p.labels.length;
  counts.tasks += p.tasks.length;
  for (const t of p.tasks) {
    counts.subtasks += t.subtasks.length;
    counts.comments += t.comments.length;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
