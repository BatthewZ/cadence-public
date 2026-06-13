/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the bulk task import handler
 * (POST /projects/:projectId/tasks/import).
 *
 * Uses a real in-memory D1 database (via Miniflare) so the dedupe SELECTs,
 * the chunked transactional batch INSERT, the partial unique index on
 * (projectId, source_uid), and the fractional-index position chain are all
 * exercised against actual SQL — the dedupe contract lives in the index,
 * and a mock would happily "pass" while production D1 rejected the batch.
 *
 * These tests pin down the import endpoint's documented contract:
 * - re-importing a file skips UID-bearing events instead of duplicating
 *   (and instead of failing the whole batch on the unique index);
 * - events without a UID are never deduped — importing twice duplicates;
 * - imported tasks are appended after existing group tasks in payload order;
 * - activity rows say "Imported", and NO task.created webhooks fan out;
 * - `sourceUid` is immutable: PATCH cannot set or change it.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  importTasksResponseSchema,
  taskDetailSchema,
} from "../../../shared/schemas/openapi-responses";
import { importTasksSchema, updateTaskSchema } from "../../../shared/schemas/task";
import type { AppEnv } from "../../env";
import { requireProjectRole } from "../../middleware/authorize";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  installFetchSpy,
  jsonRequest,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWebhook,
  seedWorkspace,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import { getTask, importTasks, updateTask } from "./tasks.handlers";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);

  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mini Hono app wired like the real route: real
 * `requireProjectRole("admin", "member")` middleware (fed from fakeAuth's
 * cached projectAccess/currentProject) plus real body validation — so 403
 * and 400 paths are exercised through the same code production requests
 * take, not through handler-only shortcuts.
 */
function importApp(opts?: {
  // Union matches the seed-utils convention (seed.ts) — the fixtures carry
  // literal types, so `typeof TEST_USER` alone would reject TEST_USER_2.
  user?: typeof TEST_USER | typeof TEST_USER_2;
  role?: "admin" | "member" | "viewer";
}) {
  const app = new Hono<AppEnv>();
  app.post(
    "/projects/:projectId/tasks/import",
    fakeAuth(d1, opts?.user ?? TEST_USER, {
      workspaceMembership: { id: "wm-1", role: "owner" },
      currentProject: { id: projectId, workspaceId },
      projectAccess: { role: opts?.role ?? "admin", source: "project" },
    }),
    requireProjectRole("admin", "member"),
    validateBody(importTasksSchema),
    importTasks,
  );
  return app;
}

function postImport(
  app: Hono<AppEnv>,
  body: unknown,
  ctx?: ExecutionContext,
) {
  return app.request(
    `/projects/${projectId}/tasks/import`,
    jsonRequest("POST", `/projects/${projectId}/tasks/import`, body),
    {},
    ctx,
  );
}

interface ImportCounters {
  created: number;
  skipped: number;
  total: number;
}

/** Raw task rows for a group, ordered by fractional position. */
async function tasksInGroup(groupId: string) {
  const { results } = await d1
    .prepare(
      `SELECT id, title, source_uid AS sourceUid, startDate, dueDate, position, completed
       FROM task WHERE taskGroupId = ? ORDER BY position ASC`,
    )
    .bind(groupId)
    .all<{
      id: string;
      title: string;
      sourceUid: string | null;
      startDate: number | null;
      dueDate: number | null;
      position: string;
      completed: number;
    }>();
  return results;
}

/**
 * Mirrors the awaitable ExecutionContext helper in tasks.handlers.test.ts:
 * captures waitUntil promises so deferred work (activity logging) and any
 * webhook dispatch can be flushed deterministically before asserting.
 */
function createAwaitableExecutionCtx() {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
      passThroughOnException: () => {},
    } as ExecutionContext,
    flush: async () => {
      let awaited = 0;
      while (awaited < promises.length) {
        const batch = promises.slice(awaited);
        awaited = promises.length;
        await Promise.all(batch);
      }
    },
  };
}

// =========================================================================
// Happy path
// =========================================================================

