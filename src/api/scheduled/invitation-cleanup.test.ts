/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for invitation cleanup.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the batched delete
 * logic, status-based policies, and grace period are exercised against actual
 * SQL. Without cleanup, expired invitations accumulate indefinitely —
 * regressions here silently break background maintenance.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Database } from "../../db";
import {
  createTestD1,
  seedInvitation,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../test-utils";
import { cleanupInvitations } from "./invitation-cleanup";

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

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function countInvitations(): Promise<number> {
  const result = await d1
    .prepare("SELECT count(*) as cnt FROM invitation")
    .first<{ cnt: number }>();
  return result?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupInvitations", () => {
  beforeEach(async () => {
    await d1.prepare("DELETE FROM invitation").run();
  });

  it("deletes accepted invitations past expiresAt", async () => {
    await seedInvitation(d1, workspaceId, {
      status: "accepted",
      expiresAt: daysAgo(1),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(1);
    expect(await countInvitations()).toBe(0);
  });

  it("deletes expired-status invitations past expiresAt", async () => {
    await seedInvitation(d1, workspaceId, {
      status: "expired",
      expiresAt: daysAgo(1),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(1);
    expect(await countInvitations()).toBe(0);
  });

  it("deletes revoked invitations past expiresAt", async () => {
    await seedInvitation(d1, workspaceId, {
      status: "revoked",
      expiresAt: daysAgo(1),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(1);
    expect(await countInvitations()).toBe(0);
  });

  it("preserves non-pending invitations that have not expired yet", async () => {
    await seedInvitation(d1, workspaceId, {
      status: "accepted",
      expiresAt: daysFromNow(1),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(0);
    expect(await countInvitations()).toBe(1);
  });

  it("deletes pending invitations expired more than 7 days ago", async () => {
    await seedInvitation(d1, workspaceId, {
      status: "pending",
      expiresAt: daysAgo(8),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(1);
    expect(await countInvitations()).toBe(0);
  });

  it("preserves pending invitations expired less than 7 days ago", async () => {
    await seedInvitation(d1, workspaceId, {
      status: "pending",
      expiresAt: daysAgo(3),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(0);
    expect(await countInvitations()).toBe(1);
  });

  it("preserves pending invitations not yet expired", async () => {
    await seedInvitation(d1, workspaceId, {
      status: "pending",
      expiresAt: daysFromNow(5),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(0);
    expect(await countInvitations()).toBe(1);
  });

  it("handles empty table", async () => {
    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(0);
  });

  it("handles batching with more than 100 expired accepted invitations", { timeout: 15_000 }, async () => {
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 150; i++) {
      promises.push(
        seedInvitation(d1, workspaceId, {
          status: "accepted",
          expiresAt: daysAgo(1),
        }),
      );
    }
    await Promise.all(promises);

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(150);
    expect(await countInvitations()).toBe(0);
  });

  it("cleans up mixed statuses correctly in a single run", async () => {
    // Should be deleted: accepted+expired, expired+expired, pending+expired>7d
    await seedInvitation(d1, workspaceId, {
      status: "accepted",
      expiresAt: daysAgo(2),
    });
    await seedInvitation(d1, workspaceId, {
      status: "expired",
      expiresAt: daysAgo(2),
    });
    await seedInvitation(d1, workspaceId, {
      status: "pending",
      expiresAt: daysAgo(10),
    });

    // Should survive: pending+expired<7d, pending+not-expired
    await seedInvitation(d1, workspaceId, {
      status: "pending",
      expiresAt: daysAgo(3),
    });
    await seedInvitation(d1, workspaceId, {
      status: "pending",
      expiresAt: daysFromNow(5),
    });

    const deleted = await cleanupInvitations(db);

    expect(deleted).toBe(3);
    expect(await countInvitations()).toBe(2);
  });
});
