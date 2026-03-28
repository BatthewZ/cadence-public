/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for upload handler functions.
 *
 * Uses a real in-memory D1 database and R2 bucket (via Miniflare) so avatar
 * upload validation, file serving, ownership-based deletion, and cleanup-on-failure
 * logic are all exercised against actual storage. This catches regressions that
 * mocks would miss — particularly around the fail-safe upload ordering (R2 first,
 * then DB, with rollback on failure).
 */

import fs from "node:fs";
import path from "node:path";

import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../../db";
import type { AppEnv } from "../../env";
import { seedUser, TEST_USER, TEST_USER_2 } from "../../test-utils";
import { deleteUpload, serveUpload, uploadAvatar } from "./uploads.handlers";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let storage: R2Bucket;
let mf: Miniflare;

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
  storage = await mf.getR2Bucket("STORAGE") as unknown as R2Bucket;

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
});

afterAll(async () => {
  await mf.dispose();
});

// ---------------------------------------------------------------------------
// Middleware helpers
// ---------------------------------------------------------------------------

/**
 * Middleware that injects D1, STORAGE, and an authenticated user into the
 * Hono context. Extends the standard fakeAuth pattern with R2 bucket injection.
 */
function authWithStorage(
  user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER,
  storageOverride?: R2Bucket  ,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    (c.env as Record<string, unknown>).DB = d1;
    (c.env as Record<string, unknown>).STORAGE = storageOverride !== undefined ? storageOverride : storage;

    c.set("db", createDb(d1));
    c.set("user", user as never);
    c.set("session", null);
    c.set("requestId", "test-request-id");

    await next();
  };
}

/**
 * Middleware that injects D1 and STORAGE but no user (for unauthenticated routes).
 */
function envWithStorage(storageOverride?: R2Bucket  ): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    (c.env as Record<string, unknown>).DB = d1;
    (c.env as Record<string, unknown>).STORAGE = storageOverride !== undefined ? storageOverride : storage;

    await next();
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function avatarRequest(file: File): Request {
  const formData = new FormData();
  formData.append("file", file);
  return new Request("http://localhost/users/me/avatar", {
    method: "PUT",
    body: formData,
  });
}

/** Magic bytes for common file types so server-side MIME detection passes. */
const MAGIC_BYTES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
};

function createTestFile(
  name: string,
  type: string,
  sizeBytes: number,
): File {
  const buffer = new Uint8Array(Math.max(sizeBytes, 16));
  const magic = MAGIC_BYTES[type];
  if (magic) {
    buffer.set(magic, 0);
  }
  return new File([buffer], name, { type });
}

// ---------------------------------------------------------------------------
// uploadAvatar
// ---------------------------------------------------------------------------

