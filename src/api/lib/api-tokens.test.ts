/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the API token (PAT) library.
 *
 * These tests cover the security-critical primitives that back every
 * bearer-token-authenticated request:
 *
 * - `generateApiToken` / `hashToken` — the cryptographic foundation. We
 *   assert format, length, randomness and hash determinism so a regression
 *   that, for example, accidentally re-uses entropy or drifts the hash
 *   algorithm shows up immediately. A bug here invalidates every minted
 *   token after the next deploy.
 * - `verifyToken` — the only path that turns a plaintext token into a
 *   trusted identity. We run it against a real in-memory D1 (via Miniflare)
 *   so the JOIN, revocation check, expiry check and workspace-membership
 *   re-verification are exercised against actual SQL. The "wrong-prefix
 *   short-circuits before the DB" assertion guards a small but real
 *   denial-of-service surface (garbage Authorization headers must not
 *   cost us a SHA-256 + query).
 * - `hasScope` / `canAccessProject` — authorization helpers. The aggregate
 *   `read:*` / `write:*` cases and the deliberate `project:delete`
 *   exclusion from `write:*` are the load-bearing behaviour: a wrong
 *   answer here is a privilege escalation. We also pin down the
 *   fail-closed behaviour for corrupted JSON columns so a bad row never
 *   silently over-grants.
 * - `bumpLastUsedAt` — must never throw, because it runs after the
 *   response is sent and an uncaught rejection here would surface as an
 *   unhandled-promise alert during normal happy-path traffic.
 */

