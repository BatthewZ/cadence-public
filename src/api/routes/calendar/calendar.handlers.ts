/**
 * Handlers for the personal ICS calendar feed and its management surface.
 *
 * ## Two very different trust models in one file
 *
 * 1. **The feed endpoint** (`GET /api/calendar/feed/:token`) is a
 *    capability-URL: the `cdn_cal_…` token in the path IS the credential.
 *    Calendar clients (Google, Apple, Outlook) subscribe by URL and cannot
 *    send Authorization headers, so this endpoint deliberately runs with no
 *    `requireAuth`. That weak-custody channel (provider servers store the URL
 *    in plaintext, it shows up in request logs) is exactly why feed tokens
 *    are a separate, read-only credential class — see
 *    [calendar-feed-token.ts](../../../db/schema/calendar-feed-token.ts).
 *
 * 2. **The management surface** (`/api/workspaces/:workspaceId/calendar-feed`)
 *    is cookie-only. PAT callers are rejected at the middleware layer
 *    (`rejectPatAuth()` in calendar.routes.ts) for the same reason PATs
 *    cannot manage PATs: a leaked API token must never be able to mint a
 *    *different* credential class for itself and quietly establish a second
 *    foothold that survives the PAT's revocation.
 *
 * ## Security invariants the feed handler enforces (each one is load-bearing)
 *
 * - **Prefix cheap-reject BEFORE hashing** — garbage paths must not cost an
 *   HMAC computation or a DB lookup. Mirrors `verifyToken` in
 *   [api-tokens.ts](../../lib/api-tokens.ts).
 * - **Uniform 404 on every failure mode** (bad prefix, unknown hash, revoked
 *   membership). Any distinction between failure modes is an oracle that
 *   helps an attacker enumerate live tokens; a capability URL gets exactly
 *   one bit of information back: "this URL works" or "this URL does not".
 *   404 (not 401/403) also avoids advertising that an auth surface exists.
 * - **Workspace-membership re-check at request time** — the token row alone
 *   is not enough. Removing a user from the workspace must kill their feed
 *   instantly, without a sweep job, even though the token row still exists.
 * - **No task descriptions in the output** — events carry only the title,
 *   project name, and a link back into the app. Third-party calendar storage
 *   should never receive full task bodies.
 *
 * ## Date math convention (this repo's highest-risk bug class)
 *
 * `dueDate`/`startDate` are stored as UTC-midnight timestamps. We derive the
 * `YYYY-MM-DD` strings the ICS generator needs via `.toISOString().slice(0, 10)`
 * — never local-time accessors, which would shift the day for any server or
 * test machine west of UTC. DTEND is exclusive per RFC 5545: a task due
 * 2026-03-10 spans DTSTART=20260310 / DTEND=20260311. The +1-day math happens
 * HERE (single source of truth); the generator writes it verbatim.
 */

