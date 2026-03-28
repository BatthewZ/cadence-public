/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for task attachment handler functions.
 *
 * Uses a real in-memory D1 database and R2 bucket (via Miniflare) so upload,
 * listing, and deletion logic are exercised against actual storage. This catches
 * regressions around the fail-safe upload ordering (R2 first, then DB, with
 * rollback on failure) and attachment count limits.
 */

import fs from "node:fs";
import path from "node:path";

import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../../db";
import type { AppEnv } from "../../env";

// Response shapes for type-safe assertions
interface AttachmentData {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  uploaderName: string;
}

interface UploadResponse {
  attachment: AttachmentData;
}

interface ListResponse {
  attachments: AttachmentData[];
}

interface DeleteResponse {
  ok: boolean;
  deletedId: string;
}

interface ErrorResponse {
  error: string;
}

import {
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import { deleteAttachment, listAttachments, uploadAttachment } from "./attachments.handlers";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let storage: R2Bucket;
let mf: Miniflare;
let projectId: string;
let taskGroupId: string;
let taskId: string;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../migrations");

function splitStatements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !s.split("\n").every((line) => line.trim().startsWith("--") || line.trim() === ""),
    );
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ["DB"],
    r2Buckets: ["STORAGE"],
  });

  d1 = await mf.getD1Database("DB");
  storage = (await mf.getR2Bucket("STORAGE")) as unknown as R2Bucket;

  // Apply all migrations
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8").trim();
    if (!sql) continue;
    const stmts = splitStatements(sql);
    if (stmts.length === 0) continue;
    const prepared = stmts.map((s) => d1.prepare(s));
    await d1.batch(prepared);
  }

  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);

  const workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  taskGroupId = await seedTaskGroup(d1, projectId);
});

afterAll(async () => {
  await mf.dispose();
});

// Reset task for each test to avoid cross-test interference
beforeEach(async () => {
  // Clean up attachments and uploads from previous tests
  await d1.prepare("DELETE FROM task_attachment").run();
  await d1.prepare("DELETE FROM upload WHERE purpose = 'task-attachment'").run();
  await d1.prepare("DELETE FROM task").run();

  taskId = await seedTask(d1, projectId, taskGroupId, { title: "Attachment Test Task" });
});

// ---------------------------------------------------------------------------
// Middleware helpers
// ---------------------------------------------------------------------------

