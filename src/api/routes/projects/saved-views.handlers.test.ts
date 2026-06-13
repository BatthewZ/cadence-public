import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SavedView, SavedViewState } from "../../../shared/schemas/saved-view";
import {
  createSavedViewSchema,
  MAX_SAVED_VIEWS_PER_PROJECT_USER,
  updateSavedViewSchema,
} from "../../../shared/schemas/saved-view";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedProject,
  seedProjectMember,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from "./saved-views.handlers";

/**
 * Saved-view handler tests.
 *
 * These run against a real in-memory D1 (not mocks) because the behaviors
 * that matter are SQL-level: the `LOWER(name)` duplicate probe, the
 * creator-scoped WHERE clauses, the json-mode round-trip of `state`, and the
 * fractional-index ordering. The two contracts most worth defending:
 *
 * 1. **Cross-user 404, never 403** — a teammate's view id must be
 *    indistinguishable from a missing one. Two apps authed as different
 *    users hit the SAME project to prove it.
 * 2. **Unknown `state.params` keys round-trip verbatim** — the
 *    forward-compatibility contract that lets newer clients save params this
 *    server has never heard of without an older deployment corrupting them.
 *
 * Also pinned here (so a future refactor cannot silently regress it): saved
 * view mutations must NOT bump `project.updatedAt` — they are private
 * bookmarks, and bumping it would invalidate freshness polling for the whole
 * team.
 */

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let otherProjectId: string;

type TestUser = typeof TEST_USER | typeof TEST_USER_2;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");

  projectId = await seedProject(d1, workspaceId, { name: "Saved Views Project" });
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  await seedProjectMember(d1, projectId, TEST_USER_2.id, "member");

  // A second project both users can access — used to prove a valid view id
  // 404s when addressed through the WRONG project's path.
  otherProjectId = await seedProject(d1, workspaceId, { name: "Other Project" });
  await seedProjectMember(d1, otherProjectId, TEST_USER.id, "admin");
});

afterAll(async () => {
  await dispose();
});

/**
 * Build a test app authed as the given user. Route middleware
 * (requireProjectAccess) is exercised by its own test suite; here fakeAuth
 * supplies the user/projectAccess context so the handlers' creator-scoping
 * is what carries the isolation guarantees under test.
 */
function createApp(user: TestUser) {
  const app = new Hono<AppEnv>();
  const auth = fakeAuth(d1, user, {
    projectAccess: { role: "member", source: "project" },
  });

  app.get("/projects/:projectId/views", auth, listSavedViews);
  app.post(
    "/projects/:projectId/views",
    auth,
    validateBody(createSavedViewSchema),
    createSavedView,
  );
  app.patch(
    "/projects/:projectId/views/:viewId",
    auth,
    validateBody(updateSavedViewSchema),
    updateSavedView,
  );
  app.delete("/projects/:projectId/views/:viewId", auth, deleteSavedView);

  return app;
}

const baseState: SavedViewState = {
  tab: "board",
  params: { assignee: "user-a,user-b", priority: "high" },
};

async function createView(
  app: Hono<AppEnv>,
  pid: string,
  name: string,
  state: SavedViewState = baseState,
): Promise<SavedView> {
  const res = await app.request(
    `/projects/${pid}/views`,
    jsonRequest("POST", `/projects/${pid}/views`, { name, state }),
  );
  expect(res.status).toBe(201);
  const body = await res.json<{ view: SavedView }>();
  return body.view;
}

async function listViews(app: Hono<AppEnv>, pid: string): Promise<SavedView[]> {
  const res = await app.request(`/projects/${pid}/views`);
  expect(res.status).toBe(200);
  const body = await res.json<{ views: SavedView[] }>();
  return body.views;
}

/**
 * Seed a saved view directly via SQL — used by the cap test, where creating
 * 20 rows through the HTTP handler (3 batched reads + 1 insert each) would
 * be needlessly slow. Timestamps are Unix SECONDS to match Drizzle's
 * integer-timestamp convention (see seed.ts's toSec rationale).
 */
