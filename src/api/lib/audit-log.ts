/**
 * Audit-ledger writer for Personal Access Token (PAT) mutations.
 *
 * Inserts a single row into `audit_log` per successful PAT-attributed
 * mutation. Wired into the request pipeline by
 * `src/api/middleware/audit-pat.ts`, which derives the resource type,
 * resource id, and action verb from the matched route pattern and then
 * delegates to `recordPatAuditLog` here.
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

export type RecordPatAuditLogInput = {
  apiTokenId: string;
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

/**
 * Fire-and-forget audit insert. Designed to be called from after-response
 * middleware: by the time we know `status`, the response has already been
 * generated, so blocking on the insert would only delay the client.
 *
 * Errors are caught and logged because:
 *  - The caller has no meaningful recourse (the user-visible work is
 *    already done).
 *  - A failing audit table must not break the API surface; the operational
 *    response is to alert on the log line, not to fail the request.
 */
export function recordPatAuditLog(
  c: Context<AppEnv>,
  input: RecordPatAuditLogInput,
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
          op: "recordPatAuditLog",
          apiTokenId: input.apiTokenId,
          workspaceId: input.workspaceId,
          path: input.path,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });
}
