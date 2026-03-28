import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

export const upload = sqliteTable(
  "upload",
  {
    id: text("id").primaryKey(),
    userId: text("userId").references(() => user.id, {
      onDelete: "set null",
    }),
    key: text("key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mimeType").notNull(),
    size: integer("size").notNull(),
    purpose: text("purpose").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("upload_user_idx").on(table.userId)],
);
