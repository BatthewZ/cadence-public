import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";

import { savedView } from "../../../db/schema/saved-view";
import { generateKeyBetween } from "../../../shared/lib/fractional-index";
import {
  createSavedViewSchema,
  MAX_SAVED_VIEWS_PER_PROJECT_USER,
  type SavedView,
  updateSavedViewSchema,
} from "../../../shared/schemas/saved-view";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";

/**
 * Saved-view handlers: private, per-user-per-project bookmarks of the task
 * board's URL state.
 *
 * Two invariants here are deliberately different from the label handlers
 * these otherwise mirror, and both are load-bearing:
 *
 * 1. **Creator scoping is the cross-user guard.** Every query filters by BOTH
 *    `projectId` AND `creatorId = c.get("user").id`. Another member's view id
 *    must be indistinguishable from a missing one — always 404, never 403 —
 *    so a project member can neither read, modify, nor even *confirm the
 *    existence of* a teammate's private views by guessing ids. Route-level
 *    `requireProjectAccess()` (any member, including viewers — views only
 *    bookmark read-only state) plus this handler-level scoping is the
 *    complete authorization story.
 *
 * 2. **No project-freshness bump.** Label mutations touch `project.updatedAt`
 *    so the team's freshness polling notices shared data changed. Saved views
 *    are personal bookmarks: bumping `project.updatedAt` here would
 *    invalidate freshness polling for the WHOLE team every time one user
 *    saved a private view. Handlers therefore never write to the `project`
 *    table.
 *
 * `state` PATCHes are last-write-wins: the data is single-owner, so there is
 * no concurrent editor to protect against.
 */

type SavedViewRow = typeof savedView.$inferSelect;

/**
 * Map a DB row to the wire shape. Drizzle's timestamp-mode columns hydrate as
 * `Date`s; the `SavedView` API contract pins createdAt/updatedAt as ISO
 * strings (matching what `c.json` would emit implicitly), so we convert
 * explicitly to keep the handler return type honest against the shared
 * interface.
 */