async function seedSavedViewRow(
  pid: string,
  creatorId: string,
  name: string,
  position: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await d1
    .prepare(
      "INSERT INTO saved_view (id, projectId, creatorId, name, state, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, pid, creatorId, name, JSON.stringify(baseState), position, now, now)
    .run();
  return id;
}

describe("createSavedView", () => {
  it("creates a view and round-trips state through storage, preserving unknown param keys", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Create RT" });
    const app = createApp(TEST_USER);

    // "sort" is NOT a param this server knows about — the forward-compat
    // contract says it must survive storage verbatim anyway.
    const state: SavedViewState = {
      tab: "timeline",
      params: { assignee: "u1,u2", groupBy: "assignee", sort: "manual" },
    };

    const created = await createView(app, pid, "My Urgent", state);

    expect(created.id).toBeTruthy();
    expect(created.projectId).toBe(pid);
    expect(created.creatorId).toBe(TEST_USER.id);
    expect(created.name).toBe("My Urgent");
    expect(created.position).toBeTruthy();
    // API contract: ISO date strings, not epoch numbers.
    expect(typeof created.createdAt).toBe("string");
    expect(new Date(created.createdAt).getTime()).not.toBeNaN();
    expect(created.updatedAt).toBe(created.createdAt);

    // Assert against a fresh GET, not the POST echo — this proves the JSON
    // column stored and re-hydrated the snapshot, unknown key included.
    const [fetched] = await listViews(app, pid);
    expect(fetched.state).toEqual(state);
    expect(fetched.state.params.sort).toBe("manual");
  });

  it("returns 409 for a duplicate name, case-insensitively", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Create Dup" });
    const app = createApp(TEST_USER);

    await createView(app, pid, "Sprint Focus");

    const res = await app.request(
      `/projects/${pid}/views`,
      jsonRequest("POST", `/projects/${pid}/views`, {
        name: "SPRINT focus",
        state: baseState,
      }),
    );
    expect(res.status).toBe(409);
  });

  it("allows the SAME name for DIFFERENT users in the same project", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Create Per-User" });

    const created1 = await createView(createApp(TEST_USER), pid, "My Urgent");
    // Views are private: uniqueness is per (project, creator), so user2
    // reusing user1's name must succeed.
    const created2 = await createView(createApp(TEST_USER_2), pid, "My Urgent");

    expect(created1.creatorId).toBe(TEST_USER.id);
    expect(created2.creatorId).toBe(TEST_USER_2.id);
    expect(created1.id).not.toBe(created2.id);
  });

  it(`returns 400 when creating view ${MAX_SAVED_VIEWS_PER_PROJECT_USER + 1} for the same (project, user)`, async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Cap Project" });

    for (let i = 1; i <= MAX_SAVED_VIEWS_PER_PROJECT_USER; i++) {
      await seedSavedViewRow(
        pid,
        TEST_USER.id,
        `Cap View ${i}`,
        `a${String(i).padStart(6, "0")}`,
      );
    }

    const app = createApp(TEST_USER);
    const res = await app.request(
      `/projects/${pid}/views`,
      jsonRequest("POST", `/projects/${pid}/views`, {
        name: "One Too Many",
        state: baseState,
      }),
    );
    expect(res.status).toBe(400);

    // The cap is per (project, user): a DIFFERENT user is unaffected.
    const created = await createView(createApp(TEST_USER_2), pid, "One Too Many");
    expect(created.creatorId).toBe(TEST_USER_2.id);
  });

  it("does NOT bump project.updatedAt (freshness divergence from labels)", async () => {
    const before = await d1
      .prepare("SELECT updatedAt FROM project WHERE id = ?")
      .bind(projectId)
      .first<{ updatedAt: number }>();

    const app = createApp(TEST_USER);
    const created = await createView(app, projectId, "Freshness Probe");
    await app.request(
      `/projects/${projectId}/views/${created.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/views/${created.id}`, {
        name: "Freshness Probe 2",
      }),
    );
    await app.request(
      `/projects/${projectId}/views/${created.id}`,
      jsonRequest("DELETE", `/projects/${projectId}/views/${created.id}`),
    );

    const after = await d1
      .prepare("SELECT updatedAt FROM project WHERE id = ?")
      .bind(projectId)
      .first<{ updatedAt: number }>();

    // Personal bookmarks must never invalidate the team's freshness polling.
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});