describe("uploadAvatar", () => {
  // Clean up upload records between tests to prevent cross-test pollution
  beforeEach(async () => {
    await d1.prepare("DELETE FROM upload").run();
    // Reset user image to null
    await d1
      .prepare("UPDATE user SET image = NULL WHERE id = ?")
      .bind(TEST_USER.id)
      .run();
    // Clear all R2 objects
    const listed = await storage.list();
    for (const obj of listed.objects) {
      await storage.delete(obj.key);
    }
  });

  it("uploads a valid avatar successfully", async () => {
    const app = new Hono<AppEnv>();
    app.put("/users/me/avatar", authWithStorage(), uploadAvatar);

    const file = createTestFile("avatar.jpg", "image/jpeg", 1024);
    const res = await app.request(avatarRequest(file));

    expect(res.status).toBe(200);
    const body = await res.json<{ upload: { id: string; url: string; filename: string; mimeType: string; size: number } }>();

    expect(body.upload).toBeDefined();
    expect(body.upload.id).toBeTruthy();
    expect(body.upload.url).toMatch(/^\/api\/uploads\/avatar\//);
    expect(body.upload.filename).toBe("avatar.jpg");
    expect(body.upload.mimeType).toBe("image/jpeg");
    expect(body.upload.size).toBe(1024);

    // Verify DB record
    const record = await d1
      .prepare("SELECT * FROM upload WHERE id = ?")
      .bind(body.upload.id)
      .first();
    expect(record).toBeTruthy();
    expect(record!.userId).toBe(TEST_USER.id);
    expect(record!.purpose).toBe("avatar");
    expect(record!.filename).toBe("avatar.jpg");

    // Verify user image was updated
    const user = await d1
      .prepare("SELECT image FROM user WHERE id = ?")
      .bind(TEST_USER.id)
      .first<{ image: string }>();
    expect(user!.image).toBe(body.upload.url);

    // Verify R2 object exists
    const key = (record as { key: string }).key;
    const r2Obj = await storage.get(key);
    expect(r2Obj).toBeTruthy();
  });

  it("replaces old avatar and cleans up previous upload", async () => {
    const app = new Hono<AppEnv>();
    app.put("/users/me/avatar", authWithStorage(), uploadAvatar);

    // Upload first avatar
    const file1 = createTestFile("first.png", "image/png", 512);
    const res1 = await app.request(avatarRequest(file1));
    expect(res1.status).toBe(200);
    const body1 = await res1.json<{ upload: { id: string; url: string } }>();
    const firstId = body1.upload.id;

    // Get the R2 key of first upload
    const firstRecord = await d1
      .prepare("SELECT key FROM upload WHERE id = ?")
      .bind(firstId)
      .first<{ key: string }>();

    // Upload second avatar
    const file2 = createTestFile("second.png", "image/png", 768);
    const res2 = await app.request(avatarRequest(file2));
    expect(res2.status).toBe(200);
    const body2 = await res2.json<{ upload: { id: string; url: string } }>();

    // New upload should exist
    const newRecord = await d1
      .prepare("SELECT * FROM upload WHERE id = ?")
      .bind(body2.upload.id)
      .first();
    expect(newRecord).toBeTruthy();

    // Old upload record should be deleted
    const oldRecord = await d1
      .prepare("SELECT * FROM upload WHERE id = ?")
      .bind(firstId)
      .first();
    expect(oldRecord).toBeNull();

    // Old R2 object should be deleted
    const oldR2 = await storage.get(firstRecord!.key);
    expect(oldR2).toBeNull();

    // User image should point to new avatar
    const user = await d1
      .prepare("SELECT image FROM user WHERE id = ?")
      .bind(TEST_USER.id)
      .first<{ image: string }>();
    expect(user!.image).toBe(body2.upload.url);
  });

  it("rejects request with no file field", async () => {
    const app = new Hono<AppEnv>();
    app.put("/users/me/avatar", authWithStorage(), uploadAvatar);

    const formData = new FormData();
    const req = new Request("http://localhost/users/me/avatar", {
      method: "PUT",
      body: formData,
    });

    const res = await app.request(req);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("No file provided");
  });

  it("rejects invalid file type", async () => {
    const app = new Hono<AppEnv>();
    app.put("/users/me/avatar", authWithStorage(), uploadAvatar);

    const file = createTestFile("notes.txt", "text/plain", 256);
    const res = await app.request(avatarRequest(file));

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/Invalid file type/);
  });

  it("rejects file exceeding 2MB size limit", async () => {
    const app = new Hono<AppEnv>();
    app.put("/users/me/avatar", authWithStorage(), uploadAvatar);

    // 3MB file — exceeds the 2MB limit
    const file = createTestFile("huge.jpg", "image/jpeg", 3 * 1024 * 1024);
    const res = await app.request(avatarRequest(file));

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/File too large/);
  });

  it("returns 503 when storage is not configured", async () => {
    const app = new Hono<AppEnv>();
    // Pass undefined for storage to simulate missing STORAGE env
    app.put("/users/me/avatar", authWithStorage(TEST_USER, undefined as unknown as R2Bucket), uploadAvatar);

    // We need to explicitly set STORAGE to undefined/falsy
    const appNoStorage = new Hono<AppEnv>();
    appNoStorage.put("/users/me/avatar", async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      (c.env as Record<string, unknown>).DB = d1;
      // Deliberately do NOT set STORAGE
      c.set("db", createDb(d1));
      c.set("user", TEST_USER as never);
      c.set("session", null);
      c.set("requestId", "test-request-id");
      await next();
    }, uploadAvatar);

    const file = createTestFile("avatar.jpg", "image/jpeg", 1024);
    const res = await appNoStorage.request(avatarRequest(file));

    expect(res.status).toBe(503);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("File storage is not configured");
  });

  it("cleans up R2 object when DB insert fails", async () => {
    // Pre-insert a record with a known ID to cause a primary key conflict
    const conflictId = "conflict-upload-id";
    await d1
      .prepare(
        "INSERT INTO upload (id, userId, key, filename, mimeType, size, purpose, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(conflictId, TEST_USER.id, "avatar/test/conflict.jpg", "conflict.jpg", "image/jpeg", 100, "avatar", Math.floor(Date.now() / 1000))
      .run();

    // Mock crypto.randomUUID: first call is for generateObjectKey, second for the upload record ID
    const originalRandomUUID = crypto.randomUUID.bind(crypto);
    let callCount = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation((): `${string}-${string}-${string}-${string}-${string}` => {
      callCount++;
      if (callCount === 2) {
        // This is the upload record ID — return the conflicting ID
        return conflictId as `${string}-${string}-${string}-${string}-${string}`;
      }
      // For generateObjectKey and any other calls, use a unique value
      return originalRandomUUID();
    });

    const app = new Hono<AppEnv>();
    app.put("/users/me/avatar", authWithStorage(), uploadAvatar);

    const file = createTestFile("new-avatar.jpg", "image/jpeg", 512);
    const res = await app.request(avatarRequest(file));

    expect(res.status).toBe(500);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Failed to save upload");

    // Verify no orphaned R2 objects (the handler should have cleaned up)
    // The only R2 object that should exist is none (since cleanup ran)
    const listed = await storage.list();
    // The pre-existing conflict record's key "avatar/test/conflict.jpg" was never in R2,
    // and the new upload's R2 object should have been cleaned up
    const newUploadObjects = listed.objects.filter(
      (o) => o.key !== "avatar/test/conflict.jpg",
    );
    expect(newUploadObjects.length).toBe(0);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// serveUpload
// ---------------------------------------------------------------------------

describe("serveUpload", () => {
  const testKey = "avatar/test-user-id/test-serve-file.jpg";
  const testContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes

  beforeEach(async () => {
    // Re-upload the test file before each serve test (uploadAvatar's
    // beforeEach may have cleared R2 between describe blocks)
    await storage.put(testKey, testContent, {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { filename: "test-serve-file.jpg" },
    });
  });

  it("serves an existing file with correct headers", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/uploads/:purpose/:userId/:filename",
      envWithStorage(),
      serveUpload,
    );

    const req = new Request("http://localhost/uploads/avatar/test-user-id/test-serve-file.jpg");
    const res = await app.request(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(testContent);
  });

  it("returns 404 for non-existent file", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/uploads/:purpose/:userId/:filename",
      envWithStorage(),
      serveUpload,
    );

    const req = new Request("http://localhost/uploads/avatar/nobody/missing.jpg");
    const res = await app.request(req);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("File not found");
  });

  it("returns 503 when storage is not configured", async () => {
    const app = new Hono<AppEnv>();
    app.get("/uploads/:purpose/:userId/:filename", async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      // No STORAGE set
      await next();
    }, serveUpload);

    const req = new Request("http://localhost/uploads/avatar/test-user-id/test-serve-file.jpg");
    const res = await app.request(req);

    expect(res.status).toBe(503);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("File storage is not configured");
  });
});

