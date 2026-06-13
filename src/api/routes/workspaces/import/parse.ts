import { z } from "zod";

import {
  EXPORT_FORMAT,
  MAX_IMPORT_FILE_BYTES,
  workspaceExportSchema,
} from "../../../../shared/schemas/workspace-export";
import type {
  ImportDocument,
  ImportSkipped,
  ImportSourceFormat,
} from "../../../../shared/schemas/workspace-import";
import { importDocumentSchema } from "../../../../shared/schemas/workspace-import";

/**
 * Import file parsing: size guard → JSON → format sniff → validation →
 * normalization into the executor's single input shape ({@link ImportDocument}).
 *
 * This module is deliberately PURE (no Hono context, no DB): the HTTP handler
 * maps {@link ImportParseFailure.reason} to status codes (413 for
 * `"too-large"`, 400 for everything else) and the executor consumes
 * {@link ParsedImport.doc}. Keeping it pure is what makes the error paths —
 * the part users actually hit when a file is wrong — unit-testable without
 * Miniflare.
 *
 * ## The Trello converter seam
 *
 * The Trello converter (`./trello`, built as a concurrent work unit) is
 * INJECTED via {@link ParseImportOptions.convertTrello} rather than imported
 * here. Why injection instead of a direct import:
 *
 * - parse.ts has zero compile-time coupling to a module that is being
 *   authored in parallel — the seam is this module's exported
 *   {@link TrelloConverter} type, not a file path.
 * - the seam is testable with a fake converter, so parse tests assert the
 *   DISPATCH (sniff → convert → validate) without depending on real Trello
 *   conversion semantics.
 *
 * The HTTP handler wires it up as:
 * `parseImportFile(raw, { convertTrello: trelloToImportDocument })`.
 *
 * A converter may return either a bare {@link ImportDocument} (the planned
 * `trelloToImportDocument(board)` signature) or a {@link TrelloConversion}
 * wrapper when it has converter-domain reporting to surface (Trello's
 * archived lists/cards → `skipped.closedItems`, lossy-mapping warnings).
 * Accepting both keeps the planned signature valid while giving skip counts
 * a typed home. Converter output is re-validated against
 * `importDocumentSchema` here — the executor writes this data straight to
 * the DB, so the seam is guarded at runtime, not trusted.
 */

/**
 * Converter injected by the HTTP handler for files that sniff as Trello.
 * Receives the already-JSON-parsed board as `unknown` — the converter owns
 * its own (lenient) board validation and may throw `z.ZodError` or `Error`;
 * both are caught here and mapped to user-facing validation failures.
 */
export type TrelloConverter = (board: unknown) => ImportDocument | TrelloConversion;

/**
 * Rich converter result: the canonical document plus converter-domain
 * reporting that the {@link ImportDocument} shape itself cannot carry
 * (e.g. how many archived Trello lists/cards were skipped).
 */
export interface TrelloConversion {
  doc: ImportDocument;
  /** Added onto the doc-derived skip counts (not overwritten). */
  skipped?: Partial<ImportSkipped>;
  warnings?: string[];
}

export interface ParseImportOptions {
  /** WX5's `trelloToImportDocument` (or a composed wrapper) — see module JSDoc. */
  convertTrello: TrelloConverter;
}

/** Successful parse: everything the handler needs for preview or commit. */
export interface ParsedImport {
  ok: true;
  sourceFormat: ImportSourceFormat;
  doc: ImportDocument;
  /**
   * The full honest-cuts ledger, computed HERE rather than in the executor:
   * webhooks/teams/invitations exist only in the export envelope (the
   * `ImportDocument` deliberately cannot represent them), and dry runs need
   * skip counts without any executor involvement. Attachments/activity are
   * counted from the doc; `closedItems` comes from the Trello converter.
   */
  skipped: ImportSkipped;
  /** Parse-stage warnings (e.g. cover images that won't round-trip). */
  warnings: string[];
}

export interface ImportParseFailure {
  ok: false;
  /**
   * `"too-large"` → HTTP 413; all other reasons → HTTP 400. Distinguished
   * reasons (rather than one error string) let the handler pick status codes
   * and the UI pick messaging without parsing prose.
   */
  reason: "too-large" | "invalid-json" | "unsupported-format" | "invalid-document";
  /** User-facing messages — the handler returns these verbatim. */
  errors: string[];
}

export type ParseImportResult = ParsedImport | ImportParseFailure;

/** Cap on reported issues so a deeply broken 20 MB file can't produce a
 *  multi-megabyte error response. */
const MAX_REPORTED_ERRORS = 25;

/**
 * Detect the source format of an already-JSON-parsed value.
 *
 * - Cadence: `format === "cadence.workspace"`. The version is deliberately
 *   NOT checked here — a future-version file should sniff as Cadence and
 *   then fail schema validation with an exact, named `formatVersion`
 *   mismatch instead of a generic "unsupported format".
 * - Trello: the stable top-level shape of a single-board JSON export
 *   (`{id, name, lists[], cards[]}`). Shape-only on purpose: full board
 *   validation belongs to the converter.
 * - Anything else: `null` (unsupported).
 */
