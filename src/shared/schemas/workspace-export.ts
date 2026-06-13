import { z } from "zod";

import {
  INVITATION_STATUSES,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TEAM_ROLES,
  WORKSPACE_ROLES,
} from "../types/roles";
import { THEMES } from "../types/theme";
import { WEBHOOK_EVENT_TYPES } from "../types/webhook";
import { dateRangeError, recurrenceRuleSchema } from "./task";
import { storedUnsplashCoverPayloadSchema } from "./unsplash";

/**
 * Canonical workspace export format — the single source of truth for what a
 * Cadence workspace looks like outside a Cadence instance ("your data is
 * never held hostage" as a contract, not a slogan).
 *
 * Conventions this file pins, and WHY:
 *
 * - **One versioned JSON document.** Import validation is literally
 *   `workspaceExportSchema.parse(file)` — there is no second, drifting
 *   description of the format. The export endpoint's builder is typed as
 *   {@link WorkspaceExport} so contract drift is a compile/test failure,
 *   not silent data loss.
 *
 * - **All timestamps are ISO 8601 datetime strings.** The DB stores epoch
 *   integers (Drizzle `timestamp` mode); the endpoints convert both ways.
 *   ISO strings keep the file human-readable, timezone-unambiguous, and
 *   independent of SQLite storage details a future version might change.
 *
 * - **Entity `id`s are SOURCE-instance ids, used only for intra-file FK
 *   joins** (`taskGroupId`, `labelIds`, `recurrenceParentId`, webhook
 *   `projectId`). Import treats them as opaque and mints fresh UUIDs — they
 *   are deliberately NOT validated as UUIDs so non-Cadence producers (e.g.
 *   the Trello converter) can use any unique string.
 *
 * - **User references are `ref`s into the top-level `users` directory,
 *   never raw userIds or inline emails.** `user.email` is unique per
 *   instance, which makes email the portable cross-instance user key;
 *   the `ref` indirection avoids repeating emails on every row and keeps
 *   the file self-describing even for users with no match on the target
 *   instance. Import resolves `ref → email → target workspace member`.
 *
 * - **Secrets are structurally unrepresentable.** Webhook entries have no
 *   `secret` field and invitation entries have no `token` field — and both
 *   are `strictObject`s, so a document that DOES carry those keys fails to
 *   parse instead of being silently accepted (or silently re-serialized by
 *   a naive copy). A secret can therefore never survive an export→import
 *   round trip even if an upstream bug spreads a raw DB row into the
 *   envelope: the export contract test parses the response against this
 *   schema and would fail loudly.
 *
 * - **Field constraints mirror the create/update schemas** (title ≤200,
 *   comment body ≤5000, label name ≤30, …). The import endpoint is not a
 *   back door around the app's validation contract: an imported task can
 *   never carry values a hand-created task couldn't (same philosophy as
 *   `importTaskItemSchema` in `task.ts`). Converters from looser sources
 *   (Trello) must truncate/normalize to fit — by design.
 *
 * - **Binary content does not round-trip in v1.** Attachments and cover
 *   images export as manifests (`key` + instance-relative authenticated
 *   `url`) so the data is enumerable and downloadable while the source
 *   instance is accessible; import reports them as skipped. Bundling
 *   N×10 MB binaries through a 128 MB Worker isolate would require job
 *   infrastructure the design intentionally avoids.
 */
export const EXPORT_FORMAT = "cadence.workspace";
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Server-side cap checked BEFORE `JSON.parse`. Workers accept 100 MB
 * bodies, but parse + Zod + remapped insert rows cost ~4–5× the file size
 * in memory; 20 MB keeps the worst case ~100 MB under the 128 MB isolate
 * ceiling while still fitting ~15–20k tasks — beyond any realistic single
 * import.
 */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Opaque source-instance user id pointing into the top-level `users`
 * directory. Never a raw userId of the TARGET instance, never an email —
 * see the module JSDoc for the ref→email→member resolution chain.
 */
const userRef = z.string().min(1);

