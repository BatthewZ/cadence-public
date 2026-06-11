import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { UnsplashCoverPayload } from "../../shared/schemas/unsplash";
import { apiToken } from "./api-token";
import { user } from "./auth";
import { project } from "./project";

export const taskGroup = sqliteTable(
  "task_group",
  {
    id: text("id").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    isCompletionGroup: integer("is_completion_group", { mode: "boolean" })
      .notNull()
      .default(false),
    position: text("position").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("task_group_project_idx").on(table.projectId),
    index("task_group_project_updated_idx").on(table.projectId, table.updatedAt),
    uniqueIndex("task_group_project_position_unique_idx").on(
      table.projectId,
      table.position,
    ),
  ],
);

export const task = sqliteTable(
  "task",
  {
    id: text("id").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    taskGroupId: text("taskGroupId")
      .notNull()
      .references(() => taskGroup.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: text("assigneeId").references(() => user.id, {
      onDelete: "set null",
    }),
    priority: text("priority").notNull().default("none"),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completedAt", { mode: "timestamp" }),
    completedBy: text("completedBy").references(() => user.id, {
      onDelete: "set null",
    }),
    dueDate: integer("dueDate", { mode: "timestamp" }),
    cost: integer("cost"),  // cost in cents (nullable, optional)
    icon: text("icon"),
    coverImageKey: text("cover_image_key"),
    coverImagePosition: integer("cover_image_position"),
    coverUnsplash: text("cover_unsplash", { mode: "json" }).$type<UnsplashCoverPayload>(),
    recurrenceRule: text("recurrence_rule"),
    recurrenceParentId: text("recurrence_parent_id"),
    recurrenceSeriesId: text("recurrence_series_id"),
    position: text("position").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("task_assignee_completed_due_idx").on(table.assigneeId, table.completed, table.dueDate),
    index("task_group_position_idx").on(table.taskGroupId, table.position),
    index("task_project_completed_idx").on(table.projectId, table.completed),
    index("task_project_assignee_idx").on(table.projectId, table.assigneeId),
    index("task_project_due_completed_idx").on(table.projectId, table.dueDate, table.completed),
    index("task_project_updated_idx").on(table.projectId, table.updatedAt),
    foreignKey({
      columns: [table.recurrenceParentId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    index("task_recurrence_parent_idx").on(table.recurrenceParentId),
    uniqueIndex("task_recurrence_parent_unique_idx")
      .on(table.recurrenceParentId)
      .where(sql`recurrence_parent_id IS NOT NULL`),
    index("task_recurrence_series_idx").on(table.recurrenceSeriesId),
    uniqueIndex("task_group_position_unique_idx").on(
      table.taskGroupId,
      table.position,
    ),
  ],
);

export const subtask = sqliteTable(
  "subtask",
  {
    id: text("id").primaryKey(),
    taskId: text("taskId")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    position: text("position").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("subtask_task_idx").on(table.taskId),
    uniqueIndex("subtask_task_position_unique_idx").on(
      table.taskId,
      table.position,
    ),
  ],
);

export const comment = sqliteTable(
  "comment",
  {
    id: text("id").primaryKey(),
    taskId: text("taskId")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    authorId: text("authorId").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("comment_task_created_idx").on(table.taskId, table.createdAt)],
);

export const taskActivity = sqliteTable(
  "task_activity",
  {
    id: text("id").primaryKey(),
    taskId: text("taskId")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    actorId: text("actorId").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    field: text("field"),
    oldValue: text("oldValue"),
    newValue: text("newValue"),
    apiTokenId: text("apiTokenId").references(() => apiToken.id, { onDelete: "set null" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("task_activity_task_idx").on(table.taskId, table.createdAt)],
);
