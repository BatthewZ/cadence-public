/// <reference types="@cloudflare/workers-types" />
/**
 * Tests for `migrations/0036_normalize_invitation_email.sql`.
 *
 * ## Why a migration gets its own test
 *
 * The code fix for the stranded-invitee defect folds both operands at every
 * comparison site, so correctness does not depend on this migration. What the
 * migration buys is that the *stored* data stops disagreeing with the
 * invariant `createInvitationSchema` now advertises — without it,
 * `invitation.email` means "canonical, except for rows older than this deploy",
 * and a single source of truth that holds only for recent rows is not one
 * (CLAUDE.md rule 4).
 *
 * A data migration is also the one kind of change that cannot be rolled back by
 * redeploying, and this one both rewrites a column and *revokes rows*. The
 * revocation is the part that most needs a test: a partition or ordering
 * mistake in the ROW_NUMBER() window would silently revoke live invitations
 * belonging to unrelated workspaces, and nothing downstream would notice —
 * the invitees would simply never be able to join, which is the exact failure
 * mode this whole batch of work exists to eliminate.
 *
 * The migration is re-applied here against rows seeded to look like legacy
 * data. That is only sound because it is idempotent by construction (both
 * statements carry WHERE clauses that exclude already-processed rows), which
 * the final case asserts directly rather than assuming.
 */
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestD1, seedInvitation, seedUser, seedWorkspace, TEST_USER } from "../../test-utils";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../migrations/0036_normalize_invitation_email.sql",
);

let d1: D1Database;
let dispose: () => Promise<void>;
let wsId: string;
let otherWsId: string;

/**
 * Re-run the migration exactly as `applyMigrations` does — same file, same
 * `--> statement-breakpoint` split — so the test cannot pass against a
 * paraphrase of the SQL that ships.
 */
async function runMigration(): Promise<void> {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
  const statements = sql
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !s.split("\n").every((line) => line.trim().startsWith("--") || line.trim() === ""),
    );
  expect(statements).toHaveLength(2);
  await d1.batch(statements.map((s) => d1.prepare(s)));
}

async function readInvitation(id: string) {
  return d1
    .prepare("SELECT email, status FROM invitation WHERE id = ?")
    .bind(id)
    .first<{ email: string; status: string }>();
}

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1, TEST_USER);
  wsId = await seedWorkspace(d1, TEST_USER.id, { name: "Backfill WS" });
  otherWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Other Backfill WS" });
});

afterAll(async () => {
  await dispose();
});

describe("0036 — invitation email normalisation backfill", () => {
  it("folds a legacy mixed-case, whitespace-padded address", async () => {
    await seedInvitation(d1, wsId, {
      id: "legacy-mixed",
      email: "  Legacy.Mixed@Example.COM ",
      invitedBy: TEST_USER.id,
      token: "legacy-mixed-token",
      status: "pending",
    });

    await runMigration();

    expect((await readInvitation("legacy-mixed"))?.email).toBe("legacy.mixed@example.com");
  });

  it("folds non-pending rows too, so historical invitations stay findable", async () => {
    // Accepted and revoked rows are read by the workspace export and by anyone
    // auditing who was invited to what. Leaving a mixed-case tail there would
    // mean a search for an address silently misses the history this migration
    // was run to make searchable.
    await seedInvitation(d1, wsId, {
      id: "legacy-accepted",
      email: "Past.Member@Example.com",
      invitedBy: TEST_USER.id,
      token: "legacy-accepted-token",
      status: "accepted",
    });

    await runMigration();

    const row = await readInvitation("legacy-accepted");
    expect(row?.email).toBe("past.member@example.com");
    // Folding must not disturb the status of a row it is only rewriting.
    expect(row?.status).toBe("accepted");
  });

  it("keeps the newest of two pending rows that collide once folded, and revokes the older", async () => {
    // The duplicate-pending guard compared byte-for-byte too, so one mailbox
    // could hold several live invitations in a workspace. Folding makes them
    // indistinguishable; the migration retires the surplus so the admin's
    // pending list does not show identical entries, all but one of which can
    // never do anything.
    await seedInvitation(d1, wsId, {
      id: "dup-older",
      email: "Dup@Example.com",
      invitedBy: TEST_USER.id,
      token: "dup-older-token",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    // seedInvitation stamps createdAt = now for both, so the tie is broken on
    // id DESC — pin the ordering explicitly rather than depending on clock
    // resolution inside a single test.
    await d1
      .prepare("UPDATE invitation SET createdAt = createdAt - 60 WHERE id = ?")
      .bind("dup-older")
      .run();
    await seedInvitation(d1, wsId, {
      id: "dup-newer",
      email: "DUP@EXAMPLE.COM",
      invitedBy: TEST_USER.id,
      token: "dup-newer-token",
      status: "pending",
    });

    await runMigration();

    expect(await readInvitation("dup-newer")).toEqual({
      email: "dup@example.com",
      status: "pending",
    });
    expect(await readInvitation("dup-older")).toEqual({
      email: "dup@example.com",
      // Revoked, not deleted: the row is evidence an admin performed an
      // action, and `revokeInvitation` already uses this status for exactly
      // "retired but happened".
      status: "revoked",
    });
  });

  it("does not treat the same address in two workspaces as a duplicate", async () => {
    // The window partitions on (workspaceId, folded email). Dropping the
    // workspace from that partition would revoke live invitations across
    // unrelated tenants — a silent, cross-workspace outage.
    await seedInvitation(d1, wsId, {
      id: "cross-a",
      email: "Shared@Example.com",
      invitedBy: TEST_USER.id,
      token: "cross-a-token",
      status: "pending",
    });
    await seedInvitation(d1, otherWsId, {
      id: "cross-b",
      email: "SHARED@example.com",
      invitedBy: TEST_USER.id,
      token: "cross-b-token",
      status: "pending",
    });

    await runMigration();

    expect(await readInvitation("cross-a")).toEqual({
      email: "shared@example.com",
      status: "pending",
    });
    expect(await readInvitation("cross-b")).toEqual({
      email: "shared@example.com",
      status: "pending",
    });
  });

  it("is idempotent — a second application changes nothing", async () => {
    // `wrangler d1 migrations apply` will not re-run an applied migration, but
    // a restored backup, a re-pointed database or a hand-run recovery all can.
    // Both statements carry WHERE clauses that exclude already-processed rows;
    // this proves it rather than trusting it. In particular, a second pass
    // must NOT revoke the survivor of the duplicate pair.
    const before = await d1
      .prepare("SELECT id, email, status FROM invitation ORDER BY id")
      .all<{ id: string; email: string; status: string }>();

    await runMigration();
    await runMigration();

    const after = await d1
      .prepare("SELECT id, email, status FROM invitation ORDER BY id")
      .all<{ id: string; email: string; status: string }>();
    expect(after.results).toEqual(before.results);
  });
});
