/**
 * Shared cover-image upload/delete/apply logic.
 *
 * Both projects and tasks support cover images with identical R2 + upload-record
 * lifecycle management. They can also receive an Unsplash-hosted cover via the
 * `coverUnsplash` JSON column. This module extracts the shared workflow so the
 * individual handler files only need to supply the entity-specific lookup and
 * update callbacks.
 *
 * ## XOR invariant (IMPORTANT)
 *
 * `coverImageKey` (R2 upload) and `coverUnsplash` (JSON payload) are mutually
 * exclusive on any row. Setting one MUST clear the other atomically. The
 * `setEntityCover` callback therefore takes BOTH values on every call, and the
 * callers here always pass `null` for the opposite field:
 *
 *   - upload:       { coverImageKey: key,  coverUnsplash: null }
 *   - apply:        { coverImageKey: null, coverUnsplash: payload }
 *   - delete:       { coverImageKey: null, coverUnsplash: null }
 *
 * This invariant is enforced in application code, not via a DB constraint,
 * because Drizzle's JSON column is stored as text and adding a CHECK constraint
 * would complicate migrations without meaningful safety benefit — every write
 * path funnels through these helpers.
 *
 * `coverImagePosition` applies to either source and is updated by the caller.
 */
import { eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../db";
import { upload } from "../../db/schema/uploads";
import type {
  StoredUnsplashCoverPayload,
  UnsplashCoverPayload,
} from "../../shared/schemas/unsplash";
import { unsplashCoverPayloadSchema } from "../../shared/schemas/unsplash";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_SIZE } from "../../shared/schemas/upload";
import type { AppEnv } from "../env";
import { deferWork } from "./defer";
import { errorResponse } from "./error-response";
import { deleteObject, generateObjectKey, putObject } from "./storage";
import { createUnsplashService } from "./unsplash";
import { validJson } from "./validated";

/**
 * Minimal info the shared helpers need about the owning entity.
 *
 * `coverUnsplash` is the lenient STORED shape (its `rawUrl` may be absent on
 * legacy rows) because this is a READ shape hydrated from a DB select, not a
 * freshly-validated apply payload.
 */
interface EntityWithCover {
  id: string;
  coverImageKey: string | null;
  coverUnsplash: StoredUnsplashCoverPayload | null;
}

/** Shape of the two atomic cover-source fields the helpers write together. */
export interface CoverSourceUpdate {
  coverImageKey: string | null;
  coverUnsplash: UnsplashCoverPayload | null;
}

interface UploadCoverOptions {
  /** e.g. "project-cover" or "task-cover" — used as the R2 key prefix and upload purpose */
  purpose: string;
  /** Resolve the entity record, returning null if not found */
  getEntity: (db: Database) => Promise<EntityWithCover | null>;
  /**
   * Persist both cover-source fields on the entity.
   * Both fields are always supplied; callers MUST write them as-is to preserve
   * the XOR invariant documented at the top of this file.
   */
  setEntityCover: (
    db: Database,
    cover: CoverSourceUpdate,
    updatedAt: Date,
  ) => Promise<void>;
}

interface DeleteCoverOptions {
  /** e.g. "project-cover" or "task-cover" */
  purpose: string;
  /** Resolve the entity record, returning null if not found */
  getEntity: (db: Database) => Promise<EntityWithCover | null>;
  /**
   * Persist both cover-source fields on the entity (always null for a delete).
   * See XOR invariant at the top of this file.
   */
  setEntityCover: (
    db: Database,
    cover: CoverSourceUpdate,
    updatedAt: Date,
  ) => Promise<void>;
  /** Label used in log messages, e.g. "project" or "task" */
  entityLabel: string;
}

interface ApplyUnsplashCoverOptions {
  /** e.g. "project-cover" or "task-cover" — used only for log labels here */
  purpose: string;
  /** Resolve the entity record, returning null if not found */
  getEntity: (db: Database) => Promise<EntityWithCover | null>;
  /**
   * Persist both cover-source fields on the entity.
   * See XOR invariant at the top of this file.
   */
  setEntityCover: (
    db: Database,
    cover: CoverSourceUpdate,
    updatedAt: Date,
  ) => Promise<void>;
}

/**
 * Generic handler for uploading a cover image to any entity that has
 * `coverImageKey` + `coverUnsplash` columns.
 *
 * Invariant: on success, this writes `coverImageKey=<new>` AND
 * `coverUnsplash=null` atomically — the entity cannot hold both cover sources
 * at the same time.
 */
export async function handleUploadCover(c: Context<AppEnv>, opts: UploadCoverOptions) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  const user = c.get("user")!;

  const formData = await c.req.parseBody();
  const file = formData["file"];

  if (!(file instanceof File)) {
    return errorResponse(c, "No file provided", 400);
  }

  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return errorResponse(c, "Invalid file type. Allowed: JPEG, PNG, GIF, WebP", 400);
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return errorResponse(c, "File too large. Maximum size is 5MB", 400);
  }

  const db = c.get("db");

  const entity = await opts.getEntity(db);
  if (!entity) {
    return errorResponse(c, "Not found", 404);
  }

  // Find old cover upload record if one exists (only relevant when the prior
  // source was an R2 upload — Unsplash covers have no R2 artifact to clean up).
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
    return errorResponse(c, "Failed to upload file", 500);
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
    // Enforce XOR: clear any existing Unsplash cover when setting an R2 one.
    await opts.setEntityCover(db, { coverImageKey: key, coverUnsplash: null }, now);
  } catch (error) {
    // Clean up orphaned R2 object and any partially-inserted upload record
    await deleteObject(storage, key).catch((err) => console.error(`Failed to clean up orphaned R2 object for ${opts.purpose}:`, err));
    await db.delete(upload).where(eq(upload.id, id)).catch((err) => console.error(`Failed to clean up orphaned upload record for ${opts.purpose}:`, err));
    console.error(`Failed to save ${opts.purpose} upload record:`, error);
    return errorResponse(c, "Failed to save upload", 500);
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
    coverUnsplash: null,
  });
}

