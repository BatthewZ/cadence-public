import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { WorkspaceRole } from "../../shared/types/roles";
import { user } from "./auth";

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    ownerId: text("ownerId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
    theme: text("theme"),
    /**
     * Admin-configurable governance toggles, stored as a JSON object.
     *
     * Deliberately nullable with no DB-side default: `null` means "every
     * toggle at its code default", which is what lets a new toggle ship
     * without a backfill. Never read this column directly — resolve it
     * through `resolveWorkspacePolicy` (`src/shared/types/workspace-policy.ts`),
     * which is the single source of truth for the defaults and is total over
     * malformed input.
     */
    policy: text("policy"),
  },
  (table) => [
    uniqueIndex("workspace_owner_slug_unique").on(table.ownerId, table.slug),
  ],
);

export const workspaceMember = sqliteTable(
  "workspace_member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member").$type<WorkspaceRole>(),
    invitedBy: text("invitedBy").references(() => user.id, {
      onDelete: "set null",
    }),
    joinedAt: integer("joinedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("workspace_member_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_member_user_idx").on(table.userId),
  ],
);
