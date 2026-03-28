import { and, count, eq, sql } from "drizzle-orm";
import type { Context } from "hono";

import { label, taskLabel } from "../../../db/schema/label";
import type { CreateLabelInput, UpdateLabelInput } from "../../../shared/schemas/label";
import { MAX_LABELS_PER_PROJECT } from "../../../shared/schemas/label";
import type { AppEnv } from "../../env";

export async function createLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = c.req.param();
  const body = c.req.valid("json" as never) as CreateLabelInput;

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
    return c.json(
      { error: `Maximum of ${MAX_LABELS_PER_PROJECT} labels per project reached` },
      400,
    );
  }

  if (duplicateResult[0]) {
    return c.json({ error: "A label with this name already exists in the project" }, 409);
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

  await db.insert(label).values(newLabel);

  return c.json({ label: newLabel }, 201);
}

export async function listLabels(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId } = c.req.param();

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

export async function updateLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId, labelId } = c.req.param();
  const body = c.req.valid("json" as never) as UpdateLabelInput;

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
    return c.json({ error: "Label not found" }, 404);
  }

  // Only flag as duplicate if the name actually changed (case-insensitive)
  if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase() && duplicateResult[0]) {
    return c.json({ error: "A label with this name already exists in the project" }, 409);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.color !== undefined) updates.color = body.color;

  if (Object.keys(updates).length > 0) {
    const [updated] = await db
      .update(label)
      .set(updates)
      .where(eq(label.id, labelId))
      .returning();

    return c.json({ label: updated });
  }

  return c.json({ label: existing });
}

export async function deleteLabel(c: Context<AppEnv>) {
  const db = c.get("db");
  const { projectId, labelId } = c.req.param();

  // CASCADE removes all taskLabel references.
  // .returning() lets us detect non-existence (404) in the same round-trip.
  const [deleted] = await db
    .delete(label)
    .where(and(eq(label.id, labelId), eq(label.projectId, projectId)))
    .returning({ id: label.id });

  if (!deleted) {
    return c.json({ error: "Label not found" }, 404);
  }

  return c.json({ ok: true, deletedId: labelId });
}
