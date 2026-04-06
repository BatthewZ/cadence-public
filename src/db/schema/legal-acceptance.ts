import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

export const legalAcceptance = sqliteTable("legal_acceptance", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  tosVersion: text("tosVersion").notNull(),
  acceptedAt: integer("acceptedAt", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("legal_acceptance_user_idx").on(table.userId),
]);