export function sniffFormat(value: unknown): ImportSourceFormat | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (obj.format === EXPORT_FORMAT) {
    return "cadence";
  }
  if (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    Array.isArray(obj.lists) &&
    Array.isArray(obj.cards)
  ) {
    return "trello";
  }
  return null;
}

/**
 * Parse an uploaded import file into a validated {@link ImportDocument}.
 *
 * Order of operations is load-bearing:
 * 1. **Byte-size guard BEFORE `JSON.parse`** — `JSON.parse` on an unbounded
 *    string is exactly the memory blow-up `MAX_IMPORT_FILE_BYTES` exists to
 *    prevent (parse + Zod + insert rows cost ~4–5× file size; see the
 *    constant's JSDoc in `workspace-export.ts`).
 * 2. JSON parse with a friendly failure.
 * 3. Format sniff ({@link sniffFormat}).
 * 4. Per-format validation (Cadence: `workspaceExportSchema`; Trello:
 *    injected converter, output re-validated against `importDocumentSchema`).
 * 5. Cross-reference integrity checks Zod cannot express (dangling
 *    `taskGroupId`, duplicate user refs) — caught here as 400s so they never
 *    surface as opaque FK failures mid-import.
 */
export function parseImportFile(
  raw: string | Uint8Array | ArrayBuffer,
  options: ParseImportOptions,
): ParseImportResult {
  const size = byteLength(raw);
  if (size > MAX_IMPORT_FILE_BYTES) {
    const maxMb = Math.floor(MAX_IMPORT_FILE_BYTES / (1024 * 1024));
    return {
      ok: false,
      reason: "too-large",
      errors: [
        `Import file is ${formatBytes(size)}, which exceeds the ${maxMb} MB limit.`,
      ],
    };
  }

  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: "invalid-json",
      errors: [`The file is not valid JSON: ${errorMessage(err)}`],
    };
  }

  const format = sniffFormat(parsed);
  if (format === null) {
    return {
      ok: false,
      reason: "unsupported-format",
      errors: [
        'Unsupported file format. Expected a Cadence workspace export (a JSON document with format: "cadence.workspace") or a Trello board export (Board menu → Print/Export → JSON).',
      ],
    };
  }

  return format === "cadence"
    ? parseCadence(parsed)
    : parseTrello(parsed, options.convertTrello);
}

function parseCadence(parsed: unknown): ParseImportResult {
  const result = workspaceExportSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: "invalid-document",
      errors: formatZodIssues(result.error),
    };
  }

  const file = result.data;
  // Normalization is field selection, not re-validation: importDocumentSchema
  // is structurally `{ users, projects }` of the same sub-schemas that
  // workspaceExportSchema just validated, so a second 20 MB Zod pass would
  // buy nothing.
  const doc: ImportDocument = { users: file.users, projects: file.projects };

  const integrityErrors = validateDocumentIntegrity(doc);
  if (integrityErrors.length > 0) {
    return { ok: false, reason: "invalid-document", errors: integrityErrors };
  }

  const docSkips = countDocSkips(doc);
  return {
    ok: true,
    sourceFormat: "cadence",
    doc,
    skipped: {
      // Envelope-only sections: representable nowhere in ImportDocument,
      // so they MUST be counted at parse time or they vanish from the report.
      webhooks: file.webhooks.length,
      teams: file.teams.length,
      invitations: file.invitations.length,
      attachments: docSkips.attachments,
      activity: docSkips.activity,
      closedItems: 0,
    },
    warnings: buildParseWarnings(doc),
  };
}

function parseTrello(parsed: unknown, convertTrello: TrelloConverter): ParseImportResult {
  let converted: ImportDocument | TrelloConversion;
  try {
    converted = convertTrello(parsed);
  } catch (err) {
    return {
      ok: false,
      reason: "invalid-document",
      errors:
        err instanceof z.ZodError
          ? formatZodIssues(err)
          : [`The Trello board could not be converted: ${errorMessage(err)}`],
    };
  }

  // Normalize the two accepted return shapes into the wrapper form.
  const conversion: TrelloConversion = isTrelloConversion(converted)
    ? converted
    : { doc: converted };
  const candidateDoc = conversion.doc;
  const converterSkipped: Partial<ImportSkipped> = conversion.skipped ?? {};
  const converterWarnings: string[] = conversion.warnings ?? [];

  // The executor writes this straight to the DB — re-validate the seam so a
  // converter bug becomes a clear 400 here instead of a constraint failure
  // (or silent bad data) mid-import.
  const docResult = importDocumentSchema.safeParse(candidateDoc);
  if (!docResult.success) {
    return {
      ok: false,
      reason: "invalid-document",
      errors: formatZodIssues(docResult.error),
    };
  }
  const doc = docResult.data;

  const integrityErrors = validateDocumentIntegrity(doc);
  if (integrityErrors.length > 0) {
    return { ok: false, reason: "invalid-document", errors: integrityErrors };
  }

  const docSkips = countDocSkips(doc);
  return {
    ok: true,
    sourceFormat: "trello",
    doc,
    skipped: {
      // Doc-derived counts plus converter-domain counts, ADDED (not
      // overwritten) so neither side can silently erase the other's report.
      webhooks: converterSkipped.webhooks ?? 0,
      teams: converterSkipped.teams ?? 0,
      invitations: converterSkipped.invitations ?? 0,
      attachments: docSkips.attachments + (converterSkipped.attachments ?? 0),
      activity: docSkips.activity + (converterSkipped.activity ?? 0),
      closedItems: converterSkipped.closedItems ?? 0,
    },
    warnings: [...converterWarnings, ...buildParseWarnings(doc)],
  };
}

