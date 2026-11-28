/// <reference types="@cloudflare/workers-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../db";
import { IDEMPOTENCY_TTL_DAYS } from "../../shared/constants/offline-sync";
import type { AppBindings } from "../env";
import { createTestD1, seedUser, TEST_USER } from "../test-utils";
import { cleanupIdempotencyKeys } from "./idempotency-key-cleanup";
import { handleScheduled } from "./index";

let d1: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ d1, dispose } = await createTestD1());
  await seedUser(d1, TEST_USER);
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await d1.prepare("DELETE FROM idempotency_key").run();
});

function daysAgoSeconds(days: number): number {
  return Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
}

async function seedKey(key: string, ageDays: number, status: number | null = 201): Promise<void> {
  await d1
    .prepare(
      "INSERT INTO idempotency_key (userId, key, method, path, fingerprint, status, responseBody, createdAt) VALUES (?, ?, 'POST', '/api/x', 'f', ?, '{}', ?)"
    )
    .bind(TEST_USER.id, key, status, daysAgoSeconds(ageDays))
    .run();
}

async function remainingKeys(): Promise<string[]> {
  const { results } = await d1
    .prepare("SELECT key FROM idempotency_key ORDER BY key")
    .all<{ key: string }>();
  return results.map((r) => r.key);
}

describe("cleanupIdempotencyKeys", () => {
  it("deletes keys older than the retention window and keeps younger ones", async () => {
    await seedKey("old", IDEMPOTENCY_TTL_DAYS + 1);
    await seedKey("old-pending", IDEMPOTENCY_TTL_DAYS + 1, null);
    await seedKey("young", IDEMPOTENCY_TTL_DAYS - 1);

    const deleted = await cleanupIdempotencyKeys(createDb(d1));

    expect(deleted).toBe(2);
    expect(await remainingKeys()).toEqual(["young"]);
  });

  it("handles an empty table", async () => {
    expect(await cleanupIdempotencyKeys(createDb(d1))).toBe(0);
  });

  it("deletes past a single batch", { timeout: 15_000 }, async () => {
    await Promise.all(
      Array.from({ length: 150 }, (_, i) => seedKey(`k${i}`, IDEMPOTENCY_TTL_DAYS + 2))
    );

    expect(await cleanupIdempotencyKeys(createDb(d1))).toBe(150);
    expect(await remainingKeys()).toEqual([]);
  });

  it("runs from the scheduled handler", async () => {
    await seedKey("old", IDEMPOTENCY_TTL_DAYS + 1);

    const env: AppBindings = {
      DB: d1,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost",
      TOKEN_HASH_PEPPER: "test-pepper",
      ASSETS: {} as Fetcher,
    };
    await handleScheduled(
      { scheduledTime: Date.now(), cron: "*/5 * * * *" } as ScheduledEvent,
      env
    );

    expect(await remainingKeys()).toEqual([]);
  });
});
