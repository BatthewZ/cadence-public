import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { invitation } from "./invitation";
import { project } from "./project";
import { comment, task } from "./task";
import { workspace } from "./workspace";

export const notification = sqliteTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),

    workspaceId: text("workspaceId").references(() => workspace.id, {
      onDelete: "cascade",
    }),
    projectId: text("projectId").references(() => project.id, {
      onDelete: "cascade",
    }),
    taskId: text("taskId").references(() => task.id, {
      onDelete: "cascade",
    }),
    commentId: text("commentId").references(() => comment.id, {
      onDelete: "cascade",
    }),
    invitationId: text("invitationId").references(() => invitation.id, {
      onDelete: "cascade",
    }),
    actorId: text("actorId").references(() => user.id, {
      onDelete: "set null",
    }),

    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    readAt: integer("readAt", { mode: "timestamp" }),
  },
  (table) => [
    index("notification_user_read_idx").on(
      table.userId,
      table.read,
      table.createdAt,
    ),
    index("notification_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);
