/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for task activity cleanup.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the batched delete
 * logic, time-based retention, and per-task cap policies are exercised against
 * actual SQL. The task_activity table is the fastest-growing table in active
 * projects — regressions here silently break background maintenance.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Database } from "../../db";
import {
  createTestD1,
  seedProject,
  seedTask,
  seedTaskActivity,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../test-utils";
import { cleanupTaskActivity } from "./task-activity-cleanup";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let db: Database;
let taskId: string;
let taskId2: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  const workspaceId = await seedWorkspace(d1, TEST_USER.id);
  const projectId = await seedProject(d1, workspaceId);
  const taskGroupId = await seedTaskGroup(d1, projectId);
  taskId = await seedTask(d1, projectId, taskGroupId);
  taskId2 = await seedTask(d1, projectId, taskGroupId);
});

beforeEach(() => {
  db = createDb(d1);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function countActivities(): Promise<number> {
  const result = await d1
    .prepare("SELECT count(*) as cnt FROM task_activity")
    .first<{ cnt: number }>();
  return result?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupTaskActivity", () => {
  beforeEach(async () => {
    await d1.prepare("DELETE FROM task_activity").run();
  });

  it("deletes activity records older than 90 days", async () => {
    await seedTaskActivity(d1, taskId, TEST_USER.id, {
      createdAt: daysAgo(91),
    });

    const deleted = await cleanupTaskActivity(db);

    expect(deleted).toBe(1);
    expect(await countActivities()).toBe(0);
  });

  it("preserves activity records within 90 days", async () => {
    await seedTaskActivity(d1, taskId, TEST_USER.id, {
      createdAt: daysAgo(89),
    });

    const deleted = await cleanupTaskActivity(db);

    expect(deleted).toBe(0);
    expect(await countActivities()).toBe(1);
  });

  it("enforces per-task cap of 500 records", { timeout: 30_000 }, async () => {
    // Seed 510 recent records for one task
    // Use a fixed base timestamp so second-resolution flooring doesn't create
    // duplicate createdAt values when Date.now() drifts across a second boundary.
    const base = Date.now();
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 510; i++) {
      promises.push(
        seedTaskActivity(d1, taskId, TEST_USER.id, {
          createdAt: new Date(base - i * 1000), // spread across seconds
        }),
      );
    }
    await Promise.all(promises);

    const deleted = await cleanupTaskActivity(db);

    expect(deleted).toBe(10);
    expect(await countActivities()).toBe(500);
  });

  it("only trims overflowing tasks, leaves others alone", { timeout: 30_000 }, async () => {
    // Task 1: 510 records (over cap)
    const base = Date.now();
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 510; i++) {
      promises.push(
        seedTaskActivity(d1, taskId, TEST_USER.id, {
          createdAt: new Date(base - i * 1000),
        }),
      );
    }
    // Task 2: 10 records (under cap)
    for (let i = 0; i < 10; i++) {
      promises.push(
        seedTaskActivity(d1, taskId2, TEST_USER.id, {
          createdAt: new Date(base - i * 1000),
        }),
      );
    }
    await Promise.all(promises);

    const deleted = await cleanupTaskActivity(db);

    expect(deleted).toBe(10);
    expect(await countActivities()).toBe(510); // 500 + 10
  });

  it("handles empty table", async () => {
    const deleted = await cleanupTaskActivity(db);

    expect(deleted).toBe(0);
  });

  it("handles batching with more than 100 old records", { timeout: 15_000 }, async () => {
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 150; i++) {
      promises.push(
        seedTaskActivity(d1, taskId, TEST_USER.id, {
          createdAt: daysAgo(91),
        }),
      );
    }
    await Promise.all(promises);

    const deleted = await cleanupTaskActivity(db);

    expect(deleted).toBe(150);
    expect(await countActivities()).toBe(0);
  });

  it("time-based cleanup reduces count below cap threshold", { timeout: 30_000 }, async () => {
    // 600 total: 200 are >90 days old, 400 are recent
    const base = Date.now();
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 200; i++) {
      promises.push(
        seedTaskActivity(d1, taskId, TEST_USER.id, {
          createdAt: daysAgo(91),
        }),
      );
    }
    for (let i = 0; i < 400; i++) {
      promises.push(
        seedTaskActivity(d1, taskId, TEST_USER.id, {
          createdAt: new Date(base - i * 1000),
        }),
      );
    }
    await Promise.all(promises);

    const deleted = await cleanupTaskActivity(db);

    // Time-based removes 200 old ones; remaining 400 is under 500 cap
    expect(deleted).toBe(200);
    expect(await countActivities()).toBe(400);
  });
});
