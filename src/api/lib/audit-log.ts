/**
 * Audit-ledger writer for Personal Access Token (PAT) mutations and
 * workspace-level data events (export/import).
 *
 * Inserts a single row into `audit_log` per successful PAT-attributed
 * mutation. Wired into the request pipeline by
 * `src/api/middleware/audit-pat.ts`, which derives the resource type,
 * resource id, and action verb from the matched route pattern and then
 * delegates to `recordPatAuditLog` here.
 *
 * `recordWorkspaceDataEvent` extends the same ledger to workspace data
 * egress/ingress (export downloads, imports). These events matter to the
 * ledger for a different reason than PAT mutations: an export is a
 * workspace-WIDE data egress, so "who exported this workspace, when, and
 * with what credentials" is exactly the question an operator asks after a
 * leak. Unlike the PAT path, these rows are written for cookie sessions
 * too — `audit_log.apiTokenId` is nullable precisely so human-initiated
 * events are attributable without a token.
 *
 * Why the writer is split from the middleware:
 *
 *  - The middleware's job is **derivation** (parse the route, decide
 *    whether to audit). The writer's job is **persistence** (assemble the
 *    insert, defer it, swallow errors). Splitting them lets the
 *    derivation logic be unit-tested without standing up a DB and lets
 *    other code paths (e.g. explicit mint/rotate/revoke events) reuse the
 *    persistence path.
 *  - Writes go through `deferWork` so the response is never blocked by
 *    audit I/O. A failed audit insert is logged but never propagated —
 *    losing one audit row to a transient D1 hiccup is acceptable; failing
 *    a legitimate API call because the ledger refused is not.
 *
 * The row never carries plaintext, hash material, or request bodies. Only
 * pre-redacted metadata (route params + HTTP envelope) is persisted, so
 * a leaked audit row does not enable the same attacks as a leaked DB row.
 */

import type { Context } from "hono";

import { auditLog } from "../../db/schema";
import type { AppEnv } from "../env";
import { deferWork } from "./defer";

/**
 * Mint a fresh id for an `audit_log` row. Uses `crypto.randomUUID()` to
 * stay consistent with every other id column in the codebase (workspace,
 * project, task, api_token, etc.). If a ULID library is adopted later this
 * helper is the single switch-point.
 */
export function newAuditLogId(): string {
  return crypto.randomUUID();
}

/**
 * Generalized audit row input shared by every writer in this module.
 * `apiTokenId` is nullable here (unlike {@link RecordPatAuditLogInput})
 * because cookie-authenticated events have no token to attribute.
 */
type AuditLogEventInput = {
  apiTokenId: string | null;
  actorUserId: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string | null;
  action: string;
  method: string;
  path: string;
  status: number;
  /**
   * Optional structured metadata. Route params, derived ids, etc. The
   * writer JSON-encodes a non-empty object before insert; `null` / empty
   * objects collapse to a SQL NULL so callers do not pay storage for
   * trivially empty rows.
   */
  metadata?: Record<string, unknown> | null;
};

export type RecordPatAuditLogInput = AuditLogEventInput & {
  /** PAT events are by definition token-attributed — never null. */
  apiTokenId: string;
};

/**
 * Single persistence path for every audit row (CLAUDE.md rule 4: one
 * source of truth — `recordPatAuditLog` and `recordWorkspaceDataEvent`
 * both delegate here instead of carrying their own copy of the insert).
 *
 * Fire-and-forget by design: writes go through `deferWork` so the response
 * is never blocked by audit I/O, and errors are caught and logged because
 *  - The caller has no meaningful recourse (the user-visible work is
 *    already done).
 *  - A failing audit table must not break the API surface; the operational
 *    response is to alert on the log line, not to fail the request.
 *
 * `op` names the public entry point in the error log line so an alert
 * still identifies which code path lost a row.
 */
function persistAuditLogRow(
  c: Context<AppEnv>,
  op: string,
  input: AuditLogEventInput,
): void {
  deferWork(c, async () => {
    try {
      const db = c.get("db");
      const metadataJson =
        input.metadata && Object.keys(input.metadata).length > 0
          ? JSON.stringify(input.metadata)
          : null;

      await db.insert(auditLog).values({
        id: newAuditLogId(),
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        apiTokenId: input.apiTokenId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        action: input.action,
        method: input.method,
        path: input.path,
        status: input.status,
        metadata: metadataJson,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          lib: "audit-log",
          op,
          apiTokenId: input.apiTokenId,
          workspaceId: input.workspaceId,
          path: input.path,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });
}

/**
 * Fire-and-forget audit insert for PAT-attributed mutations. Designed to
 * be called from after-response middleware: by the time we know `status`,
 * the response has already been generated, so blocking on the insert
 * would only delay the client. See {@link persistAuditLogRow} for the
 * defer/swallow-errors rationale.
 */
export function recordPatAuditLog(
  c: Context<AppEnv>,
  input: RecordPatAuditLogInput,
): void {
  persistAuditLogRow(c, "recordPatAuditLog", input);
}

export type RecordWorkspaceDataEventInput = {
  workspaceId: string;
  actorUserId: string;
  /** Workspace-wide data movement verbs — egress ("export") / ingress ("import"). */
  action: "export" | "import";
  /** Caller-supplied context (e.g. `includeActivity`, entity counts). */
  metadata?: Record<string, unknown> | null;
};

/**
 * Audit a workspace-level data event (export download / import commit).
 *
 * Why this is a distinct entry point rather than a `recordPatAuditLog`
 * call at the route: export/import are reachable by BOTH cookie sessions
 * and PATs, and the PAT writer's contract requires a token id. Here the
 * token is attributed when present (`c.get("apiToken")`) and the row is
 * still written without one — the audit trail for "who pulled a full copy
 * of this workspace's data" must not have a hole for human-initiated
 * downloads. `status` is fixed at 200 because callers invoke this only
 * after authorization has passed and the response is being produced;
 * failed attempts never reach the handler body.
 */
export function recordWorkspaceDataEvent(
  c: Context<AppEnv>,
  input: RecordWorkspaceDataEventInput,
): void {
  persistAuditLogRow(c, "recordWorkspaceDataEvent", {
    apiTokenId: c.get("apiToken")?.id ?? null,
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
    resourceType: "workspace",
    resourceId: input.workspaceId,
    action: input.action,
    method: c.req.method,
    path: c.req.path,
    status: 200,
    metadata: input.metadata ?? null,
  });
}