// ---------------------------------------------------------------------------
// deleteUpload
// ---------------------------------------------------------------------------

describe("deleteUpload", () => {
  let ownedUploadId: string;
  let ownedUploadKey: string;

  beforeEach(async () => {
    // Clean up between tests
    await d1.prepare("DELETE FROM upload").run();
    const listed = await storage.list();
    for (const obj of listed.objects) {
      // Don't delete the serve test file
      if (obj.key !== "avatar/test-user-id/test-serve-file.jpg") {
        await storage.delete(obj.key);
      }
    }

    // Seed an upload owned by TEST_USER
    ownedUploadId = crypto.randomUUID();
    ownedUploadKey = `avatar/${TEST_USER.id}/${ownedUploadId}.jpg`;
    await storage.put(ownedUploadKey, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await d1
      .prepare(
        "INSERT INTO upload (id, userId, key, filename, mimeType, size, purpose, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        ownedUploadId,
        TEST_USER.id,
        ownedUploadKey,
        "owned.jpg",
        "image/jpeg",
        3,
        "avatar",
        Math.floor(Date.now() / 1000),
      )
      .run();
  });

  it("allows owner to delete their upload", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/uploads/:id", authWithStorage(TEST_USER), deleteUpload);

    const req = new Request(`http://localhost/uploads/${ownedUploadId}`, {
      method: "DELETE",
    });
    const res = await app.request(req);

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify DB record removed
    const record = await d1
      .prepare("SELECT * FROM upload WHERE id = ?")
      .bind(ownedUploadId)
      .first();
    expect(record).toBeNull();

    // Verify R2 object removed
    const r2Obj = await storage.get(ownedUploadKey);
    expect(r2Obj).toBeNull();
  });

  it("returns 403 when non-owner tries to delete", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/uploads/:id", authWithStorage(TEST_USER_2), deleteUpload);

    const req = new Request(`http://localhost/uploads/${ownedUploadId}`, {
      method: "DELETE",
    });
    const res = await app.request(req);

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Forbidden");

    // Verify the upload still exists
    const record = await d1
      .prepare("SELECT * FROM upload WHERE id = ?")
      .bind(ownedUploadId)
      .first();
    expect(record).toBeTruthy();
  });

  it("returns 404 for non-existent upload", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/uploads/:id", authWithStorage(TEST_USER), deleteUpload);

    const req = new Request("http://localhost/uploads/non-existent-id", {
      method: "DELETE",
    });
    const res = await app.request(req);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Upload not found");
  });

  it("returns 503 when storage is not configured", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/uploads/:id", async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      (c.env as Record<string, unknown>).DB = d1;
      // No STORAGE set
      c.set("db", createDb(d1));
      c.set("user", TEST_USER as never);
      c.set("session", null);
      c.set("requestId", "test-request-id");
      await next();
    }, deleteUpload);

    const req = new Request(`http://localhost/uploads/${ownedUploadId}`, {
      method: "DELETE",
    });
    const res = await app.request(req);

    expect(res.status).toBe(503);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("File storage is not configured");
  });
});
