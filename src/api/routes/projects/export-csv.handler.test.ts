import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppEnv } from "../../env";
import { requireProjectAccess } from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import {
  createTestD1,
  fakeAuth,
  fakeEnv,
  seedLabel,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import { exportProjectCsv } from "./export-csv.handler";

/**
 * Per-project CSV export tests.
 *
 * These run against a real in-memory D1 with the REAL `requireAuth` +
 * `requireProjectAccess()` middleware mounted (not fakeAuth-injected access
 * context), because the access-policy decisions are the contract under test:
 *
 * 1. **Viewers CAN export (200)** — plan decision 3: viewers already read
 *    every exported field via the task APIs, so a tighter CSV gate would be
 *    theater. If a refactor swaps in `requireProjectRole(...)` and locks
 *    viewers out, this test is what catches it.
 * 2. **The injection-hardening integration** — a task titled `=2+2` must
 *    arrive in the response body as `'=2+2`. The csv lib's own tests prove
 *    the hardening function; THIS test proves the handler actually routes
 *    user-controlled titles through it as raw strings (a pre-concatenation
 *    or String()-coercion refactor could silently bypass the lib).
 * 3. **Exact serialization** — full-body assertion pins the column order,
 *    `;`-joined labels, empty cells for null assignee/due/cost, boolean
 *    true/false, the YYYY-MM-DD due-date slice, and cents→decimal cost
 *    (1050 → 10.50). Spreadsheet consumers parse positionally; any drift
 *    here is a breaking change and must be a deliberate test edit.
 */

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let emptyProjectId: string;

/** Insert a task↔label assignment (no seed helper exists for task_label). */
async function seedTaskLabelRow(taskId: string, labelId: string) {
  await d1
    .prepare(
      "INSERT INTO task_label (id, taskId, labelId, createdAt) VALUES (?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), taskId, labelId, Math.floor(Date.now() / 1000))
    .run();
}

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id); // TEST_USER = owner
  // TEST_USER_2 is a plain workspace member: project access comes only from
  // explicit project membership, which we grant as "viewer" on the main
  // project and NOT AT ALL on the empty project (the non-member 403 case).
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

  projectId = await seedProject(d1, workspaceId, { name: "CSV Export Project" });
  await seedProjectMember(d1, projectId, TEST_USER_2.id, "viewer");

  // Two groups so the group join + board ordering (group position, then task
  // position) is exercised, not just a constant column.
  const todoGroupId = await seedTaskGroup(d1, projectId, { name: "To Do" });
  const doneGroupId = await seedTaskGroup(d1, projectId, { name: "Done" });

  // Row 1: every column populated. dueDate is stored as a UTC-midnight
  // timestamp and must come back as the YYYY-MM-DD slice; cost is integer
  // cents and must render as fixed two-decimal currency units.
  const fullTaskId = await seedTask(d1, projectId, todoGroupId, {
    title: "Ship exporter",
    assigneeId: TEST_USER.id,
    dueDate: new Date("2026-03-05"),
    priority: "high",
    cost: 1050,
    completed: false,
  });
  // Labels inserted in REVERSE alphabetical order to prove the handler's
  // ORDER BY name (not insertion order) drives the `;`-joined cell.
  const urgentLabelId = await seedLabel(d1, projectId, "urgent");
  const bugLabelId = await seedLabel(d1, projectId, "bug");
  await seedTaskLabelRow(fullTaskId, urgentLabelId);
  await seedTaskLabelRow(fullTaskId, bugLabelId);

  // Row 2: the injection probe (user-controlled title starting with `=`)
  // doubling as the all-nullable-fields case: no assignee, no due date,
  // no labels, null cost.
  await seedTask(d1, projectId, doneGroupId, {
    title: "=2+2",
    completed: true,
  });

  // A project with groups-but-no-tasks: export must still be a valid CSV
  // (headers-only), not a 404 or an empty body.
  emptyProjectId = await seedProject(d1, workspaceId, { name: "Empty Project" });
  await seedTaskGroup(d1, emptyProjectId, { name: "Backlog" });
});

afterAll(async () => {
  await dispose();
});

/**
 * Mount the handler behind the real auth middleware chain. Passing no user
 * mounts `fakeEnv` (db only, no identity) so `requireAuth` itself produces
 * the 401 — the same path an anonymous request takes in production.
 */
function createApp(user?: typeof TEST_USER | typeof TEST_USER_2) {
  const app = new Hono<AppEnv>();
  const env = user ? fakeAuth(d1, user) : fakeEnv(d1);
  app.get(
    "/projects/:projectId/export/csv",
    env,
    requireAuth,
    requireProjectAccess(),
    exportProjectCsv,
  );
  return app;
}

describe("exportProjectCsv", () => {
  it("emits the exact CSV: header row, hardened title, joined labels, empty nullables, sliced date, cents as decimal", async () => {
    const app = createApp(TEST_USER);
    const res = await app.request(`/projects/${projectId}/export/csv`);

    expect(res.status).toBe(200);
    const body = await res.text();
    const expected =
      [
        "title,group,assignee_email,due_date,priority,labels,completed,cost",
        "Ship exporter,To Do,test@example.com,2026-03-05,high,bug;urgent,false,10.50",
        "'=2+2,Done,,,none,,true,",
      ].join("\r\n") + "\r\n";
    expect(body).toBe(expected);
  });

  it("sets text/csv Content-Type and an attachment Content-Disposition named after the project", async () => {
    const app = createApp(TEST_USER);
    const res = await app.request(`/projects/${projectId}/export/csv`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="CSV Export Project.csv"',
    );
  });

  it("allows a project viewer to export (200) — read access is the only gate", async () => {
    const app = createApp(TEST_USER_2); // viewer on the main project
    const res = await app.request(`/projects/${projectId}/export/csv`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.startsWith("title,group,assignee_email,")).toBe(true);
    // The viewer receives the same hardened content as the owner.
    expect(body).toContain("'=2+2");
  });

  it("returns 403 for a workspace member with no project membership", async () => {
    const app = createApp(TEST_USER_2); // no membership on the empty project
    const res = await app.request(`/projects/${emptyProjectId}/export/csv`);

    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = createApp(); // no user in context
    const res = await app.request(`/projects/${projectId}/export/csv`);

    expect(res.status).toBe(401);
  });

  it("returns 404 for a project that does not exist", async () => {
    const app = createApp(TEST_USER);
    const res = await app.request(`/projects/${crypto.randomUUID()}/export/csv`);

    expect(res.status).toBe(404);
  });

  it("returns a headers-only CSV for a project with no tasks", async () => {
    const app = createApp(TEST_USER);
    const res = await app.request(`/projects/${emptyProjectId}/export/csv`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "title,group,assignee_email,due_date,priority,labels,completed,cost\r\n",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Empty Project.csv"',
    );
  });
});
