/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for notification cleanup.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the batched delete
 * logic, read/unread retention policies, and error isolation are exercised
 * against actual SQL. Without cleanup, the notification table grows
 * unboundedly — regressions here silently break background maintenance.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Database } from "../../db";
import {
  createTestD1,
  seedNotification,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../test-utils";
import { cleanupNotifications } from "./notification-cleanup";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let db: Database;
let workspaceId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
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

async function countNotifications(): Promise<number> {
  const result = await d1
    .prepare("SELECT count(*) as cnt FROM notification")
    .first<{ cnt: number }>();
  return result?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupNotifications", () => {
  beforeEach(async () => {
    await d1.prepare("DELETE FROM notification").run();
  });

  it("deletes read notifications older than 30 days", async () => {
    await seedNotification(d1, TEST_USER.id, {
      read: true,
      createdAt: daysAgo(31),
      workspaceId,
    });

    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(1);
    expect(await countNotifications()).toBe(0);
  });

  it("preserves read notifications within 30 days", async () => {
    await seedNotification(d1, TEST_USER.id, {
      read: true,
      createdAt: daysAgo(29),
      workspaceId,
    });

    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(0);
    expect(await countNotifications()).toBe(1);
  });

  it("deletes unread notifications older than 90 days", async () => {
    await seedNotification(d1, TEST_USER.id, {
      read: false,
      createdAt: daysAgo(91),
      workspaceId,
    });

    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(1);
    expect(await countNotifications()).toBe(0);
  });

  it("preserves unread notifications within 90 days", async () => {
    await seedNotification(d1, TEST_USER.id, {
      read: false,
      createdAt: daysAgo(89),
      workspaceId,
    });

    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(0);
    expect(await countNotifications()).toBe(1);
  });

  it("preserves unread notifications between 30 and 90 days", async () => {
    // Unread at 60 days should survive even though read ones at 60 days would not
    await seedNotification(d1, TEST_USER.id, {
      read: false,
      createdAt: daysAgo(60),
      workspaceId,
    });

    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(0);
    expect(await countNotifications()).toBe(1);
  });

  it("deletes read notifications at 60 days but not unread ones", async () => {
    await seedNotification(d1, TEST_USER.id, {
      read: true,
      createdAt: daysAgo(60),
      workspaceId,
    });
    await seedNotification(d1, TEST_USER.id, {
      read: false,
      createdAt: daysAgo(60),
      workspaceId,
    });

    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(1);
    expect(await countNotifications()).toBe(1);
  });

  it("handles empty table", async () => {
    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(0);
  });

  it("handles batching with more than 100 old read notifications", { timeout: 15_000 }, async () => {
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 150; i++) {
      promises.push(
        seedNotification(d1, TEST_USER.id, {
          read: true,
          createdAt: daysAgo(31),
          workspaceId,
        }),
      );
    }
    await Promise.all(promises);

    const deleted = await cleanupNotifications(db);

    expect(deleted).toBe(150);
    expect(await countNotifications()).toBe(0);
  });
});
