/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for upload handler functions.
 *
 * Uses a real in-memory D1 database and R2 bucket (via Miniflare) so avatar
 * upload validation, file serving, ownership-based deletion, and cleanup-on-failure
 * logic are all exercised against actual storage. This catches regressions that
 * mocks would miss — particularly around the fail-safe upload ordering (R2 first,
 * then DB, with rollback on failure).
 *
 * Real storage matters most for `serveUpload`: its whole job is now to decide
 * whether bytes leave the bucket, so the only assertion that means anything is
 * one made against the bytes an actual R2 read produced. See the `serveUpload`
 * describe block for why each denial case is in the fixture.
 */

import fs from "node:fs";
import path from "node:path";

import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "../../../db";
import type { ApiToken } from "../../../db/schema";
import type { AppEnv } from "../../env";
import {
  fakePat,
  makeTestUser,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
  type TestUserFixture,
} from "../../test-utils";
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
  // Restore mocks in a hook rather than at the end of the test body: the
  // `crypto.randomUUID` spy below would otherwise survive a mid-test failure
  // and leak into the serveUpload fixture, which mints many UUIDs.
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    // A rejected request must leave the bucket untouched. The 400 alone does
    // not prove that: nothing but statement order keeps `putObject` from
    // running before the guard. `beforeEach` empties the bucket, so any
    // object here was written by this request.
    expect((await storage.list()).objects).toHaveLength(0);
  });

  it("rejects invalid file type", async () => {
    const app = new Hono<AppEnv>();
    app.put("/users/me/avatar", authWithStorage(), uploadAvatar);

    const file = createTestFile("notes.txt", "text/plain", 256);
    const res = await app.request(avatarRequest(file));

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/Invalid file type/);

    // The MIME allow-list is a STORAGE gate, not a response gate. `uploadAvatar`
    // already reads the whole body up front for magic-byte detection, so a
    // plausible "read once, validate once" refactor could hoist `putObject`
    // above this check — leaving the 400 intact while arbitrary content
    // (scripts, HTML) lands in a bucket the app serves back. Only an assertion
    // on the bucket notices that.
    expect((await storage.list()).objects).toHaveLength(0);
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

    // Same reason as the MIME case: the 2MB cap only limits storage if the
    // oversized bytes never reach R2. Asserting the 400 without asserting the
    // bucket would let the cap decay into a cosmetic error message while every
    // rejected upload still consumed (and paid for) bucket space — an
    // unauthenticated-adjacent storage-exhaustion primitive.
    expect((await storage.list()).objects).toHaveLength(0);
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
  });
});

// ---------------------------------------------------------------------------
// serveUpload — object-level authorization
// ---------------------------------------------------------------------------

/**
 * These tests exist because `serveUpload` used to be a broken-object-level-
 * authorization hole: it built the R2 key straight from the URL segments and
 * streamed the bytes behind nothing but `requireAuth`. The `:userId` segment is
 * the *uploader's* id, not the caller's, so any signed-in account — including
 * one with no workspace, no project and no invitation — could download another
 * tenant's attachments and cover images while the metadata endpoints for the
 * same task correctly returned 403.
 *
 * Every assertion below is therefore stated as a POST-CONDITION on the bytes:
 * either the exact file content arrives, or `SECRET_MARKER` appears nowhere in
 * the response at all. Asserting "the handler returned 404" alone would not
 * catch a regression that wrote the body before setting the status, and
 * asserting "a lookup function was called" would not catch one that ignores
 * the result.
 *
 * The fixture is a two-tenant world so the denial cases are the realistic ones
 * (a different tenant, a stranger, an offboarded member, a narrowly-scoped PAT)
 * rather than synthetic ids that could never appear in production.
 */
