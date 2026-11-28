import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * One row per `Idempotency-Key` a user has sent on a mutation. Owned by
 * `src/api/middleware/idempotency.ts`; semantics in docs/api/api.md.
 *
 * `status` NULL means pending: the first request with this key is still
 * running, or crashed before it could record its response.
 */
export const idempotencyKey = sqliteTable(
  "idempotency_key",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: integer("status"),
    responseBody: text("responseBody"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.key] }),
    index("idempotency_key_created_idx").on(table.createdAt),
  ]
);

export type IdempotencyKey = typeof idempotencyKey.$inferSelect;