/** Opaque source-instance entity id — intra-file joins only, never a UUID
 *  guarantee (Trello-converted documents use Trello ids here). */
const sourceId = z.string().min(1);

/**
 * ISO 8601 datetime with required timezone (Z or ±offset). The exporter
 * always emits UTC `Z` via `Date.toISOString()`; offsets are accepted on
 * import so hand-repaired or third-party-generated files don't fail on a
 * representational difference that `new Date()` resolves losslessly.
 * Plain `YYYY-MM-DD` and zone-less local datetimes are rejected — a
 * timestamp without a zone is ambiguous data, and the DB epoch conversion
 * would silently localize it.
 */
const isoDateTime = z.iso.datetime({ offset: true });

/**
 * 6-digit `#rrggbb` hex color, mirroring the `color` constraint on the live
 * `createLabelSchema` / `createTaskGroupSchema` — an imported label or group
 * can never carry a color a hand-created one couldn't. Applied raw where the
 * column is required (labels) or with `.nullable()` where it isn't (groups).
 */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Entry in the top-level `users` directory: the join target for every
 * `*Ref` field in the document. `name` is carried for display in import
 * previews ("J. Smith (jsmith@…) — 14 tasks would be unassigned"); email
 * is the actual matching key.
 */
export const exportUserSchema = z.object({
  ref: userRef,
  email: z.email(),
  name: z.string(),
});

export const exportSubtaskSchema = z.object({
  title: z.string().min(1).max(200),
  completed: z.boolean(),
  /** Fractional-index string, unique per task — reused verbatim on import
   *  (a fresh task is a fresh uniqueness namespace). */
  position: z.string().min(1),
  createdAt: isoDateTime,
});

export const exportCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  /** Nullable because `comment.authorId` is `onDelete: set null` — comments
   *  by deleted users are real data and must stay representable. */
  authorRef: userRef.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/**
 * Attachment MANIFEST entry — metadata plus an instance-relative
 * authenticated download path, not the binary (see module JSDoc).
 * `url` is a plain string, not `z.url()`: it is a relative path
 * (`/api/uploads/<key>`) into the SOURCE instance's authenticated serve
 * endpoint, and absolute-URL validation would reject exactly the value
 * the exporter produces.
 */
export const exportAttachmentSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  /** Bytes. */
  size: z.number().int().min(0),
  /** Source-instance R2 object key (`purpose/userId/uuid.ext`). */
  key: z.string().min(1),
  /** Instance-relative authenticated download path on the source. */
  url: z.string().min(1),
});

/**
 * Custom (uploaded) cover image manifest for tasks/projects — same
 * binary-doesn't-round-trip treatment as attachments. Kept as one nullable
 * object (rather than the DB's flat `coverImageKey`/`coverImagePosition`
 * columns) because `position` — the vertical crop percentage — is
 * meaningless without the image it crops. Unsplash covers are pure JSON
 * metadata and DO round-trip via the separate `coverUnsplash` field.
 */
export const exportCoverImageSchema = z.object({
  /** Source-instance R2 object key. */
  key: z.string().min(1).max(500),
  /** Instance-relative authenticated download path on the source. */
  url: z.string().min(1),
  /** Vertical crop position, 0–100 (mirrors `updateTaskSchema`). */
  position: z.number().int().min(0).max(100).nullable(),
});

/**
 * Per-task activity row. Exported (opt-in) because history is user data,
 * but NEVER replayed on import — historical provenance can't be honestly
 * recreated, so it travels for archival value only. The DB's `apiTokenId`
 * column is deliberately absent: it references the source instance's
 * `api_token` table, which is excluded from export as secret-adjacent
 * operational data.
 */
export const exportActivitySchema = z.object({
  /** Nullable: `task_activity.actorId` is `onDelete: set null`. */
  actorRef: userRef.nullable(),
  action: z.string().min(1),
  field: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  createdAt: isoDateTime,
});

