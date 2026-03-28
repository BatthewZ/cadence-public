import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { project } from "./project";
import { task } from "./task";

export const label = sqliteTable(
  "label",
  {
    id: text("id").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("label_project_name_idx").on(table.projectId, table.name),
  ],
);

export const taskLabel = sqliteTable(
  "task_label",
  {
    id: text("id").primaryKey(),
    taskId: text("taskId")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    labelId: text("labelId")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("task_label_task_label_idx").on(table.taskId, table.labelId),
    index("task_label_label_idx").on(table.labelId),
  ],
);