/** Discriminates the two converter return shapes: a wrapper has `doc`, a
 *  bare ImportDocument has `users`/`projects` and never `doc`. */
function isTrelloConversion(value: ImportDocument | TrelloConversion): value is TrelloConversion {
  return "doc" in value;
}

/**
 * Cross-reference checks that the Zod schemas structurally cannot express
 * but the executor structurally depends on. They are ERRORS (not repairs)
 * because there is no honest fallback:
 *
 * - A task whose `taskGroupId` resolves to no group in its project has
 *   nowhere to live — `task.taskGroupId` is NOT NULL with a restrict FK, so
 *   letting it through would guarantee a whole-project rollback with an
 *   opaque SQLite message instead of this named 400.
 * - Duplicate `users[].ref` entries make ref→email resolution ambiguous;
 *   guessing which email wins could assign tasks to the wrong person.
 *
 * (Dangling `labelIds`/`recurrenceParentId` ARE repairable — links can be
 * dropped/nulled without losing the task — so those are executor warnings,
 * not parse errors.)
 */
export function validateDocumentIntegrity(doc: ImportDocument): string[] {
  const errors: string[] = [];

  const seenRefs = new Set<string>();
  for (const u of doc.users) {
    if (seenRefs.has(u.ref)) {
      errors.push(
        `users: duplicate ref "${u.ref}" — user matching would be ambiguous`,
      );
    }
    seenRefs.add(u.ref);
  }

  doc.projects.forEach((p, pi) => {
    const groupIds = new Set(p.taskGroups.map((g) => g.id));
    p.tasks.forEach((t, ti) => {
      if (errors.length >= MAX_REPORTED_ERRORS) return;
      if (!groupIds.has(t.taskGroupId)) {
        errors.push(
          `projects[${pi}].tasks[${ti}] ("${t.title}"): references task group "${t.taskGroupId}", which does not exist in project "${p.name}"`,
        );
      }
    });
  });

  return errors.slice(0, MAX_REPORTED_ERRORS);
}

/** Sum the doc-carried sections that deliberately never import (binary
 *  attachments; archival activity history). */
function countDocSkips(doc: ImportDocument): { attachments: number; activity: number } {
  let attachments = 0;
  let activity = 0;
  for (const p of doc.projects) {
    for (const t of p.tasks) {
      attachments += t.attachments.length;
      activity += t.activity?.length ?? 0;
    }
  }
  return { attachments, activity };
}

/**
 * Warnings about manifest-only data in the doc. Uploaded cover images are a
 * binary that doesn't round-trip (same reason as attachments) but have no
 * dedicated `skipped` counter — a warning is the honest place to say so.
 */
function buildParseWarnings(doc: ImportDocument): string[] {
  const warnings: string[] = [];
  let coverImages = 0;
  for (const p of doc.projects) {
    if (p.coverImage) coverImages += 1;
    for (const t of p.tasks) {
      if (t.coverImage) coverImages += 1;
    }
  }
  if (coverImages > 0) {
    warnings.push(
      `${coverImages} uploaded cover image${coverImages === 1 ? "" : "s"} will not be imported — binary content does not round-trip; download them from the source instance via the manifest URLs.`,
    );
  }
  return warnings;
}

/**
 * Render Zod issues as `path: message` lines (`projects[0].tasks[2].title:
 * …`) so a user can locate the offending value in a 20 MB file, capped at
 * {@link MAX_REPORTED_ERRORS} with an honest remainder line.
 */
function formatZodIssues(error: z.ZodError): string[] {
  const lines = error.issues
    .slice(0, MAX_REPORTED_ERRORS)
    .map((issue) =>
      issue.path.length > 0 ? `${formatPath(issue.path)}: ${issue.message}` : issue.message,
    );
  const remaining = error.issues.length - MAX_REPORTED_ERRORS;
  if (remaining > 0) {
    lines.push(`…and ${remaining} more issue${remaining === 1 ? "" : "s"}`);
  }
  return lines;
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else {
      out = out === "" ? String(seg) : `${out}.${String(seg)}`;
    }
  }
  return out;
}

/**
 * UTF-8 byte length of the raw upload. For string input this counts code
 * units WITHOUT allocating (a `TextEncoder().encode()` round-trip would
 * momentarily double the memory of a near-limit file — the exact pressure
 * the limit guards against).
 */
function byteLength(raw: string | Uint8Array | ArrayBuffer): number {
  if (typeof raw !== "string") {
    return raw.byteLength;
  }
  let bytes = 0;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: the pair encodes one astral code point (4 bytes).
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