describe("importTasks — happy path", () => {
  it("creates tasks with dates + sourceUid, appended after existing tasks in strictly increasing position order", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import HP" });
    // Pre-existing task the import must append AFTER, not interleave with.
    await seedTask(d1, projectId, groupId, { title: "Existing", position: "a5" });

    const res = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [
        {
          title: "Sprint review",
          description: "Quarterly review",
          startDate: "2030-06-01",
          dueDate: "2030-06-02",
          sourceUid: "hp-uid-1@cal.example.com",
        },
        { title: "Retro", dueDate: "2030-06-03", sourceUid: "hp-uid-2@cal.example.com" },
        { title: "No dates, no uid" },
      ],
    });

    expect(res.status).toBe(201);
    const body = await res.json<ImportCounters>();
    expect(body).toEqual({ created: 3, skipped: 0, total: 3 });
    // Response must satisfy the documented OpenAPI contract schema.
    expect(importTasksResponseSchema.safeParse(body).success).toBe(true);

    const rows = await tasksInGroup(groupId);
    expect(rows.map((r) => r.title)).toEqual([
      "Existing",
      "Sprint review",
      "Retro",
      "No dates, no uid",
    ]);

    // Positions strictly increasing, all appended after the existing task.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].position > rows[i - 1].position).toBe(true);
    }

    // Dates persisted as UTC-midnight timestamps (stored as epoch seconds),
    // sourceUid persisted verbatim, absent fields null.
    const [, review, retro, bare] = rows;
    expect(review.sourceUid).toBe("hp-uid-1@cal.example.com");
    expect(review.startDate).toBe(new Date("2030-06-01").getTime() / 1000);
    expect(review.dueDate).toBe(new Date("2030-06-02").getTime() / 1000);
    expect(retro.sourceUid).toBe("hp-uid-2@cal.example.com");
    expect(retro.startDate).toBeNull();
    expect(bare.sourceUid).toBeNull();
    expect(bare.startDate).toBeNull();
    expect(bare.dueDate).toBeNull();
  });

  it("imports 120 rows — exercises the D1 bound-parameter chunking for both the batch INSERT and the dedupe SELECT", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Bulk" });
    // 120 rows: far more than one INSERT statement can bind (~6 rows per
    // statement at D1's 100-param ceiling, enforced by Miniflare too), and
    // on re-import more UIDs than one IN-list SELECT can hold (99) — so a
    // statement outgrowing the ceiling fails THIS test instead of prod.
    const tasks = Array.from({ length: 120 }, (_, i) => ({
      title: `Bulk event ${i}`,
      sourceUid: `bulk-uid-${i}@cal.example.com`,
    }));

    const res = await postImport(importApp(), { taskGroupId: groupId, tasks });

    expect(res.status).toBe(201);
    expect(await res.json<ImportCounters>()).toEqual({ created: 120, skipped: 0, total: 120 });

    const rows = await tasksInGroup(groupId);
    expect(rows).toHaveLength(120);
    expect(rows.map((r) => r.title)).toEqual(tasks.map((t) => t.title));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].position > rows[i - 1].position).toBe(true);
    }

    // Re-import: the dedupe SELECT must chunk 120 UIDs across two queries
    // and still skip everything.
    const again = await postImport(importApp(), { taskGroupId: groupId, tasks });
    expect(again.status).toBe(201);
    expect(await again.json<ImportCounters>()).toEqual({ created: 0, skipped: 120, total: 120 });
    expect(await tasksInGroup(groupId)).toHaveLength(120);
  });

  it("marks imported tasks completed when the target group is a completion group (same rule as createTask)", async () => {
    const groupId = await seedTaskGroup(d1, projectId, {
      name: "Import Done",
      isCompletionGroup: true,
    });

    const res = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [{ title: "Already done", sourceUid: "done-uid-1@cal.example.com" }],
    });

    expect(res.status).toBe(201);
    const rows = await tasksInGroup(groupId);
    expect(rows[0].completed).toBe(1);
  });
});

// =========================================================================
// Dedupe behavior (the reason sourceUid exists)
// =========================================================================

