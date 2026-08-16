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

/** Collaborator used exclusively by the orphaned-membership test below. */
const USER_F = {
  id: "test-user-f",
  name: "User F",
  email: "f@test.com",
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

  // The four extra collaborators. `seedUser` accepts any `TestUserFixture`, so
  // these need no hand-rolled INSERT — the two exported fixtures are a
  // convenience, not a limit on who a test may seed.
  for (const u of [USER_C, USER_D, USER_E, USER_F]) {
    await seedUser(d1, u);
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

  /**
   * Workspace membership is the outer boundary; a project role narrows it,
   * it never survives it. A `project_member` row with no matching
   * `workspace_member` row is the state that made offboarding cosmetic —
   * the user vanished from the workspace while keeping read, write and CSV
   * export on every project they were on.
   *
   * `removeMember` now deletes those rows, but this test guards the *class*
   * rather than that one handler. No current write path creates an orphan
   * (see the note on `resolveProjectAccess`), so what this pins is rows
   * predating the offboarding fix, plus the fact that `duplicateProject`
   * propagates any orphan it finds into the copied project. Either way the
   * row must confer nothing here — this resolver is the row-level choke
   * point every protected project and task endpoint funnels through.
   */
  describe("orphaned project membership (workspace membership revoked)", () => {
    it("stops granting project and task access once the workspace_member row is gone", async () => {
      // Set User F up as an ordinary collaborator: in the workspace, on the project.
      await seedWorkspaceMember(d1, ws1Id, USER_F.id, "member");
      await seedProjectMember(d1, proj1Id, USER_F.id, "member");

      // Baseline — the access they are supposed to have while they are a member.
      // Without this the test could pass for the wrong reason (e.g. a typo'd id).
      const projectBefore = await resolveProjectAccess(db, proj1Id, USER_F.id);
      expect(projectBefore).not.toBeNull();
      expect(projectBefore!.source).toBe("project");
      expect(projectBefore!.role).toBe("member");
      const taskBefore = await resolveTaskAccess(db, task1Id, USER_F.id);
      expect(taskBefore).toEqual({
        found: true,
        access: {
          role: "member",
          source: "project",
          project: { id: proj1Id, workspaceId: ws1Id },
        },
      });

      // Revoke ONLY the workspace membership, leaving the project_member row
      // behind — precisely the residue the unfixed removeMember left.
      await d1
        .prepare("DELETE FROM workspace_member WHERE workspaceId = ? AND userId = ?")
        .bind(ws1Id, USER_F.id)
        .run();
      const orphan = await d1
        .prepare("SELECT * FROM project_member WHERE projectId = ? AND userId = ?")
        .bind(proj1Id, USER_F.id)
        .first();
      expect(orphan).not.toBeNull(); // the stale row really is still there

      expect(await resolveProjectAccess(db, proj1Id, USER_F.id)).toBeNull();
      expect(await resolveTaskAccess(db, task1Id, USER_F.id)).toEqual({
        found: true,
        access: null,
      });
    });
  });
});
