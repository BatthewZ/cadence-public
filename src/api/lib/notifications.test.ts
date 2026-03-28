/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for createNotification and createNotifications.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the notification
 * insert logic — including the self-notification guard, batch inserts, and
 * null-coalescing for optional fields — is exercised against actual SQL.
 * These utilities back every notification pathway in the app, so regressions
 * here silently break user-facing notification delivery.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../../db";
import {
  createTestD1,
  seedProject,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";
import { createNotification, createNotifications } from "./notifications";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let taskId: string;

const USER_3 = {
  id: "user-3-id",
  name: "User Three",
  email: "user3@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as const;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
  // seedUser only accepts TEST_USER / TEST_USER_2 types, so seed USER_3 via raw SQL
  await d1
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      USER_3.id,
      USER_3.name,
      USER_3.email,
      USER_3.emailVerified ? 1 : 0,
      USER_3.image,
      Math.floor(USER_3.createdAt.getTime() / 1000),
      Math.floor(USER_3.updatedAt.getTime() / 1000),
    )
    .run();

  // Seed workspace, project, task group, and task so FK-constrained fields are valid
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  const taskGroupId = await seedTaskGroup(d1, projectId);
  taskId = await seedTask(d1, projectId, taskGroupId);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  read: number;
  actorId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  taskId: string | null;
  commentId: string | null;
  invitationId: string | null;
  createdAt: number;
}

async function getNotificationsForUser(userId: string): Promise<NotificationRow[]> {
  const result = await d1
    .prepare("SELECT * FROM notification WHERE userId = ?")
    .bind(userId)
    .all<NotificationRow>();
  return result.results;
}

async function clearNotifications(): Promise<void> {
  await d1.prepare("DELETE FROM notification").run();
}

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

describe("createNotification", () => {
  it("creates a notification record in the database", async () => {
    await clearNotifications();
    const db = createDb(d1);

    await createNotification(db, {
      userId: TEST_USER.id,
      type: "task_assigned",
      title: "You were assigned a task",
      body: "Check out the new task",
      actorId: TEST_USER_2.id,
      workspaceId,
      projectId,
      taskId,
    });

    const rows = await getNotificationsForUser(TEST_USER.id);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.userId).toBe(TEST_USER.id);
    expect(row.type).toBe("task_assigned");
    expect(row.title).toBe("You were assigned a task");
    expect(row.body).toBe("Check out the new task");
    expect(row.actorId).toBe(TEST_USER_2.id);
    expect(row.workspaceId).toBe(workspaceId);
    expect(row.projectId).toBe(projectId);
    expect(row.taskId).toBe(taskId);
  });

  it("skips creating when actorId === userId (self-notification)", async () => {
    await clearNotifications();
    const db = createDb(d1);

    await createNotification(db, {
      userId: TEST_USER.id,
      type: "task_assigned",
      title: "You assigned yourself",
      actorId: TEST_USER.id,
    });

    const rows = await getNotificationsForUser(TEST_USER.id);
    expect(rows).toHaveLength(0);
  });

  it("sets read to false by default", async () => {
    await clearNotifications();
    const db = createDb(d1);

    await createNotification(db, {
      userId: TEST_USER.id,
      type: "task_comment_mention",
      title: "You were mentioned",
      actorId: TEST_USER_2.id,
    });

    const rows = await getNotificationsForUser(TEST_USER.id);
    expect(rows).toHaveLength(1);
    // D1/SQLite stores booleans as 0/1
    expect(rows[0].read).toBe(0);
  });

  it("sets optional fields to null when not provided", async () => {
    await clearNotifications();
    const db = createDb(d1);

    await createNotification(db, {
      userId: TEST_USER.id,
      type: "task_assigned",
      title: "Minimal notification",
    });

    const rows = await getNotificationsForUser(TEST_USER.id);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.body).toBeNull();
    expect(row.actorId).toBeNull();
    expect(row.workspaceId).toBeNull();
    expect(row.projectId).toBeNull();
    expect(row.taskId).toBeNull();
    expect(row.commentId).toBeNull();
    expect(row.invitationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createNotifications
// ---------------------------------------------------------------------------

describe("createNotifications", () => {
  it("creates notifications for all recipients", async () => {
    await clearNotifications();
    const db = createDb(d1);

    // Use USER_3 as the actor so all three recipients are distinct from the actor
    await createNotifications(db, [TEST_USER.id, TEST_USER_2.id], {
      type: "task_completed",
      title: "Task completed",
      actorId: USER_3.id,
    });

    const rows1 = await getNotificationsForUser(TEST_USER.id);
    const rows2 = await getNotificationsForUser(TEST_USER_2.id);

    expect(rows1).toHaveLength(1);
    expect(rows2).toHaveLength(1);

    // All should share the same type and title
    expect(rows1[0].type).toBe("task_completed");
    expect(rows2[0].title).toBe("Task completed");
    expect(rows1[0].actorId).toBe(USER_3.id);
  });

  it("filters out the actor from recipient list", async () => {
    await clearNotifications();
    const db = createDb(d1);

    await createNotifications(db, [TEST_USER.id, TEST_USER_2.id], {
      type: "task_assigned",
      title: "Task assigned",
      actorId: TEST_USER.id,
    });

    // TEST_USER is the actor — should be filtered out
    const rowsActor = await getNotificationsForUser(TEST_USER.id);
    expect(rowsActor).toHaveLength(0);

    // TEST_USER_2 should receive the notification
    const rowsRecipient = await getNotificationsForUser(TEST_USER_2.id);
    expect(rowsRecipient).toHaveLength(1);
    expect(rowsRecipient[0].type).toBe("task_assigned");
  });

  it("handles empty recipient list gracefully", async () => {
    await clearNotifications();
    const db = createDb(d1);

    // Should not throw
    await createNotifications(db, [], {
      type: "task_assigned",
      title: "No recipients",
      actorId: TEST_USER.id,
    });

    // Verify no rows were inserted
    const allRows = await d1.prepare("SELECT COUNT(*) as count FROM notification").first<{ count: number }>();
    expect(allRows!.count).toBe(0);
  });

  it("handles all recipients being the actor", async () => {
    await clearNotifications();
    const db = createDb(d1);

    // Every recipient is the actor — all should be filtered out
    await createNotifications(db, [TEST_USER.id], {
      type: "task_assigned",
      title: "Self-only batch",
      actorId: TEST_USER.id,
    });

    const rows = await getNotificationsForUser(TEST_USER.id);
    expect(rows).toHaveLength(0);
  });
});
