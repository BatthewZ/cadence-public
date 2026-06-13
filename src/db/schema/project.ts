import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { StoredUnsplashCoverPayload } from "../../shared/schemas/unsplash";
import type { ProjectRole } from "../../shared/types/roles";
import { user } from "./auth";
import { workspace } from "./workspace";

export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    icon: text("icon"),
    coverImageKey: text("cover_image_key"),
    coverImagePosition: integer("cover_image_position"),
    coverUnsplash: text("cover_unsplash", { mode: "json" }).$type<StoredUnsplashCoverPayload>(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
    theme: text("theme"),
    budget: integer("budget"),
    autoAssignCreator: integer("auto_assign_creator", { mode: "boolean" }).notNull().default(false),
    position: text("position"),
  },
  (table) => [
    index("project_workspace_idx").on(table.workspaceId),
    index("project_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
  ],
);

export const projectMember = sqliteTable(
  "project_member",
  {
    id: text("id").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member").$type<ProjectRole>(),
    addedAt: integer("addedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("project_member_project_user_unique").on(
      table.projectId,
      table.userId,
    ),
    index("project_member_user_idx").on(table.userId),
  ],
);
