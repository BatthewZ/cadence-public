import { and, asc, count, eq } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { task } from "../../../db/schema/task";
import { taskAttachment } from "../../../db/schema/task-attachment";
import { upload } from "../../../db/schema/uploads";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
} from "../../../shared/schemas/attachment";
import type { AppEnv } from "../../env";
import { deferWork } from "../../lib/defer";
import { errorResponse } from "../../lib/error-response";
import { detectMimeType } from "../../lib/mime-detect";
import { requireParam, requireParams } from "../../lib/params";
import { deleteObject, generateObjectKey, putObject } from "../../lib/storage";
import { logActivity } from "./log-activity";

export async function uploadAttachment(c: Context<AppEnv>) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  const user = c.get("user")!;
  const taskId = requireParam(c, "taskId");
  const db = c.get("db");

  const formData = await c.req.parseBody();
  const file = formData["file"];

  if (!(file instanceof File)) {
    return errorResponse(c, "No file provided", 400);
  }

  // Strip MIME parameters (e.g. "text/plain;charset=utf-8" → "text/plain")
  const baseMimeType = file.type.split(";")[0].trim().toLowerCase();

  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(baseMimeType)) {
    return errorResponse(c, "Invalid file type. Allowed types: images, PDFs, documents, text, CSV, ZIP", 400);
  }

  if (file.size > MAX_ATTACHMENT_SIZE) {
    return errorResponse(c, "File too large. Maximum size is 10MB", 400);
  }

  // Check attachment count limit
  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(taskAttachment)
    .where(eq(taskAttachment.taskId, taskId));

  if (cnt >= MAX_ATTACHMENTS_PER_TASK) {
    return errorResponse(c, `Maximum of ${MAX_ATTACHMENTS_PER_TASK} attachments per task reached`, 400);
  }

  // Upload to R2 first — if this fails, no DB records to clean up
  const key = generateObjectKey("task-attachment", user.id, file.name);
  const arrayBuffer = await file.arrayBuffer();

  // Validate file content against magic bytes — don't trust client-provided MIME type
  const detectedMime = detectMimeType(arrayBuffer, baseMimeType);
  if (!detectedMime) {
    return errorResponse(c, "File content does not match its declared type", 400);
  }

  // Use the server-detected MIME type for storage, not the client-provided one
  const verifiedMimeType = detectedMime;

  try {
    await putObject(storage, key, arrayBuffer, {
      mimeType: verifiedMimeType,
      filename: file.name,
    });
  } catch (error) {
    console.error("Failed to upload attachment to R2:", { taskId, userId: user.id, key }, error);
    return errorResponse(c, "Failed to upload file", 500);
  }

  const uploadId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  const now = new Date();

  try {
    await db.batch([
      db.insert(upload).values({
        id: uploadId,
        userId: user.id,
        key,
        filename: file.name,
        mimeType: verifiedMimeType,
        size: file.size,
        purpose: "task-attachment",
        createdAt: now,
      }),
      db.insert(taskAttachment).values({
        id: attachmentId,
        taskId,
        uploadId,
        createdAt: now,
      }),
      db.update(task).set({ updatedAt: now }).where(eq(task.id, taskId)),
    ] as const);
  } catch (error) {
    // Clean up R2 object and any partially-inserted records
    await deleteObject(storage, key).catch((err) =>
      console.error("Failed to clean up orphaned attachment R2 object:", { taskId, key, uploadId }, err),
    );
    await db.delete(upload).where(eq(upload.id, uploadId)).catch((err) =>
      console.error("Failed to clean up orphaned upload record:", { taskId, uploadId }, err),
    );
    console.error("Failed to save attachment records:", { taskId, userId: user.id, key, uploadId, attachmentId }, error);
    return errorResponse(c, "Failed to save attachment", 500);
  }

  const uploadApiTokenId = c.get("apiToken")?.id ?? null;
  deferWork(c, () => logActivity(db, {
    taskId,
    actorId: user.id,
    action: "attachment_added",
    newValue: file.name,
    apiTokenId: uploadApiTokenId,
  }));

  return c.json(
    {
      attachment: {
        id: attachmentId,
        uploadId,
        filename: file.name,
        mimeType: verifiedMimeType,
        size: file.size,
        url: `/api/uploads/${key}`,
        uploaderName: user.name,
        uploaderImage: user.image ?? null,
        createdAt: now.toISOString(),
      },
    },
    201,
  );
}

export async function listAttachments(c: Context<AppEnv>) {
  const taskId = requireParam(c, "taskId");
  const db = c.get("db");

  const attachments = await db
    .select({
      id: taskAttachment.id,
      uploadId: taskAttachment.uploadId,
      filename: upload.filename,
      mimeType: upload.mimeType,
      size: upload.size,
      key: upload.key,
      uploaderName: userTable.name,
      uploaderImage: userTable.image,
      createdAt: taskAttachment.createdAt,
    })
    .from(taskAttachment)
    .innerJoin(upload, eq(taskAttachment.uploadId, upload.id))
    .leftJoin(userTable, eq(upload.userId, userTable.id))
    .where(eq(taskAttachment.taskId, taskId))
    .orderBy(asc(taskAttachment.createdAt));

  return c.json({
    attachments: attachments.map((a) => ({
      id: a.id,
      uploadId: a.uploadId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      url: `/api/uploads/${a.key}`,
      uploaderName: a.uploaderName,
      uploaderImage: a.uploaderImage,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function deleteAttachment(c: Context<AppEnv>) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  const user = c.get("user")!;
  const { taskId, attachmentId } = requireParams(c, "taskId", "attachmentId");
  const db = c.get("db");

  // Verify attachment belongs to this task and get upload info
  const [record] = await db
    .select({
      id: taskAttachment.id,
      uploadId: taskAttachment.uploadId,
      key: upload.key,
      filename: upload.filename,
      uploadUserId: upload.userId,
    })
    .from(taskAttachment)
    .innerJoin(upload, eq(taskAttachment.uploadId, upload.id))
    .where(
      and(
        eq(taskAttachment.id, attachmentId),
        eq(taskAttachment.taskId, taskId),
      ),
    )
    .limit(1);

  if (!record) {
    return errorResponse(c, "Attachment not found", 404);
  }

  // Authorization: allow if user is uploader OR has admin/member role
  const isUploader = record.uploadUserId === user.id;
  const projectAccess = c.get("projectAccess");
  const hasEditRole = projectAccess != null && ["admin", "member"].includes(projectAccess.role);
  if (!isUploader && !hasEditRole) {
    return errorResponse(c, "Not authorized to delete this attachment", 403);
  }

  // Delete DB records (batch) and R2 object (best-effort) concurrently
  await Promise.all([
    db.batch([
      db.delete(taskAttachment).where(eq(taskAttachment.id, attachmentId)),
      db.delete(upload).where(eq(upload.id, record.uploadId)),
      db.update(task).set({ updatedAt: new Date() }).where(eq(task.id, taskId)),
    ] as const),
    deleteObject(storage, record.key).catch((err) =>
      console.error("Failed to delete attachment R2 object:", { taskId, attachmentId, key: record.key }, err),
    ),
  ]);

  const deleteApiTokenId = c.get("apiToken")?.id ?? null;
  deferWork(c, () => logActivity(db, {
    taskId,
    actorId: user.id,
    action: "attachment_removed",
    newValue: record.filename,
    apiTokenId: deleteApiTokenId,
  }));

  return c.json({ ok: true, deletedId: attachmentId });
}