/**
 * One task, reconciled field-by-field against the live `task` table
 * (`src/db/schema/task.ts`) — including the calendar-ics additions
 * `startDate` and `sourceUid` that postdate the original format sketch.
 * `projectId` is intentionally absent (tasks are nested under their
 * project), as is the DB-internal flat cover-image pair (folded into
 * `coverImage`, see {@link exportCoverImageSchema}).
 *
 * The start/due range invariant (`startDate` requires `dueDate`, start ≤
 * due) is enforced here with the SAME `dateRangeError` helper the create/
 * update schemas use — import validation is exactly where the rule
 * matters, because the executor writes these dates straight to the DB and
 * every other write path in the app makes an inverted or due-less range
 * unrepresentable. Reusing the helper keeps the rule and its 400 message
 * single-sourced.
 */
export const exportTaskSchema = z
  .object({
    id: sourceId,
    /** Intra-file join to `taskGroups[].id` of the owning project. */
    taskGroupId: sourceId,
    title: z.string().min(1).max(200),
    description: z.string().max(5000).nullable(),
    assigneeRef: userRef.nullable(),
    priority: z.enum(TASK_PRIORITIES),
    completed: z.boolean(),
    completedAt: isoDateTime.nullable(),
    completedByRef: userRef.nullable(),
    /** Start of a date range; only meaningful with `dueDate` (refined below). */
    startDate: isoDateTime.nullable(),
    dueDate: isoDateTime.nullable(),
    /** Cost in cents. */
    cost: z.number().int().min(0).nullable(),
    icon: z.string().max(50).nullable(),
    coverImage: exportCoverImageSchema.nullable(),
    coverUnsplash: storedUnsplashCoverPayloadSchema.nullable(),
    recurrenceRule: recurrenceRuleSchema.nullable(),
    /** Intra-file self-join; import nulls it (with a warning) when the
     *  parent task isn't present in the document. */
    recurrenceParentId: sourceId.nullable(),
    recurrenceSeriesId: sourceId.nullable(),
    /** ICS import provenance (source VEVENT UID); backs the partial unique
     *  (projectId, source_uid) dedupe index. Cap mirrors `importTaskItemSchema`. */
    sourceUid: z.string().min(1).max(512).nullable(),
    /** Fractional-index string, unique per task group. */
    position: z.string().min(1),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    /** Intra-file joins to the owning project's `labels[].id`. */
    labelIds: z.array(sourceId),
    subtasks: z.array(exportSubtaskSchema),
    comments: z.array(exportCommentSchema),
    attachments: z.array(exportAttachmentSchema),
    /** Present only when exported with `?includeActivity=true`. */
    activity: z.array(exportActivitySchema).optional(),
  })
  .superRefine((data, ctx) => {
    const message = dateRangeError(data.startDate, data.dueDate);
    if (message) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message });
    }
  });

export const exportTaskGroupSchema = z.object({
  id: sourceId,
  name: z.string().min(1).max(100),
  color: hexColor.nullable(),
  isCompletionGroup: z.boolean(),
  /** Fractional-index string, unique per project. */
  position: z.string().min(1),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const exportLabelSchema = z.object({
  id: sourceId,
  name: z.string().min(1).max(30),
  color: hexColor,
  createdAt: isoDateTime,
});

/**
 * Project-level membership. Carried so a restore can rebuild access for
 * users that match by email; `addedAt`/ids are provenance, not content,
 * and are deliberately omitted.
 */
export const exportProjectMemberSchema = z.object({
  userRef,
  role: z.enum(PROJECT_ROLES),
});

/**
 * One project with its full content subtree — the unit of import
 * (all-or-nothing per project). Reconciled against the live `project`
 * table: includes `coverUnsplash` (pure JSON, round-trips) and the
 * uploaded-cover manifest, both absent from the original sketch.
 */
export const exportProjectSchema = z.object({
  id: sourceId,
  name: z.string().min(1).max(100),
  description: z.string().max(1000).nullable(),
  status: z.enum(PROJECT_STATUSES),
  icon: z.string().max(50).nullable(),
  coverImage: exportCoverImageSchema.nullable(),
  coverUnsplash: storedUnsplashCoverPayloadSchema.nullable(),
  theme: z.enum(THEMES).nullable(),
  /** Budget in cents. */
  budget: z.number().int().min(0).nullable(),
  autoAssignCreator: z.boolean(),
  /** Fractional-index string; nullable in the DB (legacy rows). Import
   *  computes a fresh position in the target workspace regardless. */
  position: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  members: z.array(exportProjectMemberSchema),
  taskGroups: z.array(exportTaskGroupSchema),
  labels: z.array(exportLabelSchema),
  tasks: z.array(exportTaskSchema),
});

/** Workspace membership directory entry — used by import ONLY as part of
 *  the email-matching directory; roles are never applied to the target. */
export const exportWorkspaceMemberSchema = z.object({
  userRef,
  role: z.enum(WORKSPACE_ROLES),
  joinedAt: isoDateTime,
});

export const exportTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable(),
  members: z.array(
    z.object({
      userRef,
      role: z.enum(TEAM_ROLES),
    }),
  ),
});

