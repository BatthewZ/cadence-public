import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { SavedViewState } from "../../shared/schemas/saved-view";
import { user } from "./auth";
import { project } from "./project";

/**
 * Private, per-user-per-project saved views: named snapshots of the task
 * board's URL state (`{ tab, params }`). The URL stays the runtime source of
 * truth — rows here are bookmarks, never live state.
 *
 * `state` is a JSON column typed as {@link SavedViewState} so unknown param
 * keys written by future clients are stored verbatim (the forward-compat
 * contract pinned in saved-view.test.ts). `position` is a fractional index
 * assigned on create; v1 has no reorder endpoint. The unique index makes
 * names unique per (project, creator) — views are private, so two users may
 * each have a "My urgent" view on the same project.
 */
export const savedView = sqliteTable(
  "saved_view",
  {
    id: text("id").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    creatorId: text("creatorId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    state: text("state", { mode: "json" }).$type<SavedViewState>().notNull(),
    position: text("position").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("saved_view_project_creator_idx").on(table.projectId, table.creatorId),
    uniqueIndex("saved_view_project_creator_name_idx").on(
      table.projectId,
      table.creatorId,
      table.name,
    ),
  ],
);
