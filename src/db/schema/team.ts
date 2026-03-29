import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { TeamRole } from "../../shared/types/roles";
import { user } from "./auth";
import { workspace } from "./workspace";

export const team = sqliteTable(
  "team",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("team_workspace_idx").on(table.workspaceId)],
);

export const teamMember = sqliteTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("teamId")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member").$type<TeamRole>(),
    joinedAt: integer("joinedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("team_member_team_user_unique").on(
      table.teamId,
      table.userId,
    ),
    index("team_member_user_idx").on(table.userId),
  ],
);
