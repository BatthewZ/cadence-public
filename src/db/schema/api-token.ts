import { type AnySQLiteColumn,index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { workspace } from "./workspace";

export const apiToken = sqliteTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("tokenHash").notNull().unique(),
    tokenPrefix: text("tokenPrefix").notNull(),

    // Permissions
    scopes: text("scopes").notNull(),                  // JSON string array
    projectScope: text("projectScope").notNull(),      // "all" | "selected"
    projectIds: text("projectIds"),                    // JSON array; null when projectScope="all"

    // Lifecycle
    lastUsedAt: integer("lastUsedAt", { mode: "timestamp" }),
    expiresAt: integer("expiresAt", { mode: "timestamp" }),
    revokeAt: integer("revokeAt", { mode: "timestamp" }),
    revokedAt: integer("revokedAt", { mode: "timestamp" }),
    rotatedToId: text("rotatedToId").references((): AnySQLiteColumn => apiToken.id),

    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("api_token_user_idx").on(table.userId),
    index("api_token_workspace_idx").on(table.workspaceId),
    index("api_token_revoke_at_idx").on(table.revokeAt),
  ],
);

export type ApiToken = typeof apiToken.$inferSelect;
export type NewApiToken = typeof apiToken.$inferInsert;