/**
 * Generic handler for applying an Unsplash-hosted photo as the cover image on
 * any entity that has `coverImageKey` + `coverUnsplash` columns.
 *
 * Invariant: on success, this writes `coverUnsplash=<payload>` AND
 * `coverImageKey=null` atomically; any pre-existing R2 cover artifact is
 * deleted AFTER the DB update succeeds (so a failure mid-write never leaves
 * the entity pointing at a missing R2 key).
 *
 * Download tracking: per Unsplash API guidelines, every time a photo is
 * applied we must fire a GET against `downloadLocation`. We defer this via
 * `deferWork` so the network call runs outside the request lifecycle in prod
 * (and inline in tests). `trackDownload` swallows all errors so a failing
 * track does not crash the worker.
 */
export async function handleApplyUnsplashCover(
  c: Context<AppEnv>,
  opts: ApplyUnsplashCoverOptions,
) {
  const storage = c.env.STORAGE;
  // We only hard-require STORAGE when there's an R2 artifact to clean up.
  // Defer the check until we know the current entity state.

  const svc = createUnsplashService(c.env);
  if (!svc) return errorResponse(c, "Unsplash is not configured", 503);

  const payload = validJson(c, unsplashCoverPayloadSchema);

  const db = c.get("db");

  const entity = await opts.getEntity(db);
  if (!entity) {
    return errorResponse(c, "Not found", 404);
  }

  // If the entity currently has an R2 cover, we need storage to clean it up.
  const oldCoverKey = entity.coverImageKey;
  if (oldCoverKey && !storage) {
    return errorResponse(c, "File storage is not configured", 503);
  }

  // Look up the old R2 upload record (if any) BEFORE flipping columns, so we
  // can delete it after the DB write succeeds.
  let oldUploadRecord: { id: string; key: string } | undefined;
  if (oldCoverKey) {
    const [record] = await db
      .select({ id: upload.id, key: upload.key })
      .from(upload)
      .where(eq(upload.key, oldCoverKey))
      .limit(1);
    oldUploadRecord = record;
  }

  // Atomic DB write — flip both columns together to preserve the XOR invariant.
  const now = new Date();
  try {
    await opts.setEntityCover(
      db,
      { coverImageKey: null, coverUnsplash: payload },
      now,
    );
  } catch (error) {
    console.error(`Failed to apply Unsplash cover for ${opts.purpose}:`, error);
    return errorResponse(c, "Failed to apply cover", 500);
  }

  // Clean up old R2 artifact AFTER the DB write succeeds. Errors are logged
  // but non-fatal — the entity already points at the new Unsplash payload.
  if (oldUploadRecord && storage) {
    await deleteObject(storage, oldUploadRecord.key).catch((err) =>
      console.error(`Failed to delete old ${opts.purpose} R2 object:`, err),
    );
    await db
      .delete(upload)
      .where(eq(upload.id, oldUploadRecord.id))
      .catch((err) =>
        console.error(`Failed to delete old ${opts.purpose} upload record:`, err),
      );
  }

  // Fire the download-tracking GET outside the request lifecycle via
  // `deferWork`, which waits-until in prod and runs inline in tests (where
  // `c.executionCtx` is absent). `trackDownload` is error-swallowing so the
  // deferred promise never rejects.
  deferWork(c, () => svc.trackDownload(payload.downloadLocation));

  return c.json({
    coverImageKey: null,
    coverUnsplash: payload,
  });
}

/**
 * Generic handler for deleting a cover image from any entity that has
 * `coverImageKey` + `coverUnsplash` columns.
 *
 * Invariant: always nulls BOTH columns, regardless of which source was
 * previously set. Idempotent — returns `{ ok: true }` when there is no
 * existing cover.
 */
export async function handleDeleteCover(c: Context<AppEnv>, opts: DeleteCoverOptions) {
  const db = c.get("db");

  const entity = await opts.getEntity(db);
  if (!entity) {
    return errorResponse(c, "Not found", 404);
  }

  // No cover of either kind → idempotent no-op.
  if (!entity.coverImageKey && !entity.coverUnsplash) {
    return c.json({ ok: true });
  }

  const coverKey = entity.coverImageKey;
  const storage = c.env.STORAGE;

  // If there's an R2 artifact to clean up, storage must be configured.
  if (coverKey && !storage) {
    return errorResponse(c, "File storage is not configured", 503);
  }

  // Clear both cover columns on the entity first (authoritative write).
  const now = new Date();
  await opts.setEntityCover(
    db,
    { coverImageKey: null, coverUnsplash: null },
    now,
  );

  // Delete the R2 object + upload record if a local upload existed. If only
  // an Unsplash cover was set there's nothing else to clean up.
  if (coverKey && storage) {
    await deleteObject(storage, coverKey).catch((error) => {
      console.error(`Failed to delete ${opts.entityLabel} cover from R2:`, error);
    });

    const [uploadRecord] = await db
      .select({ id: upload.id })
      .from(upload)
      .where(eq(upload.key, coverKey))
      .limit(1);

    if (uploadRecord) {
      await db.delete(upload).where(eq(upload.id, uploadRecord.id));
    }
  }

  return c.json({ ok: true });
}
