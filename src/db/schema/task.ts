import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  (table) => [index("subtask_task_idx").on(table.taskId)],
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
  (table) => [index("comment_task_idx").on(table.taskId)],
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
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("task_activity_task_idx").on(table.taskId, table.createdAt)],
);
