/**
 * Workspace import endpoint — `POST /api/workspaces/:workspaceId/import`.
 *
 * The HTTP face of the import pipeline. All real work lives in the modules
 * this handler composes — `import/parse.ts` (size guard → JSON → sniff →
 * validation → {@link ImportDocument}), `import/trello.ts` (Trello board →
 * the same document shape) and `import/executor.ts` (user matching, ID
 * remapping, chunked batched writes, per-project compensating rollback).
 * Keeping the handler to composition is what kept those three units
 * independently unit-testable; this file owns only the HTTP-shaped
 * decisions, each of which is pinned by `import.handlers.test.ts`:
 *
 * - **Multipart upload, raw bytes straight to the parser.** The file is
 *   read via `c.req.parseBody()` (the uploads.handlers.ts precedent) and
 *   handed to `parseImportFile` as an `ArrayBuffer`, NOT pre-decoded text —
 *   the parser's byte-size guard runs on `byteLength` BEFORE any decode or
 *   `JSON.parse`, which is the entire point of the 20 MB cap (parse + Zod +
 *   insert rows cost ~4-5x the file size in a 128 MB isolate).
 *
 * - **Status mapping is the parser's `reason` contract**: `"too-large"` →
 *   413 (the request entity itself is the problem), every other parse/
 *   validation failure → 400 with the parser's user-facing `errors` lines
 *   verbatim (`projects[0].tasks[2].title: …`), so a user can locate the
 *   offending value in a 20 MB file.
 *
 * - **Stateless dry-run** (`?dryRun=true`): same endpoint, same parsing,
 *   `previewImport` instead of `executeImport`, ZERO writes. The client
 *   re-uploads the file on confirm — a second 20 MB upload is strictly
 *   cheaper than building R2 temp-file storage with TTL cleanup for a
 *   two-step flow (plan design decision 5). Nothing is persisted between
 *   the preview request and the commit request, by design.
 *
 * - **Audit on COMMIT only, never on dry-run.** The plan says "audit the
 *   import"; this handler makes the boundary explicit: the audit ledger
 *   records workspace data MUTATIONS ("who changed this workspace's data,
 *   when"), and a dry run reads the workspace's member list and writes
 *   nothing. Auditing previews would bury real ingress events under a row
 *   per validation attempt and make `action: "import"` unreliable as a
 *   mutation record. (Export audits every download because every download
 *   IS the egress event; a preview is not an ingress event.) Pinned by the
 *   handler tests.
 *
 * - **Report assembly merges the two warning/skip sources.** The parse
 *   stage owns the `skipped` ledger (webhooks/teams/invitations exist only
 *   in the export envelope — the executor never even sees them — plus
 *   doc-counted attachments/activity and Trello `closedItems`); the
 *   executor owns repair warnings and unmatched users. The response is the
 *   union, shaped by `importPreviewSchema` / `importResultSchema` so the
 *   React panes and this endpoint share one contract.
 *
 * Route-level guards (wired in workspaces.routes.ts): `requireAuth` +
 * `requireWorkspaceRole("owner", "admin")` + 10/hour rate limit — import
 * is a workspace-wide data ingress and is gated exactly like export's
 * egress, one notch looser on rate because the preview→confirm flow costs
 * two requests per real import.
 */

import type { Context } from "hono";

import type {
  ImportPreview,
  ImportResult,
} from "../../../shared/schemas/workspace-import";
import type { AppEnv } from "../../env";
import { recordWorkspaceDataEvent } from "../../lib/audit-log";
import { errorResponse } from "../../lib/error-response";
import { requireParam } from "../../lib/params";
import { executeImport, previewImport } from "./import/executor";
import { parseImportFile } from "./import/parse";
import { convertTrelloBoard } from "./import/trello";

/**
 * `POST /api/workspaces/:workspaceId/import[?dryRun=true]`
 *
 * Body: `multipart/form-data` with a single `file` field containing a
 * Cadence workspace export or a Trello single-board JSON export (the
 * parser sniffs which). Responds with an `importPreviewSchema` body for
 * dry runs and an `importResultSchema` body for commits — discriminated by
 * the `dryRun` literal so the client narrows on the same flag it sent.
 */