describe("listSavedViews", () => {
  it("orders views by position (creation order)", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "List Order" });
    const app = createApp(TEST_USER);

    const first = await createView(app, pid, "First");
    const second = await createView(app, pid, "Second");
    const third = await createView(app, pid, "Third");

    const views = await listViews(app, pid);
    expect(views.map((v) => v.name)).toEqual(["First", "Second", "Third"]);
    // The ordering must come from the fractional index, not insert order.
    expect(first.position < second.position).toBe(true);
    expect(second.position < third.position).toBe(true);
  });

  it("only returns the caller's own views (creator isolation)", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "List Isolation" });
    const app1 = createApp(TEST_USER);
    const app2 = createApp(TEST_USER_2);

    await createView(app1, pid, "User1 View A");
    await createView(app1, pid, "User1 View B");
    await createView(app2, pid, "User2 View");

    const user1Views = await listViews(app1, pid);
    expect(user1Views.map((v) => v.name).sort()).toEqual(["User1 View A", "User1 View B"]);
    expect(user1Views.every((v) => v.creatorId === TEST_USER.id)).toBe(true);

    const user2Views = await listViews(app2, pid);
    expect(user2Views.map((v) => v.name)).toEqual(["User2 View"]);
    expect(user2Views[0].creatorId).toBe(TEST_USER_2.id);
  });
});