import { and, asc, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import type { Context } from "hono";

import {
  calendarFeedToken,
  project,
  task,
  user,
  workspace,
  workspaceMember,
} from "../../../db/schema";
import { generateICS, type ICSEvent } from "../../../shared/lib/ics";
import type { AppEnv } from "../../env";
import {
  CALENDAR_FEED_TOKEN_PREFIX,
  hashToken,
  mintToken,
  requireTokenHashPepper,
} from "../../lib/api-tokens";
import { deferWork } from "../../lib/defer";
import { errorResponse, throwWithContext } from "../../lib/error-response";
import { requireParam } from "../../lib/params";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds in one day. Used for the exclusive-DTEND +1-day math. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long completed tasks stay in the feed after completion.
 *
 * Why completed tasks are included at all: subscription clients treat an
 * event that vanishes between fetches as deleted data — a user who checks
 * off a task and then sees it silently disappear from their calendar reads
 * that as data loss. Keeping it for 30 days, marked `STATUS:COMPLETED`,
 * gives the calendar a truthful "done" state instead of a hole.
 */
export const COMPLETED_RETENTION_MS = 30 * DAY_MS;

/**
 * Hard cap on events per feed. 500 covers any realistic personal workload
 * while bounding worst-case response size and D1 row reads — a feed URL is
 * unauthenticated-by-design, so its cost ceiling must be fixed. The query is
 * covered by `task_assignee_completed_due_idx`.
 */
export const FEED_TASK_LIMIT = 500;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * UTC-midnight `Date` → `"YYYY-MM-DD"` via ISO-string slicing — the repo's
 * date convention. Local-time getters would report the previous day for any
 * runtime west of UTC, which is the off-by-one bug class the ICS module's
 * JSDoc warns about.
 */
function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** App origin with trailing slashes stripped, for building absolute URLs. */
function appBaseUrl(c: Context<AppEnv>): string {
  return (c.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
}

/**
 * Fire-and-forget bump of `calendar_feed_token.lastUsedAt`.
 *
 * Mirrors the PAT `bumpLastUsedAt` pattern: deferred via `deferWork` so the
 * feed response is never blocked by telemetry, and errors are swallowed
 * (worst case is a stale "Never used" indicator in the settings UI). The
 * timestamp matters for users deciding whether a feed URL is still wired
 * into a calendar client before revoking it.
 */
function bumpFeedLastUsedAt(c: Context<AppEnv>, feedTokenId: string): void {
  deferWork(c, async () => {
    try {
      const db = c.get("db");
      await db
        .update(calendarFeedToken)
        .set({ lastUsedAt: new Date() })
        .where(eq(calendarFeedToken.id, feedTokenId));
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          handler: "getCalendarFeed",
          op: "bumpFeedLastUsedAt",
          feedTokenId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// getCalendarFeed — GET /calendar/feed/:token
// ---------------------------------------------------------------------------

/**
 * Serve the per-user, per-workspace ICS feed.
 *
 * Verification pipeline (order matters — see module JSDoc for the whys):
 *  1. Strip an optional `.ics` suffix. Some calendar clients (and humans
 *     pasting URLs) expect feed URLs to end in `.ics`; the token itself
 *     never contains a dot, so stripping is unambiguous.
 *  2. Cheap-reject any token without the `cdn_cal_` prefix — no hash, no DB.
 *     This is also what guarantees a PAT (`cdn_pat_…`) pasted into a feed
 *     URL can never unlock this endpoint.
 *  3. HMAC the plaintext with the server pepper and look up by hash.
 *  4. Join the owning user and re-check live workspace membership.
 *  5. Every failure → identical 404.
 *
 * On success: tasks assigned to the owner in the token's workspace, with a
 * due date, that are open OR completed within the last 30 days. SUMMARY is
 * the task title; DESCRIPTION is the project name + canonical task URL —
 * deliberately NOT the task description (see module JSDoc). UIDs are
 * `task-<id>@cadence`, stable across fetches so subscription clients update
 * events in place instead of duplicating them.
 */
export async function getCalendarFeed(c: Context<AppEnv>) {
  const db = c.get("db");
  const rawToken = requireParam(c, "token");
  const plaintext = rawToken.endsWith(".ics")
    ? rawToken.slice(0, -".ics".length)
    : rawToken;

  // Cheap reject: wrong-prefix garbage must not cost an HMAC or a DB lookup,
  // and PAT plaintexts must be structurally unable to open the feed.
  if (!plaintext.startsWith(CALENDAR_FEED_TOKEN_PREFIX)) {
    return errorResponse(c, "Not found", 404);
  }

  const pepper = requireTokenHashPepper(c.env.TOKEN_HASH_PEPPER);
  const tokenHash = await hashToken(plaintext, pepper);

  // One round-trip resolves the token row, proves the owning user still
  // exists, fetches the workspace (name for X-WR-CALNAME, slug for task
  // URLs), and re-checks membership. The LEFT JOIN on workspace_member is
  // the revocation kill-switch: removing the user from the workspace makes
  // `membership` null on the very next fetch.
  const [row] = await db
    .select({
      feedToken: calendarFeedToken,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      membership: workspaceMember,
    })
    .from(calendarFeedToken)
    .innerJoin(user, eq(user.id, calendarFeedToken.userId))
    .innerJoin(workspace, eq(workspace.id, calendarFeedToken.workspaceId))
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.workspaceId, calendarFeedToken.workspaceId),
        eq(workspaceMember.userId, calendarFeedToken.userId),
      ),
    )
    .where(eq(calendarFeedToken.tokenHash, tokenHash))
    .limit(1);

  // Uniform 404 — unknown token and revoked membership must be
  // indistinguishable (no oracle for enumerating live feed URLs).
  if (!row || !row.membership) {
    return errorResponse(c, "Not found", 404);
  }

  bumpFeedLastUsedAt(c, row.feedToken.id);

  const { userId, workspaceId } = row.feedToken;
  const completedCutoff = new Date(Date.now() - COMPLETED_RETENTION_MS);

  // A task qualifies for the feed if it carries EITHER a due date or a start
  // date — a start-only task (work that begins on a day with no deadline) is
  // still scheduled work the subscriber wants on their calendar, so it is no
  // longer silently dropped. Ordered by the day the event actually sits on
  // (due date, or the start date when there is no due date) so the 500-event
  // cap keeps the chronologically-soonest work. The due-only path remains
  // covered by `task_assignee_completed_due_idx`; the start-only rows fall
  // outside it, an accepted cost on this capped, per-user, 5-min-cached feed.
  // The `project.workspaceId` predicate scopes the feed to the token's
  // workspace — a user's tasks in OTHER workspaces never leak through a single
  // workspace's feed URL. Note the completed branch: `completedAt > cutoff` is
  // false for NULL completedAt, so a completed task with no completion
  // timestamp cannot resurface — fail-closed.
  const taskRows = await db
    .select({
      id: task.id,
      title: task.title,
      completed: task.completed,
      startDate: task.startDate,
      dueDate: task.dueDate,
      updatedAt: task.updatedAt,
      projectId: project.id,
      projectName: project.name,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(
      and(
        eq(task.assigneeId, userId),
        eq(project.workspaceId, workspaceId),
        or(isNotNull(task.dueDate), isNotNull(task.startDate)),
        or(eq(task.completed, false), gt(task.completedAt, completedCutoff)),
      ),
    )
    .orderBy(asc(sql`coalesce(${task.dueDate}, ${task.startDate})`))
    .limit(FEED_TASK_LIMIT);

  const baseUrl = appBaseUrl(c);
  const events: ICSEvent[] = [];
  for (const t of taskRows) {
    // The query guarantees at least one date; the guard keeps the types narrow
    // without a non-null assertion (a row with neither could only appear via a
    // future query regression — skip it rather than emit a dateless VEVENT).
    if (!t.dueDate && !t.startDate) continue;
    // The inclusive last day of the event is the due date when present, else
    // the start date (start-only task). The first day is the start date when it
    // precedes the last day, else the last day itself (single-day event). A
    // startDate after the due date is invalid upstream (shared Zod schemas
    // enforce start <= due) — this falls back to a single-day event so a
    // historically bad row can never emit DTEND <= DTSTART, which some clients
    // reject wholesale.
    const lastDay = t.dueDate ?? t.startDate!;
    const firstDay =
      t.startDate && t.startDate.getTime() < lastDay.getTime() ? t.startDate : lastDay;
    const taskUrl = `${baseUrl}/w/${row.workspaceSlug}/projects/${t.projectId}/board?task=${t.id}`;
    events.push({
      // Stable across fetches — subscription clients match by UID, so this
      // is what makes a changed task UPDATE in place instead of duplicating.
      uid: `task-${t.id}@cadence`,
      summary: t.title,
      // Project name + canonical link only. Task descriptions are
      // intentionally omitted — see module JSDoc (data exposure decision).
      description: `Project: ${t.projectName}\n${taskUrl}`,
      url: taskUrl,
      startDate: toDateOnly(firstDay),
      // RFC 5545 exclusive DTEND: first day AFTER the event.
      endDateExclusive: toDateOnly(new Date(lastDay.getTime() + DAY_MS)),
      // Task's own updatedAt (not "now") so identical data yields
      // byte-identical feeds — gratuitous DTSTAMP churn defeats client-side
      // change detection and any intermediary caching.
      dtstamp: t.updatedAt,
      ...(t.completed ? { status: "COMPLETED" as const } : {}),
    });
  }

  const ics = generateICS({
    calendarName: `Cadence — ${row.workspaceName}`,
    events,
  });

  // `private` — the response is per-user even though the request carries no
  // cookie; a shared cache must never serve one user's feed to another URL.
  // max-age=300 keeps aggressive clients from hammering D1 while staying
  // fresh enough for a task tracker.
  c.header("Content-Type", "text/calendar; charset=utf-8");
  c.header("Cache-Control", "private, max-age=300");
  return c.body(ics);
}

// ---------------------------------------------------------------------------
// getCalendarFeedStatus — GET /workspaces/:workspaceId/calendar-feed
// ---------------------------------------------------------------------------

/**
 * Report whether the calling user has a live feed for this workspace.
 *
 * Deliberately returns only `exists` + timestamps — never the token hash and
 * never (re)constructs the URL. The plaintext is irretrievable after mint by
 * design; if the user lost the URL, the only path forward is regenerate,
 * which is exactly the security posture we want for a credential that lives
 * in third-party calendar storage.
 */
export async function getCalendarFeedStatus(c: Context<AppEnv>) {
  const db = c.get("db");
  const me = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");

  const [row] = await db
    .select({
      createdAt: calendarFeedToken.createdAt,
      lastUsedAt: calendarFeedToken.lastUsedAt,
    })
    .from(calendarFeedToken)
    .where(
      and(
        eq(calendarFeedToken.userId, me.id),
        eq(calendarFeedToken.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!row) {
    return c.json({ exists: false, createdAt: null, lastUsedAt: null });
  }
  return c.json({
    exists: true,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  });
}

// ---------------------------------------------------------------------------
// createCalendarFeed — POST /workspaces/:workspaceId/calendar-feed
// ---------------------------------------------------------------------------

/**
 * Mint (or replace) the calling user's feed token for this workspace.
 *
 * One feed per user per workspace — enforced by the
 * `(userId, workspaceId)` unique index, implemented as an upsert that
 * overwrites `tokenHash` in place. The atomic replace is the rotation
 * story: the moment this returns, the old URL is dead (its hash no longer
 * exists), with no window where two URLs are live.
 *
 * The absolute URL (containing the plaintext) is returned exactly ONCE.
 * Only the HMAC-SHA256 hash is persisted — same plaintext-once contract as
 * PAT minting, and the entire reason `getCalendarFeedStatus` cannot echo
 * the URL back later.
 */
export async function createCalendarFeed(c: Context<AppEnv>) {
  const db = c.get("db");
  const me = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");

  // Shared mint path with PATs — single source of truth for entropy,
  // encoding, and peppered hashing (see `mintToken`'s JSDoc for why a
  // duplicated mint path would be an audit hazard).
  const pepper = requireTokenHashPepper(c.env.TOKEN_HASH_PEPPER);
  const { plaintext, hash } = await mintToken(CALENDAR_FEED_TOKEN_PREFIX, pepper);
  const now = new Date();

  try {
    await db
      .insert(calendarFeedToken)
      .values({
        id: crypto.randomUUID(),
        userId: me.id,
        workspaceId,
        tokenHash: hash,
        createdAt: now,
        lastUsedAt: null,
      })
      .onConflictDoUpdate({
        target: [calendarFeedToken.userId, calendarFeedToken.workspaceId],
        // Regenerate semantics: new hash (old URL instantly dead), createdAt
        // reflects this mint, lastUsedAt reset because no client has ever
        // fetched with the NEW credential.
        set: { tokenHash: hash, createdAt: now, lastUsedAt: null },
      });
  } catch (error) {
    throwWithContext(error, "createCalendarFeed");
  }

  return c.json(
    { url: `${appBaseUrl(c)}/api/calendar/feed/${plaintext}` },
    201,
  );
}

// ---------------------------------------------------------------------------
// deleteCalendarFeed — DELETE /workspaces/:workspaceId/calendar-feed
// ---------------------------------------------------------------------------

/**
 * Revoke the calling user's feed for this workspace by deleting the row.
 *
 * Hard delete (not soft-revoke like PATs) because a feed token carries no
 * audit attribution — nothing references it, so a tombstone row would be
 * dead weight. Idempotent: deleting an already-absent feed still returns
 * `{ ok: true }` so a retried revoke or a stale settings page never errors.
 */
export async function deleteCalendarFeed(c: Context<AppEnv>) {
  const db = c.get("db");
  const me = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");

  await db
    .delete(calendarFeedToken)
    .where(
      and(
        eq(calendarFeedToken.userId, me.id),
        eq(calendarFeedToken.workspaceId, workspaceId),
      ),
    );

  return c.json({ ok: true });
}
