import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Database } from "../../../../db";
import { task } from "../../../../db/schema/task";
import { createTestD1 } from "../../../test-utils/db-setup";
import { TEST_USER } from "../../../test-utils/fakes";
import {
  seedProject,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
} from "../../../test-utils/seed";
import { spawnNextRecurringInstance } from "./spawn-recurring-instance";

/**
 * Integration tests for the two UNIQUE-index outcomes `spawnNextRecurringInstance`
 * has to tell apart, run against a real Miniflare D1 with the real migrations —
 * so the constraints that arbitrate here are the production indexes, not stubs.
 *
 * ## Why these two cases and not a `Promise.all` race
 *
 * The defect being pinned is a race: the spawn reads the group's last position
 * and inserts after it, and those are two statements. A test that fires two
 * completions with `Promise.all` cannot reproduce it — vitest/Miniflare
 * serialises the requests, so the second completion always reads a boundary the
 * first has already committed and the test passes against the *buggy* code as
 * happily as against the fixed one. An earlier attempt was abandoned for
 * exactly that reason, and an unfalsifiable test is worse than no test: it
 * spends reviewer trust and reports coverage that does not exist.
 *
 * Nor can the collision be seeded directly. The candidate position is
 * `generateKeyBetween(max, null)`, which is by construction strictly greater
 * than every position already in the group, so no row can be seeded onto it —
 * seeding one would just make that row the new `max`. The collision only exists
 * as an interleaving.
 *
 * So the two branches are pinned by the two things that ARE deterministic:
 *
 *  1. **Duplicate spawn** — seed a row that already claims
 *     `recurrence_parent_id`, and the real partial unique index rejects the
 *     insert on the first attempt with no concurrency required. This is the
 *     branch that must adopt the winner's row.
 *  2. **Position collision** — a temporary SQLite trigger takes `NEW.position`
 *     out from under the insert, which is precisely what a concurrent writer
 *     does, and produces a genuine `UNIQUE constraint failed: task.taskGroupId,
 *     task.position` from the real index. SQLite's statement-level ABORT undoes
 *     the trigger's row along with the failed insert, so the conflict repeats
 *     on every retry — which makes it a test of the *loud failure* end of the
 *     retry loop rather than of a single recovery. That is the assertion that
 *     matters most here, because the alternative failure mode is silent: a
 *     spawn misfiled as a duplicate returns `nextRecurringTask: null`, the
 *     completion still answers 200, and the recurring series stops forever with
 *     no error and no log line.
 *
 * The recover-and-succeed half of the loop is covered directly, without needing
 * an interleaving, in `src/api/lib/position-conflict.test.ts`.
 */

const RULE = JSON.stringify({ frequency: "daily", interval: 1 });
const COMPLETION_DATE = new Date("2025-03-10T00:00:00.000Z");

let d1: D1Database;
let db: Database;
let dispose: () => Promise<void>;

let projectId: string;
let groupId: string;
let parentId: string;

/** Reads the seeded recurring task back as a full row, which is what the helper takes. */
async function loadTask(id: string) {
  const [row] = await db.select().from(task).where(eq(task.id, id)).limit(1);
  if (!row) throw new Error(`Task ${id} not found`);
  return row;
}

beforeEach(async () => {
  ({ d1, dispose } = await createTestD1());
  db = createDb(d1);

  await seedUser(d1);
  const workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  groupId = await seedTaskGroup(d1, projectId);

  parentId = await seedTask(d1, projectId, groupId, {
    title: "Water the plants",
    dueDate: new Date("2025-03-09T00:00:00.000Z"),
    completed: true,
  });
  await d1
    .prepare("UPDATE task SET recurrence_rule = ?, recurrence_series_id = ? WHERE id = ?")
    .bind(RULE, parentId, parentId)
    .run();
});

afterEach(async () => {
  await dispose();
});

describe("spawnNextRecurringInstance", () => {
  it("spawns the next instance at the end of the group", async () => {
    // Control case: without it, a regression that makes every spawn throw would
    // still satisfy the two conflict tests below for the wrong reason.
    const { nextRecurringTask } = await spawnNextRecurringInstance(
      db,
      await loadTask(parentId),
      COMPLETION_DATE,
      groupId,
    );

    expect(nextRecurringTask).not.toBeNull();
    expect(nextRecurringTask?.recurrenceParentId).toBe(parentId);

    const rows = await db
      .select()
      .from(task)
      .where(eq(task.recurrenceParentId, parentId));
    expect(rows).toHaveLength(1);
    // Strictly after the completed task, i.e. genuinely appended rather than
    // reusing the boundary key it was computed from.
    const [spawnedRow] = rows;
    const boundary = await loadTask(parentId);
    expect(spawnedRow.position > boundary.position).toBe(true);
  });

  it("adopts the instance a concurrent completion already spawned", async () => {
    // The winner of a double completion. `task_recurrence_parent_unique_idx`
    // will reject our insert on the very first attempt because of this row.
    const winnerId = await seedTask(d1, projectId, groupId, { title: "Water the plants" });
    await d1
      .prepare("UPDATE task SET recurrence_parent_id = ?, recurrence_rule = ? WHERE id = ?")
      .bind(parentId, RULE, winnerId)
      .run();

    const { nextRecurringTask } = await spawnNextRecurringInstance(
      db,
      await loadTask(parentId),
      COMPLETION_DATE,
      groupId,
    );

    // Adopted, not re-created and not swallowed. Returning null here would be
    // the silent failure: the caller reports success and the series ends.
    expect(nextRecurringTask?.id).toBe(winnerId);

    const rows = await db
      .select()
      .from(task)
      .where(eq(task.recurrenceParentId, parentId));
    expect(rows).toHaveLength(1);
  });

  it("does not mistake a position collision for a duplicate spawn, and fails loudly", async () => {
    // Stands in for a concurrent writer claiming the computed key between our
    // SELECT and our INSERT — the interleaving the fractional-index read/write
    // pair cannot make atomic. Scoped to inserts that carry a
    // recurrence_parent_id so only the spawn under test is affected.
    await d1
      .prepare(
        `CREATE TRIGGER steal_computed_position BEFORE INSERT ON task
         WHEN NEW.recurrence_parent_id IS NOT NULL
         BEGIN
           INSERT INTO task (id, projectId, taskGroupId, title, completed, priority, position, createdAt, updatedAt)
           VALUES ('rival-writer', NEW.projectId, NEW.taskGroupId, 'Rival writer', 0, 'none', NEW.position, NEW.createdAt, NEW.updatedAt);
         END`,
      )
      .run();

    const parent = await loadTask(parentId);

    // Loud, and specifically the retry loop's exhaustion error — not the raw
    // D1 UNIQUE error (which would mean the collision was never recognised as
    // retryable) and not a resolved `null` (which would mean it was misfiled as
    // a duplicate spawn and the series silently ended).
    await expect(
      spawnNextRecurringInstance(db, parent, COMPLETION_DATE, groupId),
    ).rejects.toThrow(/Position conflict persisted after 10 attempts/);

    await d1.prepare("DROP TRIGGER steal_computed_position").run();

    // Nothing half-written survives: no instance, and no rival row (SQLite's
    // statement-level ABORT unwinds the trigger's insert with the failed one).
    const spawned = await db
      .select()
      .from(task)
      .where(eq(task.recurrenceParentId, parentId));
    expect(spawned).toHaveLength(0);

    const rival = await db.select().from(task).where(eq(task.id, "rival-writer"));
    expect(rival).toHaveLength(0);
  });
});