/**
 * Webhook CONFIG, minus the signing secret — secrets never leave the
 * instance. `strictObject` is load-bearing: a document carrying a `secret`
 * key is rejected at parse time rather than silently stripped, so the
 * export contract test catches any future handler bug that spreads a raw
 * DB row into the envelope (a plain object would mask it by stripping).
 * `consecutiveFailures` (operational counter) is likewise out of scope.
 * Import skips webhooks and reports them — this section is archival.
 */
export const exportWebhookSchema = z.strictObject({
  name: z.string().min(1).max(100),
  url: z.url(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
  active: z.boolean(),
  /** Intra-file join to `projects[].id`; null = workspace-scoped. */
  projectId: sourceId.nullable(),
});

/**
 * Invitation record, minus the secret acceptance `token` (and the
 * token-lifetime fields `expiresAt`/`acceptedAt` that only describe it).
 * `strictObject` for the same never-serialize-secrets guarantee as
 * {@link exportWebhookSchema}. Import skips invitations — archival only.
 */
export const exportInvitationSchema = z.strictObject({
  email: z.email(),
  role: z.enum(WORKSPACE_ROLES),
  status: z.enum(INVITATION_STATUSES),
});

/**
 * The envelope. `format`/`formatVersion` are literals — not strings — so a
 * file from a different tool or a future incompatible version fails the
 * very first parse with an exact, named mismatch instead of surfacing as
 * confusing downstream field errors.
 */
export const workspaceExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: isoDateTime,
  /** Email (not ref) of the exporting user: must stay meaningful even if
   *  that user is absent from the `users` directory entirely. */
  exportedBy: z.email(),
  /** Descriptive only — import targets the CURRENT workspace and never
   *  applies this section (see plan design decision 5). */
  workspace: z.object({
    name: z.string().min(1).max(100),
    slug: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9-]+$/),
    description: z.string().max(500).nullable(),
    theme: z.enum(THEMES).nullable(),
  }),
  users: z.array(exportUserSchema),
  members: z.array(exportWorkspaceMemberSchema),
  teams: z.array(exportTeamSchema),
  webhooks: z.array(exportWebhookSchema),
  invitations: z.array(exportInvitationSchema),
  projects: z.array(exportProjectSchema),
});

export type WorkspaceExport = z.infer<typeof workspaceExportSchema>;
export type ExportedUser = z.infer<typeof exportUserSchema>;
export type ExportedTask = z.infer<typeof exportTaskSchema>;
export type ExportedTaskGroup = z.infer<typeof exportTaskGroupSchema>;
export type ExportedLabel = z.infer<typeof exportLabelSchema>;
export type ExportedProject = z.infer<typeof exportProjectSchema>;
export type ExportedSubtask = z.infer<typeof exportSubtaskSchema>;
export type ExportedComment = z.infer<typeof exportCommentSchema>;
export type ExportedAttachment = z.infer<typeof exportAttachmentSchema>;
export type ExportedActivity = z.infer<typeof exportActivitySchema>;
export type ExportedCoverImage = z.infer<typeof exportCoverImageSchema>;
