/// <reference types="@cloudflare/workers-types" />
import fs from "node:fs";
import path from "node:path";

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../migrations");

/** The data migration under test. */
const BACKFILL_MIGRATION = "0035_backfill_email_verified.sql";

function splitStatements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !s.split("\n").every((line) => line.trim().startsWith("--") || line.trim() === ""),
    );
}

async function applyMigration(d1: D1Database, file: string): Promise<void> {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8").trim();
  const stmts = splitStatements(sql);
  if (stmts.length === 0) return;
  await d1.batch(stmts.map((s) => d1.prepare(s)));
}

/**
 * Every migration in filename order, stopping *before* the backfill — this is
 * the schema an existing deployment is running today.
 */
function migrationsBeforeBackfill(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f < BACKFILL_MIGRATION);
}

async function seedUnverifiedUser(d1: D1Database, id: string, email: string) {
  const now = Math.floor(Date.now() / 1000);
  await d1
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)",
    )
    .bind(id, `User ${id}`, email, now, now)
    .run();
}

/**
 * Regression test for the lockout hazard that `requireEmailVerification`
 * introduces.
 *
 * Every account in a pre-existing Cadence deployment carries
 * `emailVerified = 0`, because sign-up never asked anyone to verify. Turning
 * the flag on makes Better Auth refuse `POST /sign-in/email` with 403 for
 * exactly those accounts — i.e. all of them, workspace owners included, with
 * no self-service way back in. `0035_backfill_email_verified.sql` is the half
 * of that change that keeps the door open.
 *
 * The test drives the real migration file rather than a copy of its SQL, so it
 * fails if the file is deleted, renamed, or emptied — the three ways this
 * safeguard could silently disappear while `requireEmailVerification: true`
 * stays behind in `auth.ts`.
 */
describe("0035_backfill_email_verified", () => {
  let mf: Miniflare;
  let d1: D1Database;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: ["DB"],
    });
    d1 = await mf.getD1Database("DB");
    for (const file of migrationsBeforeBackfill()) {
      await applyMigration(d1, file);
    }
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("verifies every account that predates the flag, and leaves later ones alone", async () => {
    await seedUnverifiedUser(d1, "legacy-owner", "owner@example.com");
    await seedUnverifiedUser(d1, "legacy-member", "member@example.com");
    await seedUnverifiedUser(d1, "legacy-dev-login", "some@email.com");

    const before = await d1
      .prepare("SELECT COUNT(*) AS n FROM user WHERE emailVerified = 0")
      .first<{ n: number }>();
    expect(before?.n).toBe(3);

    await applyMigration(d1, BACKFILL_MIGRATION);

    const stranded = await d1
      .prepare("SELECT id FROM user WHERE emailVerified = 0")
      .all<{ id: string }>();
    expect(stranded.results).toEqual([]);

    const verified = await d1
      .prepare("SELECT COUNT(*) AS n FROM user WHERE emailVerified = 1")
      .first<{ n: number }>();
    expect(verified?.n).toBe(3);
  });

  it("is idempotent and cannot un-verify anyone", async () => {
    // Re-running a migration is a normal operational event (a partially
    // applied deploy, a restored backup replayed forward). It must not flip
    // a verified account back, and it must not error.
    await applyMigration(d1, BACKFILL_MIGRATION);

    const stranded = await d1
      .prepare("SELECT COUNT(*) AS n FROM user WHERE emailVerified = 0")
      .first<{ n: number }>();
    expect(stranded?.n).toBe(0);
  });

  it("does not grandfather accounts created after it has run", async () => {
    // The backfill is a one-time amnesty, not a disabling of the feature. A
    // signup that happens after the migration must still be unverified —
    // otherwise the security fix is cosmetic.
    await seedUnverifiedUser(d1, "post-migration-signup", "newcomer@example.com");

    const row = await d1
      .prepare("SELECT emailVerified FROM user WHERE id = ?")
      .bind("post-migration-signup")
      .first<{ emailVerified: number }>();
    expect(row?.emailVerified).toBe(0);
  });
});