describe("importTasks — dedupe via sourceUid", () => {
  it("re-importing the same payload skips every UID-bearing event", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Dedupe" });
    const payload = {
      taskGroupId: groupId,
      tasks: [
        { title: "Standup", sourceUid: "dd-uid-1@cal.example.com" },
        { title: "Planning", sourceUid: "dd-uid-2@cal.example.com" },
        { title: "Demo", sourceUid: "dd-uid-3@cal.example.com" },
      ],
    };

    const first = await postImport(importApp(), payload);
    expect(first.status).toBe(201);
    expect(await first.json<ImportCounters>()).toEqual({ created: 3, skipped: 0, total: 3 });

    const second = await postImport(importApp(), payload);
    expect(second.status).toBe(201);
    expect(await second.json<ImportCounters>()).toEqual({ created: 0, skipped: 3, total: 3 });

    expect(await tasksInGroup(groupId)).toHaveLength(3);
  });

  it("mixed payload: creates new events, skips already-imported ones", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Mixed" });

    await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [
        { title: "Old A", sourceUid: "mx-uid-a@cal.example.com" },
        { title: "Old B", sourceUid: "mx-uid-b@cal.example.com" },
      ],
    });

    const res = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [
        { title: "Old A updated title", sourceUid: "mx-uid-a@cal.example.com" },
        { title: "New C", sourceUid: "mx-uid-c@cal.example.com" },
        { title: "New D", sourceUid: "mx-uid-d@cal.example.com" },
      ],
    });

    expect(res.status).toBe(201);
    expect(await res.json<ImportCounters>()).toEqual({ created: 2, skipped: 1, total: 3 });

    const rows = await tasksInGroup(groupId);
    expect(rows).toHaveLength(4);
    // The skipped event must NOT have been updated — import is create-only.
    expect(rows.map((r) => r.title)).toContain("Old A");
    expect(rows.map((r) => r.title)).not.toContain("Old A updated title");
  });

  it("a UID duplicated WITHIN one payload is created once and skipped once (would otherwise trip the unique index and roll back the batch)", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import IntraDup" });

    const res = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [
        { title: "First occurrence", sourceUid: "intra-uid@cal.example.com" },
        { title: "Second occurrence", sourceUid: "intra-uid@cal.example.com" },
      ],
    });

    expect(res.status).toBe(201);
    expect(await res.json<ImportCounters>()).toEqual({ created: 1, skipped: 1, total: 2 });
    const rows = await tasksInGroup(groupId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("First occurrence");
  });

  it("events WITHOUT a sourceUid are never deduped — importing twice duplicates them (documented behavior)", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import NoUid" });
    const payload = { taskGroupId: groupId, tasks: [{ title: "Anonymous event" }] };

    expect(await (await postImport(importApp(), payload)).json<ImportCounters>())
      .toEqual({ created: 1, skipped: 0, total: 1 });
    expect(await (await postImport(importApp(), payload)).json<ImportCounters>())
      .toEqual({ created: 1, skipped: 0, total: 1 });

    const rows = await tasksInGroup(groupId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title)).toEqual(["Anonymous event", "Anonymous event"]);
  });

  it("the same sourceUid in a DIFFERENT project is not a duplicate (dedupe is per project)", async () => {
    const otherProjectId = await seedProject(d1, workspaceId, { name: "Other Project" });
    await seedProjectMember(d1, otherProjectId, TEST_USER.id, "admin");
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import XProj A" });
    const otherGroupId = await seedTaskGroup(d1, otherProjectId, { name: "Import XProj B" });

    const first = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [{ title: "Shared event", sourceUid: "xproj-uid@cal.example.com" }],
    });
    expect(await first.json<ImportCounters>()).toEqual({ created: 1, skipped: 0, total: 1 });

    // Same UID, different project — must create, not skip.
    const otherApp = new Hono<AppEnv>();
    otherApp.post(
      "/projects/:projectId/tasks/import",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
        currentProject: { id: otherProjectId, workspaceId },
        projectAccess: { role: "admin", source: "project" },
      }),
      requireProjectRole("admin", "member"),
      validateBody(importTasksSchema),
      importTasks,
    );
    const second = await otherApp.request(
      `/projects/${otherProjectId}/tasks/import`,
      jsonRequest("POST", `/projects/${otherProjectId}/tasks/import`, {
        taskGroupId: otherGroupId,
        tasks: [{ title: "Shared event", sourceUid: "xproj-uid@cal.example.com" }],
      }),
    );
    expect(second.status).toBe(201);
    expect(await second.json<ImportCounters>()).toEqual({ created: 1, skipped: 0, total: 1 });
  });
});

