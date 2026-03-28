/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for resolveProjectAccess.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the access resolution
 * logic — including the workspace-level elevation rules and project-level
 * membership lookup — is exercised against actual SQL. This is the single
 * source of truth for project authorization, so regressions here silently
 * break every protected project endpoint.
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
import { resolveProjectAccess } from "./access";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;

const OUTSIDER_USER = {
  id: "outsider-user-id",
  name: "Outsider",
  email: "outsider@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

const ADMIN_USER = {
  id: "admin-user-id",
  name: "Admin User",
  email: "admin@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

const MEMBER_USER = {
  id: "member-user-id",
  name: "Member User",
  email: "member@example.com",
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
  for (const u of [OUTSIDER_USER, ADMIN_USER, MEMBER_USER]) {
    await d1
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(u.id, u.name, u.email, u.emailVerified ? 1 : 0, u.image, Math.floor(u.createdAt.getTime() / 1000), Math.floor(u.updatedAt.getTime() / 1000))
      .run();
  }

  // TEST_USER owns the workspace (seedWorkspace auto-creates owner membership)
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);

  // ADMIN_USER is a workspace admin
  await seedWorkspaceMember(d1, workspaceId, ADMIN_USER.id, "admin");

  // MEMBER_USER is a workspace member (not admin/owner) but has no project membership
  await seedWorkspaceMember(d1, workspaceId, MEMBER_USER.id, "member");

  // TEST_USER_2 is a direct project member with "member" role
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
  await seedProjectMember(d1, projectId, TEST_USER_2.id, "member");
});

afterAll(async () => {
  await dispose();
});

describe("resolveProjectAccess", () => {
  it("returns null when project does not exist", async () => {
    const db = createDb(d1);
    const result = await resolveProjectAccess(db, "non-existent-project-id", TEST_USER.id);
    expect(result).toBeNull();
  });

  it('returns { role: "admin", source: "workspace" } for workspace owners', async () => {
    const db = createDb(d1);
    const result = await resolveProjectAccess(db, projectId, TEST_USER.id);
    expect(result).not.toBeNull();
    expect(result!.role).toBe("admin");
    expect(result!.source).toBe("workspace");
    expect(result!.project).toEqual({ id: projectId, workspaceId });
  });

  it('returns { role: "admin", source: "workspace" } for workspace admins', async () => {
    const db = createDb(d1);
    const result = await resolveProjectAccess(db, projectId, ADMIN_USER.id);
    expect(result).not.toBeNull();
    expect(result!.role).toBe("admin");
    expect(result!.source).toBe("workspace");
    expect(result!.project).toEqual({ id: projectId, workspaceId });
  });

  it('returns { role: "member", source: "project" } for direct project members', async () => {
    const db = createDb(d1);
    const result = await resolveProjectAccess(db, projectId, TEST_USER_2.id);
    expect(result).not.toBeNull();
    expect(result!.role).toBe("member");
    expect(result!.source).toBe("project");
    expect(result!.project).toEqual({ id: projectId, workspaceId });
  });

  it('returns { role: "viewer", source: "project" } for project viewers', async () => {
    const db = createDb(d1);

    // Seed a viewer membership for OUTSIDER_USER
    await seedWorkspaceMember(d1, workspaceId, OUTSIDER_USER.id, "member");
    await seedProjectMember(d1, projectId, OUTSIDER_USER.id, "viewer");

    const result = await resolveProjectAccess(db, projectId, OUTSIDER_USER.id);
    expect(result).not.toBeNull();
    expect(result!.role).toBe("viewer");
    expect(result!.source).toBe("project");
    expect(result!.project).toEqual({ id: projectId, workspaceId });
  });

  it("returns null for workspace members with no project membership", async () => {
    const db = createDb(d1);
    // MEMBER_USER is a workspace member but has no project membership
    const result = await resolveProjectAccess(db, projectId, MEMBER_USER.id);
    expect(result).toBeNull();
  });

  it("returns null for users not in the workspace at all", async () => {
    const db = createDb(d1);
    // Use a completely unknown user ID
    const result = await resolveProjectAccess(db, projectId, "totally-unknown-user-id");
    expect(result).toBeNull();
  });
});