describe("serveUpload", () => {
  /**
   * Sentinel content for the private objects. If this string ever appears in a
   * response that should have been denied, the test fails loudly and the reason
   * is unambiguous.
   */
  const SECRET_MARKER = "CONFIDENTIAL PAYROLL DATA";
  const secretBytes = new TextEncoder().encode(SECRET_MARKER);
  const coverBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const avatarBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  const OWNER: TestUserFixture = { ...TEST_USER };
  const MEMBER: TestUserFixture = { ...TEST_USER_2 };
  const VIEWER = makeTestUser("serve-viewer-id", "Viewer");
  const REVOKED = makeTestUser("serve-revoked-id", "Revoked Member");
  const STRANGER = makeTestUser("serve-stranger-id", "Stranger");
  const TENANT_B = makeTestUser("serve-tenant-b-id", "Other Tenant Owner");

  let workspaceA: string;
  let projectA: string;
  let projectA2: string;
  let taskA: string;

  let attachmentKey: string;
  let taskCoverKey: string;
  let projectCoverKey: string;
  let contestedTaskCoverKey: string;
  let contestedProjectCoverKey: string;
  let undecidableTaskCoverKey: string;
  let ownerAvatarKey: string;
  let orphanAttachmentKey: string;
  let unknownPurposeKey: string;
  /** R2 object reachable only by smuggling a `/` into a single path segment. */
  const traversalKey = `avatar/${TEST_USER.id}/../task-attachment/smuggled/secret.txt`;

  /** Insert an `upload` row for a key that already exists in R2. */
  async function insertUploadRow(
    key: string,
    purpose: string,
    mimeType: string,
    size: number,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await d1
      .prepare(
        "INSERT INTO upload (id, userId, key, filename, mimeType, size, purpose, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        OWNER.id,
        key,
        key.split("/").pop(),
        mimeType,
        size,
        purpose,
        Math.floor(Date.now() / 1000),
      )
      .run();
    return id;
  }

  /**
   * Mounts `serveUpload` with the context the real route provides: db, R2, the
   * authenticated user, and optionally a PAT. Deliberately does NOT mount
   * `requireAuth` — passing `user: null` proves the handler denies on its own
   * rather than depending on the route wiring staying correct.
   */
  function serveApp(user: TestUserFixture | null, apiToken?: ApiToken) {
    const app = new Hono<AppEnv>();
    app.get(
      "/uploads/:purpose/:userId/:filename",
      async (c, next) => {
        if (!c.env) {
          (c as unknown as { env: Record<string, unknown> }).env = {};
        }
        (c.env as Record<string, unknown>).DB = d1;
        (c.env as Record<string, unknown>).STORAGE = storage;
        c.set("db", createDb(d1));
        c.set("user", user as never);
        c.set("session", null);
        c.set("requestId", "test-request-id");
        if (apiToken) c.set("apiToken", apiToken);
        await next();
      },
      serveUpload,
    );
    return app;
  }

  function get(user: TestUserFixture | null, key: string, apiToken?: ApiToken) {
    return serveApp(user, apiToken).request(
      new Request(`http://localhost/uploads/${key}`),
    );
  }

  /** Post-condition: the exact bytes arrived. */
  async function expectBytes(res: Response, expected: Uint8Array) {
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(expected);
  }

  /**
   * Post-condition: nothing was served. Asserts the uniform 404 AND that the
   * secret appears nowhere in the response body.
   */
  async function expectDenied(res: Response) {
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain(SECRET_MARKER);
    expect(JSON.parse(text)).toMatchObject({ error: "File not found" });
  }

  /** A PAT bound to workspace A by default, narrowed to the given projects. */
  function pat(opts: {
    workspaceId?: string;
    projectScope: "all" | "selected";
    projectIds?: string[];
  }): ApiToken {
    return fakePat({
      id: crypto.randomUUID(),
      userId: OWNER.id,
      workspaceId: opts.workspaceId ?? workspaceA,
      name: "test token",
      tokenHash: crypto.randomUUID(),
      scopes: JSON.stringify(["read:*", "write:*"]),
      projectScope: opts.projectScope,
      projectIds: opts.projectIds ? JSON.stringify(opts.projectIds) : null,
    });
  }

  beforeAll(async () => {
    for (const u of [VIEWER, REVOKED, STRANGER, TENANT_B]) {
      await seedUser(d1, u);
    }

    // --- Tenant A -----------------------------------------------------------
    workspaceA = await seedWorkspace(d1, OWNER.id, { name: "Tenant A" });
    projectA = await seedProject(d1, workspaceA, { name: "Project A" });
    projectA2 = await seedProject(d1, workspaceA, { name: "Project A2" });
    const groupA = await seedTaskGroup(d1, projectA);
    taskA = await seedTask(d1, projectA, groupA);

    await seedWorkspaceMember(d1, workspaceA, MEMBER.id, "member");
    await seedProjectMember(d1, projectA, MEMBER.id, "member");
    // MEMBER is in projectA2 as well, so the contested-project-cover test can
    // assert that a plain member (not just the elevated workspace owner) still
    // receives the bytes. Workspace membership alone would not grant it.
    await seedProjectMember(d1, projectA2, MEMBER.id, "member");
    await seedWorkspaceMember(d1, workspaceA, VIEWER.id, "member");
    await seedProjectMember(d1, projectA, VIEWER.id, "viewer");

    // REVOKED starts as a fully legitimate member and stays one until the
    // offboarding test removes them mid-test. Seeding them already-removed
    // would have made that test a duplicate of the STRANGER case: at assertion
    // time an already-removed user is indistinguishable from one who was never
    // a member, so it would have proved nothing about revocation. REVOKED is
    // therefore used by exactly one test, which owns the transition.
    await seedWorkspaceMember(d1, workspaceA, REVOKED.id, "member");
    await seedProjectMember(d1, projectA, REVOKED.id, "member");

    // --- Tenant B (a real second tenant, not a synthetic id) ----------------
    const workspaceB = await seedWorkspace(d1, TENANT_B.id, { name: "Tenant B" });
    const projectB = await seedProject(d1, workspaceB, { name: "Project B" });
    const groupB = await seedTaskGroup(d1, projectB);
    const taskB = await seedTask(d1, projectB, groupB);
    const taskB2 = await seedTask(d1, projectB, groupB);
    const taskB3 = await seedTask(d1, projectB, groupB);

    // --- Objects ------------------------------------------------------------
    attachmentKey = `task-attachment/${OWNER.id}/${crypto.randomUUID()}.txt`;
    await storage.put(attachmentKey, secretBytes, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { filename: "payroll.txt" },
    });
    const attachmentUploadId = await insertUploadRow(
      attachmentKey,
      "task-attachment",
      "text/plain",
      secretBytes.byteLength,
    );
    await d1
      .prepare(
        "INSERT INTO task_attachment (id, taskId, uploadId, createdAt) VALUES (?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), taskA, attachmentUploadId, Math.floor(Date.now() / 1000))
      .run();

    taskCoverKey = `task-cover/${OWNER.id}/${crypto.randomUUID()}.png`;
    await storage.put(taskCoverKey, coverBytes, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertUploadRow(taskCoverKey, "task-cover", "image/png", coverBytes.byteLength);
    await d1
      .prepare("UPDATE task SET cover_image_key = ? WHERE id = ?")
      .bind(taskCoverKey, taskA)
      .run();

    projectCoverKey = `project-cover/${OWNER.id}/${crypto.randomUUID()}.png`;
    await storage.put(projectCoverKey, coverBytes, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertUploadRow(
      projectCoverKey,
      "project-cover",
      "image/png",
      coverBytes.byteLength,
    );
    await d1
      .prepare("UPDATE project SET cover_image_key = ? WHERE id = ?")
      .bind(projectCoverKey, projectA)
      .run();

    ownerAvatarKey = `avatar/${OWNER.id}/${crypto.randomUUID()}.jpg`;
    await storage.put(ownerAvatarKey, avatarBytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await insertUploadRow(ownerAvatarKey, "avatar", "image/jpeg", avatarBytes.byteLength);

    // An R2 object under a private prefix with no owning DB row — the state a
    // partially-failed upload or a deleted attachment leaves behind.
    orphanAttachmentKey = `task-attachment/${OWNER.id}/${crypto.randomUUID()}.txt`;
    await storage.put(orphanAttachmentKey, secretBytes, {
      httpMetadata: { contentType: "text/plain" },
    });

    // A purpose no branch enumerates, WITH a valid upload row, to prove the
    // switch's default is deny rather than "deny only when the row is missing".
    unknownPurposeKey = `invoice/${OWNER.id}/${crypto.randomUUID()}.txt`;
    await storage.put(unknownPurposeKey, secretBytes, {
      httpMetadata: { contentType: "text/plain" },
    });
    await insertUploadRow(unknownPurposeKey, "invoice", "text/plain", secretBytes.byteLength);

    await storage.put(traversalKey, secretBytes, {
      httpMetadata: { contentType: "text/plain" },
    });

    // --- Forged cover references --------------------------------------------
    // `updateTaskSchema` / `updateProjectSchema` still accept a client-supplied
    // `coverImageKey`, so anyone holding a cover URL — which every project
    // member receives in the project/task JSON — can point their OWN
    // task/project at it and try to read it through their own legitimate
    // access. These fixtures reproduce exactly that: a tenant-A cover (uploaded
    // by OWNER) whose key a tenant-B row also claims.
    //
    // The required outcome is BOTH halves: the forger gets nothing, AND the
    // real owner's members keep getting the bytes. Failing closed on any
    // contested key would satisfy the first half while handing any current or
    // former member a one-request way to blank the cover for everyone else.
    const taskA2 = await seedTask(d1, projectA, groupA);
    contestedTaskCoverKey = `task-cover/${OWNER.id}/${crypto.randomUUID()}.png`;
    await storage.put(contestedTaskCoverKey, secretBytes, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertUploadRow(
      contestedTaskCoverKey,
      "task-cover",
      "image/png",
      secretBytes.byteLength,
    );
    await d1
      .prepare("UPDATE task SET cover_image_key = ? WHERE id IN (?, ?)")
      .bind(contestedTaskCoverKey, taskA2, taskB)
      .run();

    contestedProjectCoverKey = `project-cover/${OWNER.id}/${crypto.randomUUID()}.png`;
    await storage.put(contestedProjectCoverKey, secretBytes, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertUploadRow(
      contestedProjectCoverKey,
      "project-cover",
      "image/png",
      secretBytes.byteLength,
    );
    await d1
      .prepare("UPDATE project SET cover_image_key = ? WHERE id IN (?, ?)")
      .bind(contestedProjectCoverKey, projectA2, projectB)
      .run();

    // Both claims sit in tenant B while the uploader is OWNER in tenant A, so
    // the uploader tiebreak cannot pick a winner. Ownership is undecidable.
    undecidableTaskCoverKey = `task-cover/${OWNER.id}/${crypto.randomUUID()}.png`;
    await storage.put(undecidableTaskCoverKey, secretBytes, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertUploadRow(
      undecidableTaskCoverKey,
      "task-cover",
      "image/png",
      secretBytes.byteLength,
    );
    // taskB2/taskB3 — NOT taskB, which already claims contestedTaskCoverKey.
    // Reusing it would silently overwrite that claim and leave the contested
    // fixture with a single claimant, making its tests pass for the wrong
    // reason.
    await d1
      .prepare("UPDATE task SET cover_image_key = ? WHERE id IN (?, ?)")
      .bind(undecidableTaskCoverKey, taskB2, taskB3)
      .run();
  });

  // --- task-attachment ------------------------------------------------------

  it("serves a task attachment to a direct project member", async () => {
    await expectBytes(await get(MEMBER, attachmentKey), secretBytes);
  });

  it("serves a task attachment to a workspace owner with no project_member row", async () => {
    // The elevation path: workspace owners/admins reach every project without a
    // project membership row. If this 404s, the fix has broken real users.
    await expectBytes(await get(OWNER, attachmentKey), secretBytes);
  });

  it("serves a task attachment to a project viewer", async () => {
    await expectBytes(await get(VIEWER, attachmentKey), secretBytes);
  });

  it("denies a task attachment to the owner of a different workspace", async () => {
    await expectDenied(await get(TENANT_B, attachmentKey));
  });

  it("denies a task attachment to a user with no workspace, project or invitation", async () => {
    await expectDenied(await get(STRANGER, attachmentKey));
  });

  it("stops serving a task attachment the moment a member's access is revoked", async () => {
    // The transition is the whole point, so it happens inside the test. Seeding
    // this user already-removed would make their DB state identical to
    // STRANGER's at assertion time — the test would duplicate the no-relationship
    // case and prove nothing about revocation.
    await expectBytes(await get(REVOKED, attachmentKey), secretBytes);

    await d1.prepare("DELETE FROM project_member WHERE userId = ?").bind(REVOKED.id).run();
    await d1.prepare("DELETE FROM workspace_member WHERE userId = ?").bind(REVOKED.id).run();

    // No sweep job, no cache to wait out: `serveUpload` holds no membership
    // state of its own and re-asks `resolveTaskAccess` on every request.
    await expectDenied(await get(REVOKED, attachmentKey));
  });

  it("marks a task attachment private, not public, in Cache-Control", async () => {
    const res = await get(MEMBER, attachmentKey);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  it("still forces download for non-image attachments", async () => {
    const res = await get(MEMBER, attachmentKey);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="payroll.txt"',
    );
  });

  // --- task-cover -----------------------------------------------------------

  // Split rather than packed into one `it`: a regression that wrongly denies
  // MEMBER would otherwise fail on the first line and hide whether STRANGER and
  // TENANT_B are simultaneously being allowed.
  it("serves a task cover to a project member", async () => {
    await expectBytes(await get(MEMBER, taskCoverKey), coverBytes);
  });

  it("serves a task cover to a workspace owner by elevation", async () => {
    await expectBytes(await get(OWNER, taskCoverKey), coverBytes);
  });

  it("denies a task cover to a user with no relationship to the project", async () => {
    await expectDenied(await get(STRANGER, taskCoverKey));
  });

  it("denies a task cover to the owner of a different workspace", async () => {
    await expectDenied(await get(TENANT_B, taskCoverKey));
  });

  it("marks a task cover private in Cache-Control", async () => {
    const res = await get(MEMBER, taskCoverKey);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  // --- project-cover --------------------------------------------------------

  it("serves a project cover to a project member", async () => {
    await expectBytes(await get(MEMBER, projectCoverKey), coverBytes);
  });

  it("serves a project cover to a workspace owner by elevation", async () => {
    await expectBytes(await get(OWNER, projectCoverKey), coverBytes);
  });

  it("denies a project cover to a user with no relationship to the project", async () => {
    await expectDenied(await get(STRANGER, projectCoverKey));
  });

  it("denies a project cover to the owner of a different workspace", async () => {
    await expectDenied(await get(TENANT_B, projectCoverKey));
  });

  it("marks a project cover private in Cache-Control", async () => {
    const res = await get(MEMBER, projectCoverKey);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  // --- avatar (deliberately readable by any signed-in user) -----------------

  it("serves another user's avatar to any signed-in user, with public caching", async () => {
    // Avatars are `user.image` and render across the whole app for people the
    // viewer can already see. Breaking this breaks every profile image.
    const res = await get(STRANGER, ownerAvatarKey);
    await expectBytes(res, avatarBytes);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("returns the same 404 for a missing avatar", async () => {
    await expectDenied(await get(MEMBER, "avatar/nobody/missing.jpg"));
  });

  // --- fail-closed edges ----------------------------------------------------

  it("denies an orphaned object under a private prefix with no owning row", async () => {
    await expectDenied(await get(OWNER, orphanAttachmentKey));
  });

  it("denies an unknown purpose even when a matching upload row exists", async () => {
    await expectDenied(await get(OWNER, unknownPurposeKey));
  });

  it("denies a percent-encoded separator that would smuggle a private key into the avatar branch", async () => {
    // Sanity: the object really is there, so a 404 can only come from the guard.
    expect(await storage.get(traversalKey)).toBeTruthy();

    const smuggled = `avatar/${OWNER.id}/..%2Ftask-attachment%2Fsmuggled%2Fsecret.txt`;
    await expectDenied(await get(STRANGER, smuggled));
  });

  it("denies a task cover to someone who forged a claim on its key", async () => {
    await expectDenied(await get(TENANT_B, contestedTaskCoverKey));
  });

  it("keeps serving a task cover to its real owners despite a forged claim", async () => {
    // The half that a fail-closed tiebreak would get wrong: forging a claim
    // must not let anyone blank the cover for the people entitled to see it.
    await expectBytes(await get(MEMBER, contestedTaskCoverKey), secretBytes);
    await expectBytes(await get(OWNER, contestedTaskCoverKey), secretBytes);
  });

  it("denies a project cover to someone who forged a claim on its key", async () => {
    await expectDenied(await get(TENANT_B, contestedProjectCoverKey));
  });

  it("keeps serving a project cover to its real owners despite a forged claim", async () => {
    await expectBytes(await get(MEMBER, contestedProjectCoverKey), secretBytes);
    await expectBytes(await get(OWNER, contestedProjectCoverKey), secretBytes);
  });

  it("denies a contested cover outright when the uploader can reach neither claim", async () => {
    // Uploader is OWNER (tenant A); both claims live in tenant B, so nothing
    // disambiguates them. Undecidable ownership must fail closed rather than
    // resolve to whichever row the database happened to return first.
    await expectDenied(await get(TENANT_B, undecidableTaskCoverKey));
    await expectDenied(await get(OWNER, undecidableTaskCoverKey));
    await expectDenied(await get(MEMBER, undecidableTaskCoverKey));
  });

  it("denies when no user is present in context", async () => {
    const res = await get(null, attachmentKey);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(SECRET_MARKER);
  });

  // --- PAT narrowing --------------------------------------------------------

  it("denies a PAT scoped to a sibling project in the same workspace", async () => {
    const token = pat({ projectScope: "selected", projectIds: [projectA2] });
    await expectDenied(await get(OWNER, attachmentKey, token));
  });

  it("serves to a PAT scoped to the owning project", async () => {
    const token = pat({ projectScope: "selected", projectIds: [projectA] });
    await expectBytes(await get(OWNER, attachmentKey, token), secretBytes);
  });

  it("denies a PAT bound to a different workspace even with projectScope 'all'", async () => {
    const token = pat({ workspaceId: "some-other-workspace", projectScope: "all" });
    await expectDenied(await get(OWNER, attachmentKey, token));
  });

  // --- infrastructure -------------------------------------------------------

  it("returns 503 when storage is not configured", async () => {
    const app = new Hono<AppEnv>();
    app.get("/uploads/:purpose/:userId/:filename", async (c, next) => {
      if (!c.env) {
        (c as unknown as { env: Record<string, unknown> }).env = {};
      }
      // No STORAGE set
      await next();
    }, serveUpload);

    const req = new Request(`http://localhost/uploads/${ownerAvatarKey}`);
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
      await storage.delete(obj.key);
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

    // The DB row surviving is only half the story, and it is the half that is
    // structurally protected (the DELETE is ownership-scoped, so it no-ops).
    // The R2 object is protected ONLY by `deleteObject` sitting after the 403
    // return — a refactor that hoists the cleanup would let any authenticated
    // user permanently destroy any other user's bytes, receive a polite 403,
    // and leave this row pointing at a 404. The owner's positive test asserts
    // the object is gone; this one must assert it is still there.
    const r2Obj = await storage.get(ownedUploadKey);
    expect(r2Obj).toBeTruthy();
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