import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDb } from "../../db";
import { type ApiToken,apiToken } from "../../db/schema";
import type { AppEnv } from "../env";
import {
  createTestD1,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_TOKEN_HASH_PEPPER,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";
import {
  bumpLastUsedAt,
  canAccessProject,
  generateApiToken,
  hashToken,
  hasScope,
  KNOWN_SCOPES,
  newApiTokenId,
  parseProjectIds,
  parseScopes,
  TOKEN_PREFIX,
  verifyToken,
} from "./api-tokens";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal `ApiToken` row in memory for the pure-function tests
 * (hasScope, canAccessProject, etc.). These never touch the DB; the helper
 * just spares us repeating the full column list.
 */
function makeToken(overrides: Partial<ApiToken> = {}): ApiToken {
  const base: ApiToken = {
    id: "tok-test",
    userId: TEST_USER.id,
    workspaceId: "ws-test",
    name: "test",
    tokenHash: "deadbeef",
    tokenPrefix: "cdn_pat_abcd",
    scopes: JSON.stringify([]),
    projectScope: "all",
    projectIds: null,
    lastUsedAt: null,
    expiresAt: null,
    revokeAt: null,
    revokedAt: null,
    rotatedToId: null,
    createdAt: new Date(),
  };
  return { ...base, ...overrides };
}

/**
 * Insert a token directly into D1 for the `verifyToken` tests.
 * Returns the inserted row so callers can assert on its shape.
 */
async function insertToken(opts: {
  id?: string;
  userId?: string;
  workspaceId?: string;
  hash: string;
  prefix: string;
  scopes?: string[];
  projectScope?: "all" | "selected";
  projectIds?: string[] | null;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  revokeAt?: Date | null;
}) {
  const db = createDb(d1);
  const id = opts.id ?? newApiTokenId();
  await db.insert(apiToken).values({
    id,
    userId: opts.userId ?? TEST_USER.id,
    workspaceId: opts.workspaceId ?? workspaceId,
    name: "Test Token",
    tokenHash: opts.hash,
    tokenPrefix: opts.prefix,
    scopes: JSON.stringify(opts.scopes ?? ["task:read"]),
    projectScope: opts.projectScope ?? "all",
    projectIds:
      opts.projectIds === undefined
        ? null
        : opts.projectIds === null
          ? null
          : JSON.stringify(opts.projectIds),
    expiresAt: opts.expiresAt ?? null,
    revokedAt: opts.revokedAt ?? null,
    revokeAt: opts.revokeAt ?? null,
    createdAt: new Date(),
  });
  return id;
}

// ---------------------------------------------------------------------------
// Format / generation
// ---------------------------------------------------------------------------

describe("generateApiToken", () => {
  it("returns a plaintext that starts with the cdn_pat_ prefix", async () => {
    const { plaintext } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    expect(plaintext.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  it("encodes 32 random bytes as base64url (43 chars) plus the 8-char prefix", async () => {
    const { plaintext } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    // 32 bytes → ceil(32 * 8 / 6) = 43 base64url characters (no padding).
    expect(plaintext.length).toBe(TOKEN_PREFIX.length + 43);
  });

  it("uses only base64url-safe characters after the prefix", async () => {
    const { plaintext } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    const body = plaintext.slice(TOKEN_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a different plaintext on every call (entropy sanity check)", async () => {
    const a = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    const b = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it("derives the 12-char display prefix from the plaintext", async () => {
    const { plaintext, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    expect(prefix.length).toBe(12);
    expect(prefix).toBe(plaintext.slice(0, 12));
    expect(prefix.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  it("returns a hash that matches hashToken(plaintext, pepper)", async () => {
    const { plaintext, hash } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    const recomputed = await hashToken(plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(hash).toBe(recomputed);
  });
});

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

describe("hashToken", () => {
  it("is deterministic for the same input + pepper", async () => {
    const a = await hashToken("cdn_pat_deterministic", TEST_TOKEN_HASH_PEPPER);
    const b = await hashToken("cdn_pat_deterministic", TEST_TOKEN_HASH_PEPPER);
    expect(a).toBe(b);
  });

  it("returns a 64-character lowercase hex string (HMAC-SHA256)", async () => {
    const h = await hashToken("cdn_pat_anything", TEST_TOKEN_HASH_PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different output for different input", async () => {
    const a = await hashToken("cdn_pat_a", TEST_TOKEN_HASH_PEPPER);
    const b = await hashToken("cdn_pat_b", TEST_TOKEN_HASH_PEPPER);
    expect(a).not.toBe(b);
  });

  it("produces different output for the same plaintext under a different pepper", async () => {
    // Critical: this is what makes the pepper a meaningful defense against
    // database-only exfiltration. Two deployments using different peppers
    // hashing the same plaintext MUST land on different stored values, so
    // an attacker who steals one DB cannot probe the other.
    const a = await hashToken("cdn_pat_same", "pepper-one");
    const b = await hashToken("cdn_pat_same", "pepper-two");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// newApiTokenId
// ---------------------------------------------------------------------------

describe("newApiTokenId", () => {
  it("returns a unique string on each call", () => {
    const a = newApiTokenId();
    const b = newApiTokenId();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// KNOWN_SCOPES
// ---------------------------------------------------------------------------

describe("KNOWN_SCOPES", () => {
  it("contains the documented scope strings", () => {
    expect(KNOWN_SCOPES.has("task:write")).toBe(true);
    expect(KNOWN_SCOPES.has("project:delete")).toBe(true);
    expect(KNOWN_SCOPES.has("read:*")).toBe(true);
    expect(KNOWN_SCOPES.has("write:*")).toBe(true);
  });

  it("does not contain unknown scopes", () => {
    expect(KNOWN_SCOPES.has("admin")).toBe(false);
    expect(KNOWN_SCOPES.has("workspace:delete")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseScopes / parseProjectIds
// ---------------------------------------------------------------------------

describe("parseScopes", () => {
  it("returns the parsed array for valid JSON", () => {
    expect(parseScopes(JSON.stringify(["task:read", "task:write"]))).toEqual([
      "task:read",
      "task:write",
    ]);
  });

  it("returns [] for an empty array", () => {
    expect(parseScopes("[]")).toEqual([]);
  });

  it("returns [] for corrupt JSON without throwing", () => {
    expect(parseScopes("not json")).toEqual([]);
  });

  it("returns [] when JSON is not an array", () => {
    expect(parseScopes("\"task:read\"")).toEqual([]);
    expect(parseScopes("{}")).toEqual([]);
  });

  it("filters non-string entries", () => {
    expect(parseScopes("[\"task:read\", 42, null]")).toEqual(["task:read"]);
  });
});

describe("parseProjectIds", () => {
  it("returns [] for null", () => {
    expect(parseProjectIds(null)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseProjectIds("")).toEqual([]);
  });

  it("parses an array of strings", () => {
    expect(parseProjectIds(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("returns [] for corrupt JSON", () => {
    expect(parseProjectIds("xyz")).toEqual([]);
  });

  it("returns [] when JSON is not an array", () => {
    expect(parseProjectIds("{}")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasScope
// ---------------------------------------------------------------------------

describe("hasScope", () => {
  it("matches an exact scope grant", () => {
    const t = makeToken({ scopes: JSON.stringify(["task:write"]) });
    expect(hasScope(t, "task:write")).toBe(true);
  });

  it("returns false when the scope is missing", () => {
    const t = makeToken({ scopes: JSON.stringify(["task:read"]) });
    expect(hasScope(t, "task:write")).toBe(false);
  });

  it("grants read:* for any *:read scope", () => {
    const t = makeToken({ scopes: JSON.stringify(["read:*"]) });
    expect(hasScope(t, "task:read")).toBe(true);
    expect(hasScope(t, "workspace:read")).toBe(true);
    expect(hasScope(t, "project:read")).toBe(true);
    expect(hasScope(t, "webhook:read")).toBe(true);
  });

  it("does not grant write actions through read:*", () => {
    const t = makeToken({ scopes: JSON.stringify(["read:*"]) });
    expect(hasScope(t, "task:write")).toBe(false);
    expect(hasScope(t, "project:write")).toBe(false);
  });

  it("grants write:* for any *:write scope", () => {
    const t = makeToken({ scopes: JSON.stringify(["write:*"]) });
    expect(hasScope(t, "task:write")).toBe(true);
    expect(hasScope(t, "project:write")).toBe(true);
    expect(hasScope(t, "label:write")).toBe(true);
    expect(hasScope(t, "webhook:write")).toBe(true);
  });

  it("does not grant project:delete through write:*", () => {
    // Critical: delete is a heightened action that must be granted explicitly.
    const t = makeToken({ scopes: JSON.stringify(["write:*"]) });
    expect(hasScope(t, "project:delete")).toBe(false);
    expect(hasScope(t, "task:delete")).toBe(false);
  });

  it("does not grant read actions through write:*", () => {
    const t = makeToken({ scopes: JSON.stringify(["write:*"]) });
    expect(hasScope(t, "task:read")).toBe(false);
  });

  it("returns false (no throw) when scopes JSON is corrupt", () => {
    const t = makeToken({ scopes: "{not json" });
    expect(hasScope(t, "task:read")).toBe(false);
  });

  it("returns false for scope strings without the resource:action grammar when not directly granted", () => {
    const t = makeToken({ scopes: JSON.stringify(["read:*"]) });
    expect(hasScope(t, "admin")).toBe(false);
  });

  it("still grants directly-listed unknown scopes (forward compatibility)", () => {
    const t = makeToken({ scopes: JSON.stringify(["future:thing"]) });
    expect(hasScope(t, "future:thing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canAccessProject
// ---------------------------------------------------------------------------

describe("canAccessProject", () => {
  it("returns true for projectScope=all regardless of projectId", () => {
    const t = makeToken({ projectScope: "all", projectIds: null });
    expect(canAccessProject(t, "anything")).toBe(true);
    expect(canAccessProject(t, "another")).toBe(true);
  });

  it("returns true for selected scope when projectId is in the list", () => {
    const t = makeToken({
      projectScope: "selected",
      projectIds: JSON.stringify(["proj-1", "proj-2"]),
    });
    expect(canAccessProject(t, "proj-1")).toBe(true);
    expect(canAccessProject(t, "proj-2")).toBe(true);
  });

  it("returns false for selected scope when projectId is NOT in the list", () => {
    const t = makeToken({
      projectScope: "selected",
      projectIds: JSON.stringify(["proj-1"]),
    });
    expect(canAccessProject(t, "proj-2")).toBe(false);
  });

  it("returns false for selected scope with null projectIds (defensive)", () => {
    const t = makeToken({ projectScope: "selected", projectIds: null });
    expect(canAccessProject(t, "any")).toBe(false);
  });

  it("returns false for selected scope with corrupt projectIds JSON", () => {
    const t = makeToken({
      projectScope: "selected",
      projectIds: "not json",
    });
    expect(canAccessProject(t, "proj-1")).toBe(false);
  });

  it("returns false for an unknown projectScope value (defensive)", () => {
    const t = makeToken({
      projectScope: "wild" as ApiToken["projectScope"],
      projectIds: null,
    });
    expect(canAccessProject(t, "any")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyToken (real D1)
// ---------------------------------------------------------------------------

describe("verifyToken", () => {
  it("returns user/token/membership for a valid, active token", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({ hash, prefix });

    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);

    expect(result).not.toBeNull();
    expect(result?.user.id).toBe(TEST_USER.id);
    expect(result?.user.email).toBe(TEST_USER.email);
    expect(result?.token.tokenHash).toBe(hash);
    expect(result?.workspaceMembership.workspaceId).toBe(workspaceId);
    expect(result?.workspaceMembership.role).toBe("owner");
  });

  it("returns null and skips DB lookup when prefix is wrong", async () => {
    const db = createDb(d1);
    // Spy on db.select to ensure no DB call is made.
    const selectSpy = vi.spyOn(db, "select");

    const result = await verifyToken(db, "ghp_not_our_token_at_all", TEST_TOKEN_HASH_PEPPER);

    expect(result).toBeNull();
    expect(selectSpy).not.toHaveBeenCalled();
    selectSpy.mockRestore();
  });

  it("returns null when the hash is not in the DB", async () => {
    const { plaintext } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    // Do NOT insert.
    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(result).toBeNull();
  });

  it("returns null when the token is revoked", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({
      hash,
      prefix,
      revokedAt: new Date(Date.now() - 1000),
    });

    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(result).toBeNull();
  });

  it("returns null when the token has expired", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({
      hash,
      prefix,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(result).toBeNull();
  });

  it("returns the token when expiresAt is in the future", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({
      hash,
      prefix,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(result).not.toBeNull();
  });

  it("returns the token when expiresAt is null (never expires)", async () => {
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({ hash, prefix, expiresAt: null });

    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(result).not.toBeNull();
  });

  it("returns null when the owning user is no longer a workspace member", async () => {
    // Use TEST_USER_2 with no workspace_member row in this workspace.
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({
      hash,
      prefix,
      userId: TEST_USER_2.id,
      workspaceId,
    });

    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(result).toBeNull();
  });

  it("returns the token when the owning user becomes a member again", async () => {
    // Add membership for TEST_USER_2 and confirm a new token works.
    await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
    const { plaintext, hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    await insertToken({
      hash,
      prefix,
      userId: TEST_USER_2.id,
      workspaceId,
    });

    const db = createDb(d1);
    const result = await verifyToken(db, plaintext, TEST_TOKEN_HASH_PEPPER);
    expect(result).not.toBeNull();
    expect(result?.workspaceMembership.role).toBe("member");
  });
});

// ---------------------------------------------------------------------------
// bumpLastUsedAt
// ---------------------------------------------------------------------------

describe("bumpLastUsedAt", () => {
  it("updates lastUsedAt on the token row", async () => {
    const { hash, prefix } = await generateApiToken(TEST_TOKEN_HASH_PEPPER);
    const tokenId = await insertToken({ hash, prefix });

    const db = createDb(d1);
    const c = {
      get: (key: string) => (key === "db" ? db : undefined),
      get executionCtx() {
        // Force the test-environment branch in deferWork that runs inline.
        throw new Error("no execution context");
      },
    } as unknown as Context<AppEnv>;

    bumpLastUsedAt(c, tokenId);

    // Yield to let the inline promise settle.
    await new Promise((r) => setTimeout(r, 10));

    const [row] = await db
      .select()
      .from(apiToken)
      .where(eq(apiToken.id, tokenId));
    expect(row.lastUsedAt).not.toBeNull();
    expect(row.lastUsedAt instanceof Date).toBe(true);
  });

  it("does not throw when the DB query fails", async () => {
    // Build a Context whose db.update throws — bumpLastUsedAt must swallow it.
    const fakeDb = {
      update: () => {
        throw new Error("boom");
      },
    };
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const c = {
      get: (key: string) => (key === "db" ? fakeDb : undefined),
      get executionCtx() {
        throw new Error("no execution context");
      },
    } as unknown as Context<AppEnv>;

    // Must not throw synchronously.
    expect(() => bumpLastUsedAt(c, "tok-nonexistent")).not.toThrow();

    // Yield for the inline promise chain inside deferWork to complete.
    await new Promise((r) => setTimeout(r, 10));

    // Was logged once (either via the lib's inner try/catch or deferWork's
    // outer catch — either path is acceptable; the contract is "no unhandled
    // rejection escapes").
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

