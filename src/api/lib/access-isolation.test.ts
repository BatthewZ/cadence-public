/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for cross-workspace authorization isolation.
 *
 * Verifies that workspace boundaries are enforced correctly: users from one
 * workspace must never gain access to projects or tasks in another workspace.
 * Also validates role boundary integrity — a viewer must not be elevated to
 * member/admin, and workspace membership alone (without project membership)
 * must not grant project access.
 *
 * These tests exercise the actual SQL queries in resolveProjectAccess and
 * resolveTaskAccess against a real in-memory D1 database. A regression here
 * would mean a cross-workspace data leak, which is a critical security issue.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../../db";
import {
  createTestD1,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";
import { resolveProjectAccess, resolveTaskAccess } from "./access";

// ---------------------------------------------------------------------------
// Additional test users (beyond TEST_USER / TEST_USER_2)
// ---------------------------------------------------------------------------

const USER_C = {
  id: "test-user-c",
  name: "User C",
  email: "c@test.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

const USER_D = {
  id: "test-user-d",
  name: "User D",
  email: "d@test.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

const USER_E = {
  id: "test-user-e",
  name: "User E",
  email: "e@test.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let db: ReturnType<typeof createDb>;

// Workspace 1 (owned by TEST_USER)
let ws1Id: string;
let proj1Id: string;
let task1Id: string;

// Workspace 2 (owned by TEST_USER_2)
let ws2Id: string;
let proj2Id: string;

beforeAll(async () => {
  ({ d1, dispose } = await createTestD1());
  db = createDb(d1);

  // Seed the two pre-defined test users
  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);

  // Seed custom users via raw SQL (seedUser only accepts TEST_USER / TEST_USER_2)
  for (const u of [USER_C, USER_D, USER_E]) {
    await d1
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        u.id,
        u.name,
        u.email,
        u.emailVerified ? 1 : 0,
        u.image,
        Math.floor(u.createdAt.getTime() / 1000),
        Math.floor(u.updatedAt.getTime() / 1000),
      )
      .run();
  }

  // --- Workspace 1 setup (owned by TEST_USER) ---
  ws1Id = await seedWorkspace(d1, TEST_USER.id, { name: "Workspace 1" });
  proj1Id = await seedProject(d1, ws1Id, { name: "Project in WS1" });
  await seedProjectMember(d1, proj1Id, TEST_USER.id, "admin");

  const tg1Id = await seedTaskGroup(d1, proj1Id);
  task1Id = await seedTask(d1, proj1Id, tg1Id, { title: "Task in WS1" });

  // --- Workspace 2 setup (owned by TEST_USER_2) ---
  ws2Id = await seedWorkspace(d1, TEST_USER_2.id, { name: "Workspace 2" });
  proj2Id = await seedProject(d1, ws2Id, { name: "Project in WS2" });
  await seedProjectMember(d1, proj2Id, TEST_USER_2.id, "admin");

  // --- Role-specific memberships ---

  // User C: viewer on proj1 (workspace 1 member)
  await seedWorkspaceMember(d1, ws1Id, USER_C.id, "member");
  await seedProjectMember(d1, proj1Id, USER_C.id, "viewer");

  // User D: workspace 1 admin (no project membership)
  await seedWorkspaceMember(d1, ws1Id, USER_D.id, "admin");

  // User E: workspace 1 member (no project membership)
  await seedWorkspaceMember(d1, ws1Id, USER_E.id, "member");
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-workspace authorization isolation", () => {
  describe("cross-workspace project access", () => {
    it("denies User B access to a project in workspace 1", async () => {
      // TEST_USER_2 owns workspace 2 but has no membership in workspace 1
      const result = await resolveProjectAccess(db, proj1Id, TEST_USER_2.id);
      expect(result).toBeNull();
    });

    it("denies User A access to a project in workspace 2", async () => {
      // TEST_USER owns workspace 1 but has no membership in workspace 2
      const result = await resolveProjectAccess(db, proj2Id, TEST_USER.id);
      expect(result).toBeNull();
    });
  });

  describe("cross-workspace task access", () => {
    it("returns found with null access when User B tries to access a task in workspace 1", async () => {
      // TEST_USER_2 has no access to workspace 1's project, but the task exists
      const result = await resolveTaskAccess(db, task1Id, TEST_USER_2.id);
      expect(result).toEqual({ found: true, access: null });
    });

    it("returns not found for a non-existent task", async () => {
      const result = await resolveTaskAccess(db, "non-existent-task-id", TEST_USER.id);
      expect(result).toEqual({ found: false });
    });
  });

  describe("role boundary - viewer cannot get member-level access", () => {
    it("returns viewer role for a user added as viewer, not member or admin", async () => {
      const result = await resolveProjectAccess(db, proj1Id, USER_C.id);
      expect(result).not.toBeNull();
      expect(result!.role).toBe("viewer");
      expect(result!.source).toBe("project");
      // Explicitly verify the role is NOT elevated
      expect(result!.role).not.toBe("member");
      expect(result!.role).not.toBe("admin");
    });
  });

  describe("workspace admin elevation", () => {
    it("grants admin access with workspace source for workspace admins without project membership", async () => {
      // User D is a workspace admin but has no project_member row
      const result = await resolveProjectAccess(db, proj1Id, USER_D.id);
      expect(result).not.toBeNull();
      expect(result!.role).toBe("admin");
      expect(result!.source).toBe("workspace");
      expect(result!.project).toEqual({ id: proj1Id, workspaceId: ws1Id });
    });
  });

  describe("workspace member without project access", () => {
    it("returns null for a workspace member who has no project membership", async () => {
      // User E is a workspace member but has no project_member row
      const result = await resolveProjectAccess(db, proj1Id, USER_E.id);
      expect(result).toBeNull();
    });
  });
});
