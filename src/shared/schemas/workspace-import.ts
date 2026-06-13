import { z } from "zod";

import { exportProjectSchema, exportUserSchema } from "./workspace-export";

/**
 * Import-side contracts for workspace data import.
 *
 * Two things live here, and the split is deliberate:
 *
 * 1. {@link ImportDocument} — the executor's SINGLE input shape: the
 *    `projects` content subtree plus the `users` matching directory from
 *    the canonical export format. Defining it here (in shared schemas, not
 *    in the API-side `parse.ts`) is what lets the import executor and the
 *    Trello converter be built concurrently against the same contract:
 *    `parse.ts` narrows a Cadence file to this shape, the Trello converter
 *    PRODUCES this shape, and the executor consumes only this shape — so
 *    Trello gets preview/commit/rollback for free and there is exactly one
 *    write path to audit.
 *
 * 2. The preview/result response schemas — shared so the React preview and
 *    report panes are typed by the same contract the API serves, with no
 *    hand-maintained frontend mirror to drift.
 */

/**
 * Detected source format of an uploaded file, surfaced as a badge in the
 * import preview UI. Distinct from the file's `format` literal because
 * Trello exports have no such field — this is the SNIFFED kind, not a
 * value copied from the document.
 */
export const IMPORT_SOURCE_FORMATS = ["cadence", "trello"] as const;
export type ImportSourceFormat = (typeof IMPORT_SOURCE_FORMATS)[number];

/**
 * The executor's input: workspace-level config (members/teams/webhooks/
 * invitations/workspace metadata) is intentionally NOT part of this type —
 * import is scoped to content (plan design decision 5), and what the
 * executor cannot see, it cannot accidentally apply.
 *
 * Kept as a Zod schema (not just a type) so `parse.ts` can normalize and
 * re-validate cheaply, and so converter unit tests can assert their output
 * is contract-valid with one `.parse()` call.
 */
export const importDocumentSchema = z.object({
  /** The ref→email user directory; the ONLY user-matching input. */
  users: z.array(exportUserSchema),
  projects: z.array(exportProjectSchema),
});

export type ImportDocument = z.infer<typeof importDocumentSchema>;

/** Counts are non-negative integers — a count can never be fractional or
 *  negative, and `.int()` catches accumulator bugs at the contract edge. */
const countSchema = z.number().int().min(0);

/**
 * Per-entity counts. In a preview these are "would be created"; in a
 * result they are "were created". Same shape on purpose: the UI renders
 * the same counts table for both panes.
 */
export const importCountsSchema = z.object({
  projects: countSchema,
  taskGroups: countSchema,
  tasks: countSchema,
  labels: countSchema,
  subtasks: countSchema,
  comments: countSchema,
});

/**
 * Honest-cuts ledger: everything the import deliberately does NOT bring
 * over, counted so the UI can say so out loud instead of letting users
 * discover silently missing data later.
 *
 * - `webhooks` / `teams` / `invitations`: workspace config, out of scope
 *   for content import (and webhook secrets never travel at all).
 * - `attachments`: binary content doesn't round-trip in v1 — manifest only.
 * - `activity`: exported history is archival; replaying it would fabricate
 *   provenance.
 * - `closedItems`: Trello archived lists/cards, skipped by the converter.
 */
export const importSkippedSchema = z.object({
  webhooks: countSchema,
  teams: countSchema,
  invitations: countSchema,
  attachments: countSchema,
  activity: countSchema,
  closedItems: countSchema,
});

/**
 * A `users`-directory entry with no email match among the TARGET
 * workspace's members. `taskCount` is how many task references (assignee/
 * completedBy/author) will fall back to null — the number a human needs to
 * decide "invite them first, or import anyway?".
 */
export const importUnmatchedUserSchema = z.object({
  email: z.email(),
  name: z.string(),
  taskCount: countSchema,
});

/**
 * One project whose write failed and was fully rolled back (compensating
 * delete). `error` is a human-readable message — the import is
 * all-or-nothing PER PROJECT, so other entries in `counts` are still real.
 */
export const importFailedProjectSchema = z.object({
  name: z.string(),
  error: z.string(),
});

const importReportBase = {
  sourceFormat: z.enum(IMPORT_SOURCE_FORMATS),
  counts: importCountsSchema,
  unmatchedUsers: z.array(importUnmatchedUserSchema),
  skipped: importSkippedSchema,
  warnings: z.array(z.string()),
} as const;

/**
 * Response of `POST …/import?dryRun=true`: everything the commit would do,
 * with zero writes. No `failedProjects` — nothing was executed, so nothing
 * can have failed; validation problems are 400s, not preview entries.
 */
export const importPreviewSchema = z.object({
  dryRun: z.literal(true),
  ...importReportBase,
});

/** Response of the committing `POST …/import`. */
export const importResultSchema = z.object({
  dryRun: z.literal(false),
  ...importReportBase,
  failedProjects: z.array(importFailedProjectSchema),
});

/**
 * Discriminated union over `dryRun` so the frontend narrows preview vs
 * result from the one field that actually distinguishes them — the same
 * flag the client sent.
 */
export const importResponseSchema = z.discriminatedUnion("dryRun", [
  importPreviewSchema,
  importResultSchema,
]);

export type ImportCounts = z.infer<typeof importCountsSchema>;
export type ImportSkipped = z.infer<typeof importSkippedSchema>;
export type ImportUnmatchedUser = z.infer<typeof importUnmatchedUserSchema>;
export type ImportFailedProject = z.infer<typeof importFailedProjectSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type ImportResponse = z.infer<typeof importResponseSchema>;