function serializeSavedView(row: SavedViewRow): SavedView {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * GET /projects/:projectId/views
 *
 * Lists the CALLER'S saved views for the project, ordered by fractional
 * `position` (creation order in v1 — there is no reorder endpoint yet, but
 * position-ordering now means adding one later is a pure insert-between).
 */
export async function listSavedViews(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");
  const userId = c.get("user")!.id;

  const rows = await db
    .select()
    .from(savedView)
    .where(and(eq(savedView.projectId, projectId), eq(savedView.creatorId, userId)))
    .orderBy(asc(savedView.position));

  return c.json({ views: rows.map(serializeSavedView) });
}

/**
 * POST /projects/:projectId/views
 *
 * Creates a saved view for the caller. Cap + duplicate-name + last-position
 * checks run in one `db.batch` round-trip (the labels pattern).
 *
 * The duplicate check compares `LOWER(name)` per (project, creator): the
 * `saved_view_project_creator_name_idx` unique index is case-SENSITIVE, so
 * this handler-level check is the real case-insensitive guard — the index is
 * only a race-condition backstop, exactly as with labels.
 */
export async function createSavedView(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");
  const userId = c.get("user")!.id;
  const body = validJson(c, createSavedViewSchema);

  const ownViews = and(
    eq(savedView.projectId, projectId),
    eq(savedView.creatorId, userId),
  );

  const [countResult, duplicateResult, lastPositionResult] = await db.batch([
    db.select({ value: count() }).from(savedView).where(ownViews),
    db
      .select({ id: savedView.id })
      .from(savedView)
      .where(and(ownViews, sql`LOWER(${savedView.name}) = LOWER(${body.name})`))
      .limit(1),
    db
      .select({ position: savedView.position })
      .from(savedView)
      .where(ownViews)
      .orderBy(desc(savedView.position))
      .limit(1),
  ] as const);

  if (countResult[0].value >= MAX_SAVED_VIEWS_PER_PROJECT_USER) {
    return errorResponse(
      c,
      `Maximum of ${MAX_SAVED_VIEWS_PER_PROJECT_USER} saved views per project reached`,
      400,
    );
  }

  if (duplicateResult[0]) {
    return errorResponse(c, "A saved view with this name already exists", 409);
  }

  const now = new Date();
  const [created] = await db
    .insert(savedView)
    .values({
      id: crypto.randomUUID(),
      projectId,
      creatorId: userId,
      name: body.name,
      // Stored verbatim (json-mode column): unknown `params` keys written by
      // newer clients survive untouched — the forward-compat contract.
      state: body.state,
      position: generateKeyBetween(lastPositionResult[0]?.position ?? null, null),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json({ view: serializeSavedView(created) }, 201);
}

/**
 * PATCH /projects/:projectId/views/:viewId
 *
 * Renames a view and/or overwrites its `state` snapshot (last-write-wins).
 *
 * The duplicate-name 409 only fires when the name actually CHANGES
 * case-insensitively (the updateLabel pattern): renaming "urgent" to
 * "Urgent" is a legal case-correction, not a collision with itself — the
 * `LOWER()` probe would match the row's own name, so without this guard
 * every case-only rename (and every no-op rename) would false-positive.
 */
export async function updateSavedView(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId, viewId } = requireParams(c, "projectId", "viewId");
  const userId = c.get("user")!.id;
  const body = validJson(c, updateSavedViewSchema);

  const ownView = and(
    eq(savedView.id, viewId),
    eq(savedView.projectId, projectId),
    eq(savedView.creatorId, userId),
  );

  const [existingResult, duplicateResult] = await db.batch([
    db.select().from(savedView).where(ownView).limit(1),
    db
      .select({ id: savedView.id })
      .from(savedView)
      .where(
        and(
          eq(savedView.projectId, projectId),
          eq(savedView.creatorId, userId),
          sql`LOWER(${savedView.name}) = LOWER(${body.name ?? ""})`,
        ),
      )
      .limit(1),
  ] as const);

  const existing = existingResult[0];
  if (!existing) {
    // Deliberately identical to the cross-user / cross-project miss: a view
    // belonging to someone else must look exactly like one that never existed.
    return errorResponse(c, "Saved view not found", 404);
  }

  if (
    body.name &&
    body.name.toLowerCase() !== existing.name.toLowerCase() &&
    duplicateResult[0]
  ) {
    return errorResponse(c, "A saved view with this name already exists", 409);
  }

  const updates: Partial<typeof savedView.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.state !== undefined) updates.state = body.state;

  if (Object.keys(updates).length === 0) {
    // Nothing to write: echo the row without bumping updatedAt, so an empty
    // PATCH can never masquerade as a real edit.
    return c.json({ view: serializeSavedView(existing) });
  }

  updates.updatedAt = new Date();

  // No companion `project.updatedAt` write here — see the module JSDoc:
  // private bookmarks must not invalidate the team's freshness polling.
  const [updated] = await db
    .update(savedView)
    .set(updates)
    .where(ownView)
    .returning();

  return c.json({ view: serializeSavedView(updated) });
}

/**
 * DELETE /projects/:projectId/views/:viewId
 *
 * `.returning()` detects non-existence in the same round-trip, and the
 * creator-scoped WHERE means another user's view id deletes nothing and
 * yields the same 404 as a genuinely missing id.
 */
export async function deleteSavedView(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId, viewId } = requireParams(c, "projectId", "viewId");
  const userId = c.get("user")!.id;

  const [deleted] = await db
    .delete(savedView)
    .where(
      and(
        eq(savedView.id, viewId),
        eq(savedView.projectId, projectId),
        eq(savedView.creatorId, userId),
      ),
    )
    .returning({ id: savedView.id });

  if (!deleted) {
    return errorResponse(c, "Saved view not found", 404);
  }

  return c.json({ ok: true, deletedId: deleted.id });
}