describe("updateSavedView", () => {
  it("renames a view", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Update Rename" });
    const app = createApp(TEST_USER);
    const created = await createView(app, pid, "Old Name");

    const res = await app.request(
      `/projects/${pid}/views/${created.id}`,
      jsonRequest("PATCH", `/projects/${pid}/views/${created.id}`, {
        name: "New Name",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ view: SavedView }>();
    expect(body.view.name).toBe("New Name");
    expect(body.view.state).toEqual(baseState);
  });

  it("updates state (last-write-wins), preserves unknown keys, and bumps updatedAt", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Update State" });
    // Seed with an OLD timestamp so the updatedAt bump is observable despite
    // second-granularity storage (a create-then-patch in the same second
    // would make `updatedAt > createdAt` unprovable).
    const id = crypto.randomUUID();
    const oldSec = Math.floor(new Date("2025-01-01T00:00:00Z").getTime() / 1000);
    await d1
      .prepare(
        "INSERT INTO saved_view (id, projectId, creatorId, name, state, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        pid,
        TEST_USER.id,
        "Stale View",
        JSON.stringify(baseState),
        "a0",
        oldSec,
        oldSec,
      )
      .run();

    const app = createApp(TEST_USER);
    const newState: SavedViewState = {
      tab: "calendar",
      params: { completed: "false", futureParam: "kept-verbatim" },
    };

    const res = await app.request(
      `/projects/${pid}/views/${id}`,
      jsonRequest("PATCH", `/projects/${pid}/views/${id}`, { state: newState }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ view: SavedView }>();
    expect(body.view.state).toEqual(newState);
    expect(body.view.name).toBe("Stale View");
    expect(new Date(body.view.updatedAt).getTime()).toBeGreaterThan(
      new Date(body.view.createdAt).getTime(),
    );

    // And the new snapshot (unknown key included) survives a storage read.
    const [fetched] = await listViews(app, pid);
    expect(fetched.state.params.futureParam).toBe("kept-verbatim");
  });

  it("returns 409 when renaming to another of the caller's view names (case-insensitive)", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Update Dup" });
    const app = createApp(TEST_USER);

    await createView(app, pid, "View A");
    const viewB = await createView(app, pid, "View B");

    const res = await app.request(
      `/projects/${pid}/views/${viewB.id}`,
      jsonRequest("PATCH", `/projects/${pid}/views/${viewB.id}`, {
        name: "view a",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("allows renaming to the same name with only a case change (pinned: case-correction is legal)", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Update Case" });
    const app = createApp(TEST_USER);
    const created = await createView(app, pid, "my urgent");

    // The LOWER() duplicate probe matches the row's OWN name here; the
    // changed-name guard must recognize this as a self-match, not a
    // collision, so users can fix capitalization in place.
    const res = await app.request(
      `/projects/${pid}/views/${created.id}`,
      jsonRequest("PATCH", `/projects/${pid}/views/${created.id}`, {
        name: "My Urgent",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ view: SavedView }>();
    expect(body.view.name).toBe("My Urgent");
  });

  it("treats a rename to the identical name as a no-op rename, not a 409", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Update Same" });
    const app = createApp(TEST_USER);
    const created = await createView(app, pid, "Same Name");

    const res = await app.request(
      `/projects/${pid}/views/${created.id}`,
      jsonRequest("PATCH", `/projects/${pid}/views/${created.id}`, {
        name: "Same Name",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ view: SavedView }>();
    expect(body.view.name).toBe("Same Name");
  });

  it("does not treat another user's same-named view as a duplicate", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Update Cross Dup" });
    await createView(createApp(TEST_USER_2), pid, "Shared Name");

    const app = createApp(TEST_USER);
    const mine = await createView(app, pid, "Mine");
    const res = await app.request(
      `/projects/${pid}/views/${mine.id}`,
      jsonRequest("PATCH", `/projects/${pid}/views/${mine.id}`, {
        name: "Shared Name",
      }),
    );

    // Uniqueness is per-creator, so colliding with a TEAMMATE'S private
    // view name must succeed.
    expect(res.status).toBe(200);
  });

  it("returns 404 for another user's view id (indistinguishable from missing)", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Update Cross 404" });
    const theirs = await createView(createApp(TEST_USER_2), pid, "Private View");

    const res = await createApp(TEST_USER).request(
      `/projects/${pid}/views/${theirs.id}`,
      jsonRequest("PATCH", `/projects/${pid}/views/${theirs.id}`, {
        name: "Hijacked",
      }),
    );

    // 404, NOT 403: a 403 would confirm to user1 that the guessed id exists.
    expect(res.status).toBe(404);

    // And the victim's view is untouched.
    const [unchanged] = await listViews(createApp(TEST_USER_2), pid);
    expect(unchanged.name).toBe("Private View");
  });

  it("returns 404 for a missing view id", async () => {
    const app = createApp(TEST_USER);
    const res = await app.request(
      `/projects/${projectId}/views/nonexistent`,
      jsonRequest("PATCH", `/projects/${projectId}/views/nonexistent`, {
        name: "Nope",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the view id belongs to a different project", async () => {
    const app = createApp(TEST_USER);
    const created = await createView(app, projectId, "Wrong Project Probe");

    const res = await app.request(
      `/projects/${otherProjectId}/views/${created.id}`,
      jsonRequest("PATCH", `/projects/${otherProjectId}/views/${created.id}`, {
        name: "Nope",
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("deleteSavedView", () => {
  it("deletes the caller's own view", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Delete Own" });
    const app = createApp(TEST_USER);
    const created = await createView(app, pid, "Delete Me");

    const res = await app.request(
      `/projects/${pid}/views/${created.id}`,
      jsonRequest("DELETE", `/projects/${pid}/views/${created.id}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; deletedId: string }>();
    expect(body.ok).toBe(true);
    expect(body.deletedId).toBe(created.id);

    const row = await d1
      .prepare("SELECT id FROM saved_view WHERE id = ?")
      .bind(created.id)
      .first();
    expect(row).toBeNull();
  });

  it("returns 404 for another user's view id and leaves the row intact", async () => {
    const pid = await seedProject(d1, workspaceId, { name: "Delete Cross 404" });
    const theirs = await createView(createApp(TEST_USER_2), pid, "Their View");

    const res = await createApp(TEST_USER).request(
      `/projects/${pid}/views/${theirs.id}`,
      jsonRequest("DELETE", `/projects/${pid}/views/${theirs.id}`),
    );
    expect(res.status).toBe(404);

    const row = await d1
      .prepare("SELECT id FROM saved_view WHERE id = ?")
      .bind(theirs.id)
      .first();
    expect(row).not.toBeNull();
  });

  it("returns 404 for a missing view id", async () => {
    const app = createApp(TEST_USER);
    const res = await app.request(
      `/projects/${projectId}/views/nonexistent`,
      jsonRequest("DELETE", `/projects/${projectId}/views/nonexistent`),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the view id belongs to a different project", async () => {
    const app = createApp(TEST_USER);
    const created = await createView(app, projectId, "Delete Wrong Project");

    const res = await app.request(
      `/projects/${otherProjectId}/views/${created.id}`,
      jsonRequest("DELETE", `/projects/${otherProjectId}/views/${created.id}`),
    );
    expect(res.status).toBe(404);
  });
});