// =========================================================================
// Validation
// =========================================================================

describe("importTasks — validation", () => {
  it("rejects more than 500 items with 400 and inserts nothing", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Cap" });
    const res = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: Array.from({ length: 501 }, (_, i) => ({ title: `Over cap ${i}` })),
    });

    expect(res.status).toBe(400);
    expect(await tasksInGroup(groupId)).toHaveLength(0);
  });

  it("rejects a payload containing one invalid item (start after due) with 400 and NO partial insert", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Range" });
    const res = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [
        { title: "Valid", startDate: "2030-06-01", dueDate: "2030-06-02" },
        { title: "Inverted", startDate: "2030-06-05", dueDate: "2030-06-01" },
      ],
    });

    expect(res.status).toBe(400);
    // Whole-payload rejection: the valid sibling must not have been inserted.
    expect(await tasksInGroup(groupId)).toHaveLength(0);
  });

  it("imports a start-without-due item as a start-only task (DTSTART with no DTEND)", async () => {
    // The shared dateRange refinement only rejects an inverted range; a start
    // date may stand alone, so a calendar event with a DTSTART and no DTEND
    // imports as a start-only task rather than being dropped.
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import StartOnly" });
    const res = await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [{ title: "Start only", startDate: "2030-06-01" }],
    });

    expect(res.status).toBe(201);
    const inserted = await tasksInGroup(groupId);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].startDate).toBe(Date.UTC(2030, 5, 1) / 1000);
    expect(inserted[0].dueDate).toBeNull();
  });

  it("returns 404 for a task group that does not exist", async () => {
    const res = await postImport(importApp(), {
      taskGroupId: crypto.randomUUID(),
      tasks: [{ title: "Orphan" }],
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a task group that belongs to a different project (no cross-project injection)", async () => {
    const foreignProjectId = await seedProject(d1, workspaceId, { name: "Foreign" });
    const foreignGroupId = await seedTaskGroup(d1, foreignProjectId, { name: "Foreign Group" });

    const res = await postImport(importApp(), {
      taskGroupId: foreignGroupId,
      tasks: [{ title: "Injected" }],
    });
    expect(res.status).toBe(404);
    expect(await tasksInGroup(foreignGroupId)).toHaveLength(0);
  });

  it("returns 403 for a viewer (requireProjectRole admin|member)", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Viewer" });
    const res = await postImport(importApp({ user: TEST_USER_2, role: "viewer" }), {
      taskGroupId: groupId,
      tasks: [{ title: "Forbidden" }],
    });
    expect(res.status).toBe(403);
    expect(await tasksInGroup(groupId)).toHaveLength(0);
  });
});

// =========================================================================
// Side-effects: activity yes, webhooks no
// =========================================================================