function authWithStorage(
  user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER,
  storageOverride?: R2Bucket,
  projectAccess?: { role: "admin" | "member" | "viewer"; source: "workspace" | "project" },
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    (c.env as Record<string, unknown>).DB = d1;
    (c.env as Record<string, unknown>).STORAGE =
      storageOverride !== undefined ? storageOverride : storage;

    c.set("db", createDb(d1));
    c.set("user", user as never);
    c.set("session", null);
    c.set("requestId", "test-request-id");

    if (projectAccess) {
      c.set("projectAccess", projectAccess);
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function attachmentRequest(taskIdParam: string, file: File): Request {
  const formData = new FormData();
  formData.append("file", file);
  return new Request(`http://localhost/tasks/${taskIdParam}/attachments`, {
    method: "POST",
    body: formData,
  });
}

/** Magic bytes for common file types so server-side MIME detection passes. */
const MAGIC_BYTES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
  "application/zip": [0x50, 0x4b, 0x03, 0x04],
  "text/plain": [0x48, 0x65, 0x6c, 0x6c, 0x6f], // "Hello"
  "text/csv": [0x6e, 0x61, 0x6d, 0x65, 0x2c], // "name,"
};

function createTestFile(name: string, type: string, sizeBytes: number): File {
  const buffer = new Uint8Array(Math.max(sizeBytes, 16));
  const magic = MAGIC_BYTES[type];
  if (magic) {
    buffer.set(magic, 0);
  }
  return new File([buffer], name, { type });
}

// ---------------------------------------------------------------------------
// uploadAttachment
// ---------------------------------------------------------------------------

describe("uploadAttachment", () => {
  it("uploads a valid file and returns attachment data", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("test.pdf", "application/pdf", 1024);
    const res = await app.request(attachmentRequest(taskId, file));

    expect(res.status).toBe(201);

    const body: UploadResponse = await res.json();
    expect(body.attachment).toBeDefined();
    expect(body.attachment.filename).toBe("test.pdf");
    expect(body.attachment.mimeType).toBe("application/pdf");
    expect(body.attachment.size).toBe(1024);
    expect(body.attachment.url).toContain("/api/uploads/task-attachment/");
    expect(body.attachment.uploaderName).toBe(TEST_USER.name);
  });

  it("rejects invalid MIME type", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("malware.exe", "application/x-msdownload", 100);
    const res = await app.request(attachmentRequest(taskId, file));

    expect(res.status).toBe(400);
    const body: ErrorResponse = await res.json();
    expect(body.error).toContain("Invalid file type");
  });

  it("rejects file with spoofed MIME type (content doesn't match)", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    // Create a file claiming to be PDF but with HTML content (no PDF magic bytes)
    const htmlContent = new TextEncoder().encode("<html><script>alert('xss')</script></html>");
    const file = new File([htmlContent], "fake.pdf", { type: "application/pdf" });
    const res = await app.request(attachmentRequest(taskId, file));

    expect(res.status).toBe(400);
    const body: ErrorResponse = await res.json();
    expect(body.error).toContain("does not match");
  });

  it("rejects text file containing HTML/script patterns", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const htmlContent = new TextEncoder().encode("normal text\n<script>alert('xss')</script>");
    const file = new File([htmlContent], "notes.txt", { type: "text/plain" });
    const res = await app.request(attachmentRequest(taskId, file));

    expect(res.status).toBe(400);
    const body: ErrorResponse = await res.json();
    expect(body.error).toContain("does not match");
  });

  it("rejects file larger than 10MB", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("huge.pdf", "application/pdf", 11 * 1024 * 1024);
    const res = await app.request(attachmentRequest(taskId, file));

    expect(res.status).toBe(400);
    const body: ErrorResponse = await res.json();
    expect(body.error).toContain("File too large");
  });

  it("rejects request without file", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const res = await app.request(
      new Request(`http://localhost/tasks/${taskId}/attachments`, {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(res.status).toBe(400);
    const body: ErrorResponse = await res.json();
    expect(body.error).toBe("No file provided");
  });

  it("enforces maximum attachments per task limit", { timeout: 30_000 }, async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    // Upload 20 attachments
    for (let i = 0; i < 20; i++) {
      const file = createTestFile(`file${i}.png`, "image/png", 100);
      const res = await app.request(attachmentRequest(taskId, file));
      expect(res.status).toBe(201);
    }

    // 21st should fail
    const file = createTestFile("file20.png", "image/png", 100);
    const res = await app.request(attachmentRequest(taskId, file));
    expect(res.status).toBe(400);
    const body: ErrorResponse = await res.json();
    expect(body.error).toContain("Maximum of 20");
  });

  it("returns 503 when storage is not configured", async () => {
    const app = new Hono<AppEnv>();
    app.post(
      "/tasks/:taskId/attachments",
      authWithStorage(TEST_USER, undefined as unknown as R2Bucket),
      uploadAttachment,
    );

    // Override to remove storage
    const noStorageApp = new Hono<AppEnv>();
    const noStorageMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      (c.env as Record<string, unknown>).DB = d1;
      c.set("user", TEST_USER as never);
      c.set("session", null);
      c.set("requestId", "test-request-id");
      await next();
    };
    noStorageApp.post("/tasks/:taskId/attachments", noStorageMiddleware, uploadAttachment);

    const file = createTestFile("test.png", "image/png", 100);
    const res = await noStorageApp.request(attachmentRequest(taskId, file));
    expect(res.status).toBe(503);
  });

  it("stores file in R2 with correct key structure", async () => {
    const app = new Hono<AppEnv>();
    app.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("document.pdf", "application/pdf", 512);
    const res = await app.request(attachmentRequest(taskId, file));
    expect(res.status).toBe(201);

    const body: UploadResponse = await res.json();
    const key = body.attachment.url.replace("/api/uploads/", "");
    expect(key).toMatch(/^task-attachment\/test-user-id\/[a-f0-9-]+\.pdf$/);

    // Verify R2 object exists
    const obj = await storage.get(key);
    expect(obj).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listAttachments
// ---------------------------------------------------------------------------

describe("listAttachments", () => {
  it("returns empty array when no attachments", async () => {
    const app = new Hono<AppEnv>();
    app.get("/tasks/:taskId/attachments", authWithStorage(), listAttachments);

    const res = await app.request(`http://localhost/tasks/${taskId}/attachments`);
    expect(res.status).toBe(200);

    const body: ListResponse = await res.json();
    expect(body.attachments).toEqual([]);
  });

  it("returns uploaded attachments in order", async () => {
    const uploadApp = new Hono<AppEnv>();
    uploadApp.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    // Upload two files
    const file1 = createTestFile("first.png", "image/png", 100);
    await uploadApp.request(attachmentRequest(taskId, file1));
    const file2 = createTestFile("second.pdf", "application/pdf", 200);
    await uploadApp.request(attachmentRequest(taskId, file2));

    const listApp = new Hono<AppEnv>();
    listApp.get("/tasks/:taskId/attachments", authWithStorage(), listAttachments);

    const res = await listApp.request(`http://localhost/tasks/${taskId}/attachments`);
    expect(res.status).toBe(200);

    const body: ListResponse = await res.json();
    expect(body.attachments).toHaveLength(2);
    expect(body.attachments[0].filename).toBe("first.png");
    expect(body.attachments[1].filename).toBe("second.pdf");
    expect(body.attachments[0].uploaderName).toBe(TEST_USER.name);
  });
});

// ---------------------------------------------------------------------------
// deleteAttachment
// ---------------------------------------------------------------------------

describe("deleteAttachment", () => {
  it("deletes an attachment and cleans up R2", async () => {
    // Upload first
    const uploadApp = new Hono<AppEnv>();
    uploadApp.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("to-delete.png", "image/png", 100);
    const uploadRes = await uploadApp.request(attachmentRequest(taskId, file));
    const { attachment }: UploadResponse = await uploadRes.json();

    const key = attachment.url.replace("/api/uploads/", "");

    // Verify R2 object exists before delete
    expect(await storage.get(key)).not.toBeNull();

    // Delete
    const deleteApp = new Hono<AppEnv>();
    deleteApp.delete(
      "/tasks/:taskId/attachments/:attachmentId",
      authWithStorage(),
      deleteAttachment,
    );

    const res = await deleteApp.request(
      new Request(
        `http://localhost/tasks/${taskId}/attachments/${attachment.id}`,
        { method: "DELETE" },
      ),
    );
    expect(res.status).toBe(200);

    const body: DeleteResponse = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deletedId).toBe(attachment.id);

    // Verify R2 object is gone
    expect(await storage.get(key)).toBeNull();

    // Verify attachment is gone from list
    const listApp = new Hono<AppEnv>();
    listApp.get("/tasks/:taskId/attachments", authWithStorage(), listAttachments);
    const listRes = await listApp.request(`http://localhost/tasks/${taskId}/attachments`);
    const listBody: ListResponse = await listRes.json();
    expect(listBody.attachments).toHaveLength(0);
  });

  it("returns 404 for non-existent attachment", async () => {
    const app = new Hono<AppEnv>();
    app.delete(
      "/tasks/:taskId/attachments/:attachmentId",
      authWithStorage(),
      deleteAttachment,
    );

    const res = await app.request(
      new Request(
        `http://localhost/tasks/${taskId}/attachments/non-existent-id`,
        { method: "DELETE" },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("allows uploader to delete own attachment even as viewer", async () => {
    // Upload as TEST_USER
    const uploadApp = new Hono<AppEnv>();
    uploadApp.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("my-file.png", "image/png", 100);
    const uploadRes = await uploadApp.request(attachmentRequest(taskId, file));
    const { attachment }: UploadResponse = await uploadRes.json();

    // Delete as TEST_USER with viewer role — should succeed because they are the uploader
    const deleteApp = new Hono<AppEnv>();
    deleteApp.delete(
      "/tasks/:taskId/attachments/:attachmentId",
      authWithStorage(TEST_USER, undefined, { role: "viewer", source: "project" }),
      deleteAttachment,
    );

    const res = await deleteApp.request(
      new Request(
        `http://localhost/tasks/${taskId}/attachments/${attachment.id}`,
        { method: "DELETE" },
      ),
    );
    expect(res.status).toBe(200);
    const body: DeleteResponse = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects non-uploader viewer from deleting attachment", async () => {
    // Upload as TEST_USER
    const uploadApp = new Hono<AppEnv>();
    uploadApp.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("not-mine.png", "image/png", 100);
    const uploadRes = await uploadApp.request(attachmentRequest(taskId, file));
    const { attachment }: UploadResponse = await uploadRes.json();

    // Attempt delete as TEST_USER_2 with viewer role — should fail (not uploader AND not admin/member)
    const deleteApp = new Hono<AppEnv>();
    deleteApp.delete(
      "/tasks/:taskId/attachments/:attachmentId",
      authWithStorage(TEST_USER_2, undefined, { role: "viewer", source: "project" }),
      deleteAttachment,
    );

    const res = await deleteApp.request(
      new Request(
        `http://localhost/tasks/${taskId}/attachments/${attachment.id}`,
        { method: "DELETE" },
      ),
    );
    expect(res.status).toBe(403);
    const body: ErrorResponse = await res.json();
    expect(body.error).toContain("Not authorized");
  });

  it("allows admin/member to delete any attachment regardless of uploader", async () => {
    // Upload as TEST_USER
    const uploadApp = new Hono<AppEnv>();
    uploadApp.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("someone-elses.pdf", "application/pdf", 200);
    const uploadRes = await uploadApp.request(attachmentRequest(taskId, file));
    const { attachment }: UploadResponse = await uploadRes.json();

    // Delete as TEST_USER_2 with admin role — should succeed even though they didn't upload it
    const deleteApp = new Hono<AppEnv>();
    deleteApp.delete(
      "/tasks/:taskId/attachments/:attachmentId",
      authWithStorage(TEST_USER_2, undefined, { role: "admin", source: "project" }),
      deleteAttachment,
    );

    const res = await deleteApp.request(
      new Request(
        `http://localhost/tasks/${taskId}/attachments/${attachment.id}`,
        { method: "DELETE" },
      ),
    );
    expect(res.status).toBe(200);
    const body: DeleteResponse = await res.json();
    expect(body.ok).toBe(true);
  });

  it("logs activity on upload and delete", async () => {
    // Upload
    const uploadApp = new Hono<AppEnv>();
    uploadApp.post("/tasks/:taskId/attachments", authWithStorage(), uploadAttachment);

    const file = createTestFile("activity-test.pdf", "application/pdf", 100);
    const uploadRes = await uploadApp.request(attachmentRequest(taskId, file));
    const { attachment }: UploadResponse = await uploadRes.json();

    // Check upload activity
    const activities = await d1
      .prepare("SELECT * FROM task_activity WHERE taskId = ? ORDER BY createdAt ASC")
      .bind(taskId)
      .all();

    const uploadActivity = activities.results.find(
      (a: Record<string, unknown>) => a.action === "attachment_added",
    );
    expect(uploadActivity).toBeDefined();
    expect((uploadActivity as Record<string, unknown>).newValue).toBe("activity-test.pdf");

    // Delete
    const deleteApp = new Hono<AppEnv>();
    deleteApp.delete(
      "/tasks/:taskId/attachments/:attachmentId",
      authWithStorage(),
      deleteAttachment,
    );

    await deleteApp.request(
      new Request(
        `http://localhost/tasks/${taskId}/attachments/${attachment.id}`,
        { method: "DELETE" },
      ),
    );

    // Check delete activity
    const activitiesAfter = await d1
      .prepare("SELECT * FROM task_activity WHERE taskId = ? ORDER BY createdAt ASC")
      .bind(taskId)
      .all();

    const deleteActivity = activitiesAfter.results.find(
      (a: Record<string, unknown>) => a.action === "attachment_removed",
    );
    expect(deleteActivity).toBeDefined();
    expect((deleteActivity as Record<string, unknown>).newValue).toBe("activity-test.pdf");
  });
});
