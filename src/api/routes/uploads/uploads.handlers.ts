import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { upload } from "../../../db/schema/uploads";
import { ALLOWED_IMAGE_TYPES, MAX_AVATAR_SIZE } from "../../../shared/schemas/upload";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { detectMimeType } from "../../lib/mime-detect";
import { requireParam, requireParams } from "../../lib/params";
import { deleteObject, generateObjectKey, getObject, putObject } from "../../lib/storage";

export async function uploadAvatar(c: Context<AppEnv>) {
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

  if (file.size > MAX_AVATAR_SIZE) {
    return errorResponse(c, "File too large. Maximum size is 2MB", 400);
  }

  const db = c.get("db");

  // Find old avatar first (before uploading new one)
  const [oldAvatar] = await db
    .select()
    .from(upload)
    .where(and(eq(upload.userId, user.id), eq(upload.purpose, "avatar")))
    .limit(1);

  // Upload new file FIRST — if this fails, old avatar is still intact
  const key = generateObjectKey("avatar", user.id, file.name);
  const arrayBuffer = await file.arrayBuffer();

  // Validate file content against magic bytes — don't trust client-provided MIME type
  const detectedMime = detectMimeType(arrayBuffer, file.type);
  if (!detectedMime) {
    return errorResponse(c, "File content does not match its declared type", 400);
  }

  const verifiedMimeType = detectedMime;

  try {
    await putObject(storage, key, arrayBuffer, {
      mimeType: verifiedMimeType,
      filename: file.name,
    });
  } catch (error) {
    console.error("Failed to upload file to R2:", error);
    return errorResponse(c, "Failed to upload file", 500);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const record = {
    id,
    userId: user.id,
    key,
    filename: file.name,
    mimeType: verifiedMimeType,
    size: file.size,
    purpose: "avatar" as const,
    createdAt: now,
  };

  const avatarUrl = `/api/uploads/${key}`;

  try {
    await db.batch([
      db.insert(upload).values(record),
      db
        .update(userTable)
        .set({ image: avatarUrl, updatedAt: now })
        .where(eq(userTable.id, user.id)),
    ] as const);
  } catch (error) {
    // Clean up orphaned R2 object and any partially-inserted upload record
    await deleteObject(storage, key).catch((err) => console.error("Failed to clean up orphaned avatar R2 object:", err));
    await db.delete(upload).where(eq(upload.id, id)).catch((err) => console.error("Failed to clean up orphaned avatar upload record:", err));
    console.error("Failed to save upload record:", error);
    return errorResponse(c, "Failed to save upload", 500);
  }

  // Clean up old avatar AFTER new one is fully saved
  if (oldAvatar) {
    await deleteObject(storage, oldAvatar.key).catch((err) => console.error("Failed to delete old avatar R2 object:", err));
    await db.delete(upload).where(eq(upload.id, oldAvatar.id)).catch((err) => console.error("Failed to delete old avatar upload record:", err));
  }

  return c.json({
    upload: {
      id: record.id,
      url: avatarUrl,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
    },
  });
}

export async function serveUpload(c: Context<AppEnv>) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  const { purpose, userId, filename } = requireParams(c, "purpose", "userId", "filename");
  const key = `${purpose}/${userId}/${filename}`;

  const object = await getObject(storage, key);
  if (!object) {
    return errorResponse(c, "File not found", 404);
  }

  c.header("Cache-Control", "public, max-age=31536000, immutable");

  const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
  c.header("Content-Type", contentType);

  // Force download for non-image task-attachments to prevent browser execution
  if (purpose === "task-attachment" && !contentType.startsWith("image/")) {
    const originalFilename = object.customMetadata?.filename ?? filename;
    // Sanitize filename for Content-Disposition header to prevent header injection
    const safeFilename = originalFilename.replace(/[\r\n"\\]/g, "_");
    c.header("Content-Disposition", `attachment; filename="${safeFilename}"`);
  }

  return c.body(await object.arrayBuffer());
}

export async function deleteUpload(c: Context<AppEnv>) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  const user = c.get("user")!;
  const id = requireParam(c, "id");
  const db = c.get("db");

  // Batch the lookup and ownership-scoped delete in a single DB round-trip.
  // The delete WHERE includes userId so it's a no-op when ownership fails.
  const [selectResult] = await db.batch([
    db.select().from(upload).where(eq(upload.id, id)).limit(1),
    db.delete(upload).where(and(eq(upload.id, id), eq(upload.userId, user.id))),
  ] as const);

  const record = selectResult[0];

  if (!record) {
    return errorResponse(c, "Upload not found", 404);
  }

  if (record.userId !== user.id) {
    return errorResponse(c, "Forbidden", 403);
  }

  await deleteObject(storage, record.key).catch((err) => {
    console.error(`Failed to delete object ${record.key} from storage:`, err);
  });

  return c.json({ ok: true });
}
