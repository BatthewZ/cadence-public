/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for parseMentions.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the mention resolution
 * logic — including the project member JOIN and case-insensitive name matching —
 * is exercised against actual SQL. Mention parsing drives notification delivery,
 * so regressions here cause silent notification failures or spurious pings.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../../db";
import {
  createTestD1,
  seedProject,
  seedProjectMember,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";
import { parseMentions } from "./mentions";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let emptyProjectId: string;

const USER_BEN = {
  id: "user-ben-id",
  name: "Ben M",
  email: "ben@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

const USER_ALICE = {
  id: "user-alice-id",
  name: "Alice Johnson",
  email: "alice@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  // Seed users — seedUser only accepts TEST_USER / TEST_USER_2, so seed
  // custom users via raw SQL to avoid type narrowing issues.
  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
  for (const u of [USER_BEN, USER_ALICE]) {
    await d1
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(u.id, u.name, u.email, u.emailVerified ? 1 : 0, u.image, Math.floor(u.createdAt.getTime() / 1000), Math.floor(u.updatedAt.getTime() / 1000))
      .run();
  }

  // Create workspace and projects
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId, { name: "Mentions Project" });
  emptyProjectId = await seedProject(d1, workspaceId, { name: "Empty Project" });

  // Add workspace members
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
  await seedWorkspaceMember(d1, workspaceId, USER_BEN.id, "member");
  await seedWorkspaceMember(d1, workspaceId, USER_ALICE.id, "member");

  // Add project members to the main project
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  await seedProjectMember(d1, projectId, TEST_USER_2.id, "member");
  await seedProjectMember(d1, projectId, USER_BEN.id, "member");
  await seedProjectMember(d1, projectId, USER_ALICE.id, "member");

  // emptyProjectId deliberately has no members
});

afterAll(async () => {
  await dispose();
});

describe("parseMentions", () => {
  it("returns empty array for text with no mentions", async () => {
    const db = createDb(d1);
    const result = await parseMentions(db, "Just some plain text with no at symbols", projectId);
    expect(result).toEqual([]);
  });

  it("returns empty array when there are no project members", async () => {
    const db = createDb(d1);
    const result = await parseMentions(db, "@Test User please review", emptyProjectId);
    expect(result).toEqual([]);
  });

  it("resolves quoted mentions with exact full-name match", async () => {
    const db = createDb(d1);
    const result = await parseMentions(db, 'Hey @"Test User" can you check this?', projectId);
    expect(result).toEqual([TEST_USER.id]);
  });

  it("resolves multiple quoted mentions", async () => {
    const db = createDb(d1);
    const result = await parseMentions(
      db,
      'Assigning @"Test User" and @"Alice Johnson" to this task',
      projectId,
    );
    expect(result).toContain(TEST_USER.id);
    expect(result).toContain(USER_ALICE.id);
    expect(result).toHaveLength(2);
  });

  it("resolves unquoted mentions against name parts (single word)", async () => {
    const db = createDb(d1);
    // "Alice" matches the first name part of "Alice Johnson"
    const result = await parseMentions(db, "Hey @Alice can you look at this?", projectId);
    expect(result).toEqual([USER_ALICE.id]);
  });

  it("resolves multi-word unquoted mentions when remaining text starts with member name", async () => {
    const db = createDb(d1);
    // "Ben M" is USER_BEN's full name — the remaining text after @ starts with "Ben M"
    const result = await parseMentions(db, "Hey @Ben M please review", projectId);
    expect(result).toContain(USER_BEN.id);
  });

  it("deduplicates resolved user IDs", async () => {
    const db = createDb(d1);
    // Mention the same user twice: once quoted, once unquoted
    const result = await parseMentions(
      db,
      '@"Alice Johnson" and also @Alice',
      projectId,
    );
    expect(result).toEqual([USER_ALICE.id]);
  });

  it("does not resolve mentions for non-members", async () => {
    const db = createDb(d1);
    // "NonExistent Person" is not a project member
    const result = await parseMentions(db, '@"NonExistent Person" please help', projectId);
    expect(result).toEqual([]);
  });

  it("performs case-insensitive matching for quoted mentions", async () => {
    const db = createDb(d1);
    const result = await parseMentions(db, 'Hey @"test user" please review', projectId);
    expect(result).toEqual([TEST_USER.id]);
  });

  it("performs case-insensitive matching for unquoted mentions", async () => {
    const db = createDb(d1);
    const result = await parseMentions(db, "Hey @alice check this", projectId);
    expect(result).toEqual([USER_ALICE.id]);
  });
});
