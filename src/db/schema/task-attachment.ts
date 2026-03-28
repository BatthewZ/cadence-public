import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { task } from "./task";
import { upload } from "./uploads";

export const taskAttachment = sqliteTable(
  "task_attachment",
  {
    id: text("id").primaryKey(),
    taskId: text("taskId")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    uploadId: text("uploadId")
      .notNull()
      .references(() => upload.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("task_attachment_task_idx").on(table.taskId, table.createdAt)],
);
