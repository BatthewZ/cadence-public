/**
 * Shared cover-image upload/delete logic.
 *
 * Both projects and tasks support cover images with identical R2 + upload-record
 * lifecycle management. This module extracts that shared workflow so the
 * individual handler files only need to supply the entity-specific lookup and
 * update callbacks.
 */
import { eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../db";
import { upload } from "../../db/schema/uploads";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_SIZE } from "../../shared/schemas/upload";
import type { AppEnv } from "../env";
import { deleteObject, generateObjectKey, putObject } from "./storage";

/** Minimal info the shared helpers need about the owning entity. */
interface EntityWithCover {
  id: string;
  coverImageKey: string | null;
}

interface UploadCoverOptions {
  /** e.g. "project-cover" or "task-cover" — used as the R2 key prefix and upload purpose */
  purpose: string;
  /** Resolve the entity record, returning null if not found */
  getEntity: (db: Database) => Promise<EntityWithCover | null>;
  /** Persist the new coverImageKey on the entity */
  setEntityCover: (db: Database, key: string | null, updatedAt: Date) => Promise<void>;
}

interface DeleteCoverOptions {
  /** e.g. "project-cover" or "task-cover" */
  purpose: string;
  /** Resolve the entity record, returning null if not found */
  getEntity: (db: Database) => Promise<EntityWithCover | null>;
  /** Persist the coverImageKey=null on the entity */
  setEntityCover: (db: Database, key: null, updatedAt: Date) => Promise<void>;
  /** Label used in log messages, e.g. "project" or "task" */
  entityLabel: string;
}

/**
 * Generic handler for uploading a cover image to any entity that has a
 * `coverImageKey` column.
 */
export async function handleUploadCover(c: Context<AppEnv>, opts: UploadCoverOptions) {
  const storage = c.env.STORAGE;
  if (!storage) return c.json({ error: "File storage is not configured" }, 503);

  const user = c.get("user")!;

  const formData = await c.req.parseBody();
  const file = formData["file"];

  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return c.json(
      { error: "Invalid file type. Allowed: JPEG, PNG, GIF, WebP" },
      400,
    );
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return c.json({ error: "File too large. Maximum size is 5MB" }, 400);
  }

  const db = c.get("db");

  const entity = await opts.getEntity(db);
  if (!entity) {
    return c.json({ error: "Not found" }, 404);
  }

  // Find old cover upload record if one exists
  const oldCoverKey = entity.coverImageKey;
  let oldUploadRecord: { id: string; key: string } | undefined;

  if (oldCoverKey) {
    const [record] = await db
      .select({ id: upload.id, key: upload.key })
      .from(upload)
      .where(eq(upload.key, oldCoverKey))
      .limit(1);
    oldUploadRecord = record;
  }

  // Upload new file FIRST — if this fails, old cover is still intact
  const key = generateObjectKey(opts.purpose, user.id, file.name);
  const arrayBuffer = await file.arrayBuffer();

  try {
    await putObject(storage, key, arrayBuffer, {
      mimeType: file.type,
      filename: file.name,
    });
  } catch (error) {
    console.error(`Failed to upload ${opts.purpose} to R2:`, error);
    return c.json({ error: "Failed to upload file" }, 500);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const record = {
    id,
    userId: user.id,
    key,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    purpose: opts.purpose,
    createdAt: now,
  };

  const coverUrl = `/api/uploads/${key}`;

  try {
    await db.insert(upload).values(record);
    await opts.setEntityCover(db, key, now);
  } catch (error) {
    // Clean up orphaned R2 object and any partially-inserted upload record
    await deleteObject(storage, key).catch((err) => console.error(`Failed to clean up orphaned R2 object for ${opts.purpose}:`, err));
    await db.delete(upload).where(eq(upload.id, id)).catch((err) => console.error(`Failed to clean up orphaned upload record for ${opts.purpose}:`, err));
    console.error(`Failed to save ${opts.purpose} upload record:`, error);
    return c.json({ error: "Failed to save upload" }, 500);
  }

  // Clean up old cover AFTER new one is fully saved
  if (oldUploadRecord) {
    await deleteObject(storage, oldUploadRecord.key).catch((err) => console.error(`Failed to delete old ${opts.purpose} R2 object:`, err));
    await db.delete(upload).where(eq(upload.id, oldUploadRecord.id)).catch((err) => console.error(`Failed to delete old ${opts.purpose} upload record:`, err));
  }

  return c.json({
    upload: {
      id: record.id,
      url: coverUrl,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
    },
    coverImageKey: key,
  });
}

/**
 * Generic handler for deleting a cover image from any entity that has a
 * `coverImageKey` column.
 */
export async function handleDeleteCover(c: Context<AppEnv>, opts: DeleteCoverOptions) {
  const storage = c.env.STORAGE;
  if (!storage) return c.json({ error: "File storage is not configured" }, 503);

  const db = c.get("db");

  const entity = await opts.getEntity(db);
  if (!entity) {
    return c.json({ error: "Not found" }, 404);
  }

  if (!entity.coverImageKey) {
    // Idempotent — no cover to delete
    return c.json({ ok: true });
  }

  const coverKey = entity.coverImageKey;

  // Clear the cover reference on the entity first
  const now = new Date();
  await opts.setEntityCover(db, null, now);

  // Delete the R2 object
  await deleteObject(storage, coverKey).catch((error) => {
    console.error(`Failed to delete ${opts.entityLabel} cover from R2:`, error);
  });

  // Delete the upload record
  const [uploadRecord] = await db
    .select({ id: upload.id })
    .from(upload)
    .where(eq(upload.key, coverKey))
    .limit(1);

  if (uploadRecord) {
    await db.delete(upload).where(eq(upload.id, uploadRecord.id));
  }

  return c.json({ ok: true });
}
