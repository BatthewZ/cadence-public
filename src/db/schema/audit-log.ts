import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { apiToken } from "./api-token";
import { user } from "./auth";
import { workspace } from "./workspace";

/**
 * Cross-resource audit ledger for Personal Access Token (PAT) mutations.
 *
 * ## Why this table exists
 *
 * `task_activity` already records mutations on tasks, but tasks are only one
 * of many resources a PAT can touch. The doc claim that "every mutation made
 * via a PAT is attributed" requires a per-token trail across the entire API
 * surface — projects, workspaces, labels, teams, webhooks, invitations,
 * attachments, and the token-management endpoints themselves. Without that
 * trail an operator cannot answer "what has this integration done?" when
 * deciding whether to revoke a misbehaving token.
 *
 * We deliberately model this as a single denormalised ledger rather than as
 * per-resource activity tables for two reasons:
 *
 *  1. The query the table exists to answer is "show me everything this token
 *     touched, regardless of resource type". A unified ledger is one SQL
 *     query; per-resource tables would require a UNION over every resource
 *     plus a follow-up join to resolve names.
 *  2. The surface is open-ended — every new resource shipped after this is a
 *     new place that needs auditing. A single ledger absorbs new resource
 *     types without a schema migration.
 *
 * The user-facing `task_activity` feed is intentionally untouched; it serves
 * a different product purpose (per-task changelog) and would be cluttered if
 * forced to carry every PAT cross-resource event.
 *
 * ## What's recorded
 *
 *  - `workspaceId` — every audit row is scoped to a workspace so queries can
 *    be partitioned per tenant.
 *  - `actorUserId` — the human the token was minted under. Surviving
 *    revocation matters: if the token row is hard-deleted by some future
 *    cleanup, the actor is still attributable.
 *  - `apiTokenId` — `set null` on token cascade so a deleted token does not
 *    erase its own audit trail; the row simply becomes "via deleted token".
 *  - `resourceType` / `resourceId` — derived from the matched route pattern
 *    by the audit middleware. Filterable in the UI for "show me everything
 *    this token did to projects".
 *  - `action` — a verb. `create` / `update` / `delete` for collection /
 *    item mutations, plus verb-style actions for routes like
 *    `/tasks/:id/complete` ("complete") or `/api-tokens/:id/rotate`
 *    ("rotate"). The middleware derives this from the URL pattern.
 *  - `method`, `path`, `status` — raw HTTP semantics retained so an
 *    investigator can reconstruct the exact request shape even if the
 *    derivation logic changes later. `status` is captured AFTER the handler
 *    runs so only 2xx responses are persisted (failed requests do not pollute
 *    the audit trail).
 *  - `metadata` — JSON-encoded grab-bag for route params (project id, etc.)
 *    that supplement the resource pointer. Kept as TEXT so the column is
 *    schema-flexible across future routes.
 *
 * ## Indexes
 *
 * The three indexes target the three audit queries that matter:
 *  - `(workspaceId, createdAt)` — "show me workspace X's audit trail"
 *  - `(apiTokenId, createdAt)` — "show me everything this token did"
 *  - `(resourceType, resourceId)` — "who touched this project?"
 *
 * Reverse chronological reads are the common case so each composite index
 * leads with the grouping column and trails with `createdAt` for fast range
 * scans.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    actorUserId: text("actorUserId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    apiTokenId: text("apiTokenId").references(() => apiToken.id, {
      onDelete: "set null",
    }),
    resourceType: text("resourceType").notNull(),
    resourceId: text("resourceId"),
    action: text("action").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    metadata: text("metadata"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_log_workspace_idx").on(table.workspaceId, table.createdAt),
    index("audit_log_token_idx").on(table.apiTokenId, table.createdAt),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_log_actor_idx").on(table.actorUserId, table.createdAt),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
