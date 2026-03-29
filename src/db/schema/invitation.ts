import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { WorkspaceRole } from "../../shared/types/roles";
import { user } from "./auth";
import { workspace } from "./workspace";

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member").$type<WorkspaceRole>(),
    invitedBy: text("invitedBy").references(() => user.id, {
      onDelete: "set null",
    }),
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    acceptedAt: integer("acceptedAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("invitation_token_unique").on(table.token),
    index("invitation_workspace_status_idx").on(table.workspaceId, table.status),
    index("invitation_email_status_expires_idx").on(table.email, table.status, table.expiresAt),
  ],
);
