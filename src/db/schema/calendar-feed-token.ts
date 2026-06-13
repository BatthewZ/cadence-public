import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { workspace } from "./workspace";

/**
 * Calendar feed tokens — the credential behind per-user ICS calendar URLs.
 *
 * ## Why this is a separate table and credential class (not a PAT)
 *
 * Calendar clients (Google, Apple, Outlook) subscribe to a feed by URL and
 * cannot send Authorization headers, so the secret must live in the URL
 * itself (a capability URL). That URL is stored in plaintext by the calendar
 * provider's servers and shows up in request logs — a far weaker custody
 * story than a header-borne PAT. Reusing a PAT here would put a
 * write-capable, scoped API credential into that weak-custody channel.
 *
 * A feed token is therefore deliberately minimal:
 * - single-purpose: it only unlocks the read-only ICS feed endpoint, never
 *   the API (`verifyToken` in `src/api/lib/api-tokens.ts` cheap-rejects
 *   anything that is not `cdn_pat_`-prefixed);
 * - per-user-per-workspace: the `(userId, workspaceId)` unique index pins
 *   one live feed per user per workspace, so "regenerate" is implemented as
 *   replace-the-row, which atomically revokes the old URL;
 * - revocable without collateral damage: rotating a feed token never breaks
 *   the user's PAT-driven automations, and vice versa.
 *
 * Only the HMAC-SHA256 hash of the token is stored (`hashToken` with
 * `TOKEN_HASH_PEPPER`, same primitive as PATs): a DB-only exfiltration does
 * not yield usable feed URLs because verifying a guess offline requires the
 * server-side pepper as well.
 */
export const calendarFeedToken = sqliteTable(
  "calendar_feed_token",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull().unique(),

    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    lastUsedAt: integer("lastUsedAt", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("calendar_feed_token_user_workspace_unique").on(
      table.userId,
      table.workspaceId,
    ),
  ],
);

export type CalendarFeedToken = typeof calendarFeedToken.$inferSelect;
export type NewCalendarFeedToken = typeof calendarFeedToken.$inferInsert;
