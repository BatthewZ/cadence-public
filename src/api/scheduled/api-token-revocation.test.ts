/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the scheduled API token revocation sweep.
 *
 * ## Why this matters
 *
 * The rotation flow defers revocation by 7 days so live integrations can swap
 * secrets cleanly. {@link processScheduledTokenRevocations} is the ONLY thing
 * that ever turns that deferred `revokeAt` into an actual `revokedAt` — if
 * this task silently regresses (date arithmetic bug, missed WHERE predicate,
 * batching off-by-one), every rotated token continues authenticating forever.
 * That is a credential-leak primitive, so the tests below pin down the exact
 * boundary conditions instead of trusting the implementation to mean what
 * its name suggests.
 *
 * Coverage:
 * - Past `revokeAt`, null `revokedAt` → revoked, count = 1
 * - Future `revokeAt` → untouched (the grace window must be respected)
 * - Already-revoked rows → untouched (don't move the audit timestamp forward)
 * - Null `revokeAt` (never scheduled) → untouched
 * - Mixed batch → only eligible rows revoked, count is accurate
 * - Telemetry: the cron-handler wrapper emits a `cron_task` event with
 *   the documented `taskName` so analytics dashboards see the task by name
 *
 * Uses real in-memory D1 (Miniflare) so the SQL update + `IS NULL` filter
 * is exercised against actual SQLite, not a mock.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, type Database } from "../../db";
