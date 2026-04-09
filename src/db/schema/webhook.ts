import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { project } from "./project";
import { workspace } from "./workspace";

export const webhook = sqliteTable(
  "webhook",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("projectId").references(() => project.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    consecutiveFailures: integer("consecutiveFailures").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("webhook_workspace_idx").on(table.workspaceId),
    index("webhook_workspace_active_idx").on(table.workspaceId, table.active),
    index("webhook_project_idx").on(table.projectId),
  ],
);

export const webhookDelivery = sqliteTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhookId")
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    statusCode: integer("statusCode"),
    response: text("response"),
    success: integer("success", { mode: "boolean" }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    maxAttempts: integer("maxAttempts").notNull().default(5),
    nextRetryAt: integer("nextRetryAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    lastAttemptAt: integer("lastAttemptAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("webhook_delivery_webhook_created_idx").on(
      table.webhookId,
      table.createdAt,
    ),
    index("webhook_delivery_success_retry_idx").on(
      table.success,
      table.nextRetryAt,
    ),
  ],
);