describe("importTasks — side effects", () => {
  it("logs a batched 'created' activity row with newValue 'Imported' for every created task", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Activity" });
    const { ctx, flush } = createAwaitableExecutionCtx();

    const res = await postImport(
      importApp(),
      {
        taskGroupId: groupId,
        tasks: [
          { title: "Act A", sourceUid: "act-uid-a@cal.example.com" },
          { title: "Act B", sourceUid: "act-uid-b@cal.example.com" },
        ],
      },
      ctx,
    );
    expect(res.status).toBe(201);
    await flush(); // activity logging is deferred via waitUntil

    const rows = await tasksInGroup(groupId);
    const { results: activities } = await d1
      .prepare(
        `SELECT taskId, action, newValue, actorId FROM task_activity
         WHERE taskId IN (?, ?) ORDER BY taskId`,
      )
      .bind(rows[0].id, rows[1].id)
      .all<{ taskId: string; action: string; newValue: string | null; actorId: string }>();

    expect(activities).toHaveLength(2);
    for (const activity of activities) {
      expect(activity.action).toBe("created");
      expect(activity.newValue).toBe("Imported");
      expect(activity.actorId).toBe(TEST_USER.id);
    }
  });

  it("dispatches NO task.created webhooks even when a webhook subscribes to the event (deliberate: bulk fan-out is webhook abuse)", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import NoHook" });
    await seedWebhook(d1, workspaceId, {
      url: "https://hooks.example.com/import-should-not-fire",
      events: JSON.stringify(["task.created"]),
    });

    // Same spy pattern as the task.updated webhook test in
    // tasks.handlers.test.ts — but inverted: we assert NO delivery happened.
    const fetchSpy = installFetchSpy();
    try {
      const { ctx, flush } = createAwaitableExecutionCtx();
      const res = await postImport(
        importApp(),
        {
          taskGroupId: groupId,
          tasks: [
            { title: "Silent A", sourceUid: "hook-uid-a@cal.example.com" },
            { title: "Silent B", sourceUid: "hook-uid-b@cal.example.com" },
          ],
        },
        ctx,
      );
      expect(res.status).toBe(201);
      await flush();

      const deliveryCalls = fetchSpy.calls.filter(
        ([url]) => url === "https://hooks.example.com/import-should-not-fire",
      );
      expect(deliveryCalls).toHaveLength(0);
    } finally {
      fetchSpy.restore();
    }
  });
});

// =========================================================================
// Contract: sourceUid is readable everywhere, writable nowhere but import
// =========================================================================

describe("sourceUid contract", () => {
  it("getTask response includes sourceUid and satisfies the documented OpenAPI TaskDetail schema", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Contract" });
    await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [
        {
          title: "Contract event",
          startDate: "2030-07-01",
          dueDate: "2030-07-02",
          sourceUid: "contract-uid@cal.example.com",
        },
      ],
    });
    const [imported] = await tasksInGroup(groupId);

    const app = new Hono<AppEnv>();
    app.get("/tasks/:taskId", fakeAuth(d1), getTask);
    const res = await app.request(`/tasks/${imported.id}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ task: Record<string, unknown> }>();

    // Guard against the contract-drift class Wave 1's checker caught with
    // startDate: the documented schema requires sourceUid, so a handler
    // that stops returning it fails this parse.
    const parsed = taskDetailSchema.safeParse(body.task);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(body.task.sourceUid).toBe("contract-uid@cal.example.com");
  });

  it("sourceUid is NOT settable via PATCH — updateTaskSchema strips it and the stored value survives", async () => {
    const groupId = await seedTaskGroup(d1, projectId, { name: "Import Immutable" });
    await postImport(importApp(), {
      taskGroupId: groupId,
      tasks: [{ title: "Immutable", sourceUid: "immutable-uid@cal.example.com" }],
    });
    const [imported] = await tasksInGroup(groupId);

    // Schema-level guarantee first: the field is not part of the PATCH
    // contract at all, so it cannot be added back by a future handler change
    // without also touching the schema.
    expect(Object.keys(updateTaskSchema.shape)).not.toContain("sourceUid");

    const app = new Hono<AppEnv>();
    app.patch("/tasks/:taskId", fakeAuth(d1), validateBody(updateTaskSchema), updateTask);
    const res = await app.request(
      `/tasks/${imported.id}`,
      jsonRequest("PATCH", `/tasks/${imported.id}`, {
        title: "Renamed",
        sourceUid: "attacker-controlled-uid",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ task: { title: string; sourceUid: string | null } }>();
    expect(body.task.title).toBe("Renamed");
    // PATCH ignored the foreign key entirely — stored provenance unchanged.
    expect(body.task.sourceUid).toBe("immutable-uid@cal.example.com");

    const [after] = await tasksInGroup(groupId);
    expect(after.sourceUid).toBe("immutable-uid@cal.example.com");
  });
});