export async function importWorkspaceData(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");

  const dryRunParam = c.req.query("dryRun");
  const dryRun = dryRunParam === "1" || dryRunParam === "true";

  // parseBody throws on bodies that aren't form-encoded at all (e.g. a raw
  // JSON POST) — that is a client mistake, not a server error, so it maps
  // to a named 400 instead of bubbling into a 500.
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return errorResponse(
      c,
      'Expected a multipart/form-data upload with a "file" field containing the export file.',
      400,
    );
  }

  const file = body["file"];
  if (!(file instanceof File)) {
    return errorResponse(
      c,
      'No file provided. Upload the export file in a "file" form field.',
      400,
    );
  }

  // Raw bytes, not text: the parser's size guard must run on byte length
  // BEFORE any decode/JSON.parse (see module JSDoc).
  const raw = await file.arrayBuffer();
  const parsed = parseImportFile(raw, { convertTrello: convertTrelloBoard });

  if (!parsed.ok) {
    // The parser's reason contract: "too-large" is an entity-size problem
    // (413); everything else is a malformed/invalid document (400). The
    // `errors` lines are user-facing by contract and returned verbatim —
    // they are how a user locates the offending value in a large file.
    const status = parsed.reason === "too-large" ? 413 : 400;
    return errorResponse(
      c,
      parsed.errors[0] ?? "The import file could not be processed.",
      status,
      { errors: parsed.errors },
    );
  }

  // Each imported project costs ~5-20 D1 subrequests (sequential FK-ordered
  // batches). Cloudflare's Free plan caps a Worker invocation at 50
  // subrequests, so very large files can exhaust the budget mid-import on
  // self-hosted Free-plan deployments. The plan's risk analysis pins the
  // warning threshold at 40 projects; surfacing it in the preview (and
  // result) lets the user split the file BEFORE a partial import, instead
  // of discovering the ceiling via failed projects.
  const SUBREQUEST_WARNING_PROJECT_COUNT = 40;
  const budgetWarnings =
    parsed.doc.projects.length > SUBREQUEST_WARNING_PROJECT_COUNT
      ? [
          `This file contains ${parsed.doc.projects.length} projects. Imports of more than ${SUBREQUEST_WARNING_PROJECT_COUNT} projects may exceed Cloudflare's Free-plan subrequest budget — consider splitting the file or importing in stages.`,
        ]
      : [];

  if (dryRun) {
    // Stateless preview: zero writes, no audit row (see module JSDoc for
    // both decisions). previewImport shares repairProject with the commit
    // path, so these warnings are exactly the warnings a commit would act on.
    const preview = await previewImport(db, workspaceId, parsed.doc);
    const response: ImportPreview = {
      dryRun: true,
      sourceFormat: parsed.sourceFormat,
      counts: preview.counts,
      unmatchedUsers: preview.unmatchedUsers,
      skipped: parsed.skipped,
      warnings: [...parsed.warnings, ...budgetWarnings, ...preview.warnings],
    };
    return c.json(response);
  }

  const report = await executeImport(db, workspaceId, user.id, parsed.doc);

  // Audit the ingress AFTER the writes so the metadata reports what
  // actually happened (created counts + rolled-back project count), not
  // what the file promised. recordWorkspaceDataEvent defers the insert off
  // the response path and attributes a PAT when one authenticated the call.
  recordWorkspaceDataEvent(c, {
    workspaceId,
    actorUserId: user.id,
    action: "import",
    metadata: {
      sourceFormat: parsed.sourceFormat,
      ...report.counts,
      failedProjects: report.failedProjects.length,
    },
  });

  const response: ImportResult = {
    dryRun: false,
    sourceFormat: parsed.sourceFormat,
    counts: report.counts,
    unmatchedUsers: report.unmatchedUsers,
    skipped: parsed.skipped,
    warnings: [...parsed.warnings, ...budgetWarnings, ...report.warnings],
    failedProjects: report.failedProjects,
  };
  return c.json(response);
}
