import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";

import { label, taskLabel } from "../../../db/schema/label";
import { project, projectMember } from "../../../db/schema/project";
import { createLabelSchema, updateLabelSchema } from "../../../shared/schemas/label";
import { MAX_LABELS_PER_PROJECT } from "../../../shared/schemas/label";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import { tokenProjectScopeFilter } from "../../middleware/authorize";

export async function createLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");
  const body = validJson(c, createLabelSchema);

  // Batch label count + name uniqueness check in a single round-trip
  const [countResult, duplicateResult] = await db.batch([
    db.select({ value: count() })
      .from(label)
      .where(eq(label.projectId, projectId)),
    db.select({ id: label.id })
      .from(label)
      .where(
        and(
          eq(label.projectId, projectId),
          sql`LOWER(${label.name}) = LOWER(${body.name})`,
        ),
      )
      .limit(1),
  ] as const);

  if (countResult[0].value >= MAX_LABELS_PER_PROJECT) {
    return errorResponse(c, `Maximum of ${MAX_LABELS_PER_PROJECT} labels per project reached`, 400);
  }

  if (duplicateResult[0]) {
    return errorResponse(c, "A label with this name already exists in the project", 409);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const newLabel = {
    id,
    projectId,
    name: body.name,
    color: body.color,
    createdAt: now,
  };

  await db.batch([
    db.insert(label).values(newLabel),
    db.update(project).set({ updatedAt: now }).where(eq(project.id, projectId)),
  ] as const);

  return c.json({ label: newLabel }, 201);
}

export async function listLabels(c: Context<AppEnv>) {
  const db = c.get("db");
  const projectId = requireParam(c, "projectId");

  const labels = await db
    .select({
      id: label.id,
      projectId: label.projectId,
      name: label.name,
      color: label.color,
      createdAt: label.createdAt,
      taskCount: sql<number>`COALESCE(${
        db
          .select({ cnt: count() })
          .from(taskLabel)
          .where(eq(taskLabel.labelId, label.id))
      }, 0)`.as("taskCount"),
    })
    .from(label)
    .where(eq(label.projectId, projectId))
    .orderBy(label.name);

  return c.json({ labels });
}

/**
 * GET /workspaces/:workspaceId/labels
 *
 * Workspace-scoped list of labels across every **active** project the caller
 * can see, deduplicated by `LOWER(name)`. Powers workspace-level filter UIs
 * (e.g. the My Tasks label filter) where the user narrows tasks by label
 * without caring which project a label row physically lives in.
 *
 * Why dedupe by `LOWER(name)`: labels are project-scoped rows, and name
 * uniqueness is only enforced case-insensitively *within* a project (see
 * `label_project_name_idx` + the createLabel/updateLabel 409 checks). Across
 * projects the same conceptual label ("Bug" in project A, "bug" in project B)
 * exists as distinct rows with distinct ids — so for cross-project filtering
 * the *name* is the label's identity, and the case-insensitive key mirrors
 * the per-project uniqueness rule. `MIN(name)` / `MIN(color)` pick a
 * deterministic representative per group regardless of row insert order, so
 * the option list is stable across requests.
 *
 * Access model: mirrors `listWorkspaceTaskGroups` — the caller must be a
 * workspace member (enforced by requireWorkspaceMember on the route).
 * Elevated members (owner/admin) see labels from all workspace projects;
 * non-elevated members only from projects they are a direct member of, so a
 * plain member can never enumerate label names from projects they cannot
 * open. Archived projects are excluded because their tasks no longer appear
 * in workspace task views, so offering their labels as filter options would
 * only produce dead filters.
 *
 * PAT callers are narrowed a third way, by the token's selected-project list
 * (`tokenProjectScopeFilter`). Label names are chosen by humans and routinely
 * encode customer, release or incident names, so the deduplicated cross-project
 * list is a compact index of what a workspace is working on — a token scoped to
 * one project must not receive the other projects' entries. The filter applies
 * to the project-visibility query, so the dedupe below only ever groups rows
 * the caller was allowed to see in the first place.
 */
export async function listWorkspaceLabels(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const user = c.get("user")!;
  const membership = c.get("workspaceMembership")!;
  const isElevated = membership.role === "owner" || membership.role === "admin";
  const patScope = tokenProjectScopeFilter(c, project.id);

  // Restrict to active projects in this workspace the caller can see
  const visibleProjects = isElevated
    ? await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            eq(project.status, "active"),
            patScope,
          ),
        )
    : await db
        .select({ id: project.id })
        .from(project)
        .innerJoin(
          projectMember,
          and(
            eq(projectMember.projectId, project.id),
            eq(projectMember.userId, user.id),
          ),
        )
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            eq(project.status, "active"),
            patScope,
          ),
        );

  const visibleIds = visibleProjects.map((p) => p.id);

  if (visibleIds.length === 0) {
    return c.json({ labels: [] });
  }

  // Ordering uses the same LOWER(name) key as the grouping so the option
  // list sorts case-insensitively ("alpha" before "Beta"), matching how
  // users read the deduped names.
  const labels = await db
    .select({
      name: sql<string>`MIN(${label.name})`.as("name"),
      color: sql<string>`MIN(${label.color})`.as("color"),
    })
    .from(label)
    .where(inArray(label.projectId, visibleIds))
    .groupBy(sql`LOWER(${label.name})`)
    .orderBy(sql`LOWER(${label.name})`);

  return c.json({ labels });
}

export async function updateLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId, labelId } = requireParams(c, "projectId", "labelId");
  const body = validJson(c, updateLabelSchema);

  // Batch label existence + name uniqueness check in a single round-trip
  const [existingResult, duplicateResult] = await db.batch([
    db.select()
      .from(label)
      .where(and(eq(label.id, labelId), eq(label.projectId, projectId)))
      .limit(1),
    db.select({ id: label.id })
      .from(label)
      .where(
        and(
          eq(label.projectId, projectId),
          sql`LOWER(${label.name}) = LOWER(${body.name ?? ""})`,
        ),
      )
      .limit(1),
  ] as const);

  const existing = existingResult[0];
  if (!existing) {
    return errorResponse(c, "Label not found", 404);
  }

  // Only flag as duplicate if the name actually changed (case-insensitive)
  if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase() && duplicateResult[0]) {
    return errorResponse(c, "A label with this name already exists in the project", 409);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.color !== undefined) updates.color = body.color;

  if (Object.keys(updates).length > 0) {
    const now = new Date();
    const [[updated]] = await db.batch([
      db.update(label).set(updates).where(eq(label.id, labelId)).returning(),
      db.update(project).set({ updatedAt: now }).where(eq(project.id, projectId)),
    ] as const);

    return c.json({ label: updated });
  }

  return c.json({ label: existing });
}

export async function deleteLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId, labelId } = requireParams(c, "projectId", "labelId");

  // CASCADE removes all taskLabel references.
  // .returning() lets us detect non-existence (404) in the same round-trip.
  const [deleted] = await db
    .delete(label)
    .where(and(eq(label.id, labelId), eq(label.projectId, projectId)))
    .returning({ id: label.id });

  if (!deleted) {
    return errorResponse(c, "Label not found", 404);
  }

  await db.update(project).set({ updatedAt: new Date() }).where(eq(project.id, projectId));

  return c.json({ ok: true, deletedId: labelId });
}
