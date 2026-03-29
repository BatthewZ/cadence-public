/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for password reset cooldown.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the cooldown query
 * logic — including the LIKE pattern match, timestamp comparisons, and
 * buffer window — is exercised against actual SQL. This guard is the only
 * distributed defense against reset-email spam (in-memory rate limiting is
 * per-isolate), so regressions here directly expose Resend credit burn.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../../db";
import { createTestD1, seedUser, TEST_USER, TEST_USER_2 } from "../test-utils";
import { isResetCooldownActive } from "./password-reset-cooldown";

let d1: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
});

afterAll(async () => {
  await dispose();
});

function toSec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

async function insertVerification(
  opts: {
    identifier: string;
    value: string;
    createdAt: Date;
    expiresAt: Date;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date();
  await d1
    .prepare(
      "INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      opts.identifier,
      opts.value,
      toSec(opts.expiresAt),
      toSec(opts.createdAt),
      toSec(now),
    )
    .run();
  return id;
}

describe("isResetCooldownActive", () => {
  it("returns false when no reset tokens exist for the user", async () => {
    const db = createDb(d1);
    const result = await isResetCooldownActive(db, TEST_USER.id);
    expect(result).toBe(false);
  });

  it("returns false when the only token was created just now (within buffer)", async () => {
    const db = createDb(d1);
    const now = new Date();
    await insertVerification({
      identifier: `reset-password:token-just-created`,
      value: TEST_USER.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
    });

    // With default 5s buffer, a token created "now" should be excluded
    const result = await isResetCooldownActive(db, TEST_USER.id);
    expect(result).toBe(false);
  });

  it("returns true when a token was created 2 minutes ago (within cooldown)", async () => {
    const db = createDb(d1);
    const twoMinAgo = new Date(Date.now() - 120_000);
    await insertVerification({
      identifier: `reset-password:token-2min-ago`,
      value: TEST_USER.id,
      createdAt: twoMinAgo,
      expiresAt: new Date(twoMinAgo.getTime() + 3600_000),
    });

    const result = await isResetCooldownActive(db, TEST_USER.id);
    expect(result).toBe(true);
  });

  it("returns false when the most recent token was created 6 minutes ago (outside cooldown)", async () => {
    const db = createDb(d1);
    // Use a different user so prior test tokens don't interfere
    const sixMinAgo = new Date(Date.now() - 360_000);
    await insertVerification({
      identifier: `reset-password:token-6min-ago`,
      value: TEST_USER_2.id,
      createdAt: sixMinAgo,
      expiresAt: new Date(sixMinAgo.getTime() + 3600_000),
    });

    const result = await isResetCooldownActive(db, TEST_USER_2.id);
    expect(result).toBe(false);
  });

  it("returns false when tokens exist for a different user", async () => {
    const db = createDb(d1);
    const otherUserId = "other-user-id";
    const twoMinAgo = new Date(Date.now() - 120_000);
    await insertVerification({
      identifier: `reset-password:token-other-user`,
      value: otherUserId,
      createdAt: twoMinAgo,
      expiresAt: new Date(twoMinAgo.getTime() + 3600_000),
    });

    // Should not affect TEST_USER_2's cooldown
    const result = await isResetCooldownActive(db, TEST_USER_2.id);
    expect(result).toBe(false);
  });

  it("returns false when tokens have a non-reset-password identifier", async () => {
    const db = createDb(d1);
    const uniqueUser = "user-non-reset-test";
    const twoMinAgo = new Date(Date.now() - 120_000);
    await insertVerification({
      identifier: `email-verification:some-token`,
      value: uniqueUser,
      createdAt: twoMinAgo,
      expiresAt: new Date(twoMinAgo.getTime() + 3600_000),
    });

    const result = await isResetCooldownActive(db, uniqueUser);
    expect(result).toBe(false);
  });
});