import type { AppBindings } from "../env";
import type { TelemetryEvent, TelemetrySink } from "../lib/telemetry/types";
import {
  createTestD1,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../test-utils";
import { processScheduledTokenRevocations } from "./api-token-revocation";
import { handleScheduled } from "./index";

// ---------------------------------------------------------------------------
// Shared fixtures
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

beforeEach(async () => {
  db = createDb(d1);
  // Each test owns its own token set; truncate so counts are deterministic.
  await d1.prepare("DELETE FROM api_token").run();
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Date (or null) to the Unix-seconds representation Drizzle uses
 * for `integer("col", { mode: "timestamp" })`. Mirrors the seed helpers'
 * convention so we can write raw SQL inserts without worrying about
 * millisecond drift.
 */
function toSec(d: Date | null): number | null {
  return d === null ? null : Math.floor(d.getTime() / 1000);
}

/**
 * Insert an api_token row directly. Bypasses the handler so we can construct
 * exact `revokeAt` / `revokedAt` combinations the rotation handler would
 * never write — which is precisely what the sweep needs to handle correctly.
 */
async function seedApiToken(opts: {
  id?: string;
  revokeAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  const now = toSec(new Date()) ?? 0;
  const hash = `hash-${id}`.padEnd(64, "0").slice(0, 64);
  await d1
    .prepare(
      `INSERT INTO api_token (id, userId, workspaceId, name, tokenHash, tokenPrefix, scopes, projectScope, projectIds, lastUsedAt, expiresAt, revokeAt, revokedAt, rotatedToId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      TEST_USER.id,
      workspaceId,
      "Sweep target",
      hash,
      "cdn_pat_xxxx",
      JSON.stringify(["workspace:read"]),
      "all",
      null,
      null,
      null,
      toSec(opts.revokeAt ?? null),
      toSec(opts.revokedAt ?? null),
      null,
      now,
    )
    .run();
  return id;
}

async function readRevokedAt(id: string): Promise<number | null> {
  const row = await d1
    .prepare("SELECT revokedAt FROM api_token WHERE id = ?")
    .bind(id)
    .first<{ revokedAt: number | null }>();
  return row?.revokedAt ?? null;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processScheduledTokenRevocations", () => {
  it("revokes a token whose revokeAt is in the past and revokedAt is null", async () => {
    const id = await seedApiToken({ revokeAt: daysAgo(1) });

    const count = await processScheduledTokenRevocations(db);

    expect(count).toBe(1);
    const revokedAt = await readRevokedAt(id);
    expect(revokedAt).not.toBeNull();
    // The stamped timestamp should be close to now (within 60s of run start).
    expect(revokedAt).toBeGreaterThan(
      Math.floor(Date.now() / 1000) - 60,
    );
  });

  it("leaves a token whose revokeAt is in the future untouched", async () => {
    const id = await seedApiToken({ revokeAt: daysFromNow(3) });

    const count = await processScheduledTokenRevocations(db);

    expect(count).toBe(0);
    expect(await readRevokedAt(id)).toBeNull();
  });

  it("leaves a token that is already revoked untouched (does not move the audit timestamp)", async () => {
    const originalRevokedAt = daysAgo(2);
    const id = await seedApiToken({
      revokeAt: daysAgo(3),
      revokedAt: originalRevokedAt,
    });

    const count = await processScheduledTokenRevocations(db);

    // Sweep must not count or restamp already-revoked rows.
    expect(count).toBe(0);
    const revokedAt = await readRevokedAt(id);
    expect(revokedAt).toBe(toSec(originalRevokedAt));
  });

  it("leaves a token with no scheduled revocation (revokeAt = null) untouched", async () => {
    const id = await seedApiToken({ revokeAt: null });

    const count = await processScheduledTokenRevocations(db);

    expect(count).toBe(0);
    expect(await readRevokedAt(id)).toBeNull();
  });

  it("returns the count of revoked tokens for a mixed batch", async () => {
    const due1 = await seedApiToken({ revokeAt: daysAgo(1) });
    const due2 = await seedApiToken({ revokeAt: daysAgo(5) });
    const future = await seedApiToken({ revokeAt: daysFromNow(1) });
    // Snapshot the seeded revokedAt so the post-sweep equality check is not
    // races against wall-clock drift between the two `daysAgo(1)` calls.
    const originalAlreadyRevokedAt = daysAgo(1);
    const alreadyRevoked = await seedApiToken({
      revokeAt: originalAlreadyRevokedAt,
      revokedAt: originalAlreadyRevokedAt,
    });
    const never = await seedApiToken({ revokeAt: null });

    const count = await processScheduledTokenRevocations(db);

    expect(count).toBe(2);
    expect(await readRevokedAt(due1)).not.toBeNull();
    expect(await readRevokedAt(due2)).not.toBeNull();
    expect(await readRevokedAt(future)).toBeNull();
    // already-revoked must keep its original timestamp
    expect(await readRevokedAt(alreadyRevoked)).toBe(toSec(originalAlreadyRevokedAt));
    expect(await readRevokedAt(never)).toBeNull();
  });

  it("handles an empty table without throwing", async () => {
    const count = await processScheduledTokenRevocations(db);
    expect(count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Telemetry — verify the cron handler emits a cron_task event for this
  // task with the documented `taskName`. We exercise the full scheduled
  // handler (not just the task fn) so we cover the contract the analytics
  // dashboards consume.
  // -------------------------------------------------------------------------
  it("emits a cron_task telemetry event with taskName='api-token-revocation' when scheduled handler runs", async () => {
    await seedApiToken({ revokeAt: daysAgo(1) });

    const events: TelemetryEvent[] = [];
    const fakeSink: TelemetrySink = {
      track: (event) => {
        events.push(event);
      },
      flush: () => Promise.resolve(),
    };

    // The scheduled handler builds its own sink internally via
    // `createTelemetrySink(env)`. We intercept that module so the test can
    // observe events without standing up the Analytics Engine binding.
    const telemetryModule = await import("../lib/telemetry");
    const spy = vi
      .spyOn(telemetryModule, "createTelemetrySink")
      .mockReturnValue(fakeSink);

    try {
      const env: AppBindings = {
        DB: d1,
        BETTER_AUTH_SECRET: "test-secret",
        BETTER_AUTH_URL: "http://localhost",
        TOKEN_HASH_PEPPER: "test-pepper",
        ASSETS: {} as Fetcher,
      };
      const scheduledEvent: ScheduledEvent = {
        scheduledTime: Date.now(),
        cron: "*/5 * * * *",
        type: "scheduled",
        noRetry: () => {},
      } as ScheduledEvent;

      await handleScheduled(scheduledEvent, env);

      const tokenEvent = events.find(
        (e) => e.type === "cron_task" && e.taskName === "api-token-revocation",
      );
      expect(tokenEvent).toBeDefined();
      if (tokenEvent && tokenEvent.type === "cron_task") {
        expect(tokenEvent.success).toBe(true);
        expect(tokenEvent.count).toBe(1);
        expect(typeof tokenEvent.durationMs).toBe("number");
      }
    } finally {
      spy.mockRestore();
    }
  });
});
