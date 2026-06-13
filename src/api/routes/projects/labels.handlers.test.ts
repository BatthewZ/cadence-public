import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLabelSchema, updateLabelSchema } from "../../../shared/schemas/label";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedLabel,
  seedProject,
  seedProjectMember,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  createLabel,
  deleteLabel,
  listLabels,
  listWorkspaceLabels,
  updateLabel,
} from "./labels.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
});

afterAll(async () => {
  await dispose();
});

function createApp() {
  const app = new Hono<AppEnv>();
  const auth = fakeAuth(d1, TEST_USER, {
    projectAccess: { role: "admin", source: "workspace" },
    currentProject: { id: projectId, workspaceId },
  });

  app.post(
    "/projects/:projectId/labels",
    auth,
    validateBody(createLabelSchema),
    createLabel,
  );
  app.get("/projects/:projectId/labels", auth, listLabels);
  app.patch(
    "/projects/:projectId/labels/:labelId",
    auth,
    validateBody(updateLabelSchema),
    updateLabel,
  );
  app.delete("/projects/:projectId/labels/:labelId", auth, deleteLabel);

  return app;
}

describe("createLabel", () => {
  it("creates a label with valid name and color", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Bug",
        color: "#ef4444",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ label: { id: string; name: string; color: string } }>();
    expect(body.label.name).toBe("Bug");
    expect(body.label.color).toBe("#ef4444");
  });

  it("returns 409 for duplicate label name (case-insensitive)", async () => {
    const app = createApp();

    // Create first
    await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Duplicate Test",
        color: "#3b82f6",
      }),
    );

    // Try duplicate
    const res = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "duplicate test",
        color: "#ef4444",
      }),
    );

    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid color format", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Invalid Color",
        color: "red",
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("listLabels", () => {
  it("returns labels with task counts sorted by name", async () => {
    const app = createApp();
    const res = await app.request(`/projects/${projectId}/labels`);

    expect(res.status).toBe(200);
    const body = await res.json<{
      labels: Array<{ id: string; name: string; color: string; taskCount: number }>;
    }>();
    expect(Array.isArray(body.labels)).toBe(true);

    // Labels should be sorted by name
    const names = body.labels.map((l) => l.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("updateLabel", () => {
  it("updates label name", async () => {
    const app = createApp();

    // Create a label first
    const createRes = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Update Me",
        color: "#22c55e",
      }),
    );
    const { label: created } = await createRes.json<{ label: { id: string } }>();

    // Update it
    const res = await app.request(
      `/projects/${projectId}/labels/${created.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/${created.id}`, {
        name: "Updated Name",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ label: { name: string } }>();
    expect(body.label.name).toBe("Updated Name");
  });

  it("updates label color", async () => {
    const app = createApp();

    // Create a label
    const createRes = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Color Update",
        color: "#3b82f6",
      }),
    );
    const { label: created } = await createRes.json<{ label: { id: string } }>();

    // Update color
    const res = await app.request(
      `/projects/${projectId}/labels/${created.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/${created.id}`, {
        color: "#ef4444",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ label: { color: string } }>();
    expect(body.label.color).toBe("#ef4444");
  });

  it("returns 409 when updating to a duplicate name", async () => {
    const app = createApp();

    // Create two labels
    await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Label A",
        color: "#3b82f6",
      }),
    );
    const createRes2 = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Label B",
        color: "#ef4444",
      }),
    );
    const { label: labelB } = await createRes2.json<{ label: { id: string } }>();

    // Try to rename B to A
    const res = await app.request(
      `/projects/${projectId}/labels/${labelB.id}`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/${labelB.id}`, {
        name: "Label A",
      }),
    );

    expect(res.status).toBe(409);
  });

  it("returns 404 for non-existent label", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels/nonexistent`,
      jsonRequest("PATCH", `/projects/${projectId}/labels/nonexistent`, {
        name: "New Name",
      }),
    );

    expect(res.status).toBe(404);
  });
});

describe("deleteLabel", () => {
  it("deletes an existing label", async () => {
    const app = createApp();

    // Create a label
    const createRes = await app.request(
      `/projects/${projectId}/labels`,
      jsonRequest("POST", `/projects/${projectId}/labels`, {
        name: "Delete Me",
        color: "#6b7280",
      }),
    );
    const { label: created } = await createRes.json<{ label: { id: string } }>();

    // Delete it
    const res = await app.request(
      `/projects/${projectId}/labels/${created.id}`,
      jsonRequest("DELETE", `/projects/${projectId}/labels/${created.id}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; deletedId: string }>();
    expect(body.ok).toBe(true);
    expect(body.deletedId).toBe(created.id);

    // Verify it's gone
    const row = await d1.prepare("SELECT id FROM label WHERE id = ?").bind(created.id).first();
    expect(row).toBeNull();
  });

  it("returns 404 for non-existent label", async () => {
    const app = createApp();
    const res = await app.request(
      `/projects/${projectId}/labels/nonexistent`,
      jsonRequest("DELETE", `/projects/${projectId}/labels/nonexistent`),
    );

    expect(res.status).toBe(404);
  });
});

/**
 * Workspace-level label listing (GET /workspaces/:workspaceId/labels).
 *
 * These tests matter because the endpoint feeds the My Tasks label filter:
 * a wrong dedupe key would show "Bug" and "bug" as two filter options, a
 * missing status filter would offer dead options from archived projects,
 * and — most importantly — a broken visibility branch would leak label
 * names from projects a plain member cannot open. Runs against a real
 * in-memory D1 so the GROUP BY LOWER(name) / MIN() SQL is exercised for
 * real, not mocked.
 */
describe("listWorkspaceLabels", () => {
  let wsId: string;
  let emptyMembershipWsId: string;

  beforeAll(async () => {
    await seedUser(d1, TEST_USER_2);

    // Fresh workspace so labels created by the CRUD tests above (in the
    // file-level shared project) cannot leak into these assertions.
    wsId = await seedWorkspace(d1, TEST_USER.id);
    await seedWorkspaceMember(d1, wsId, TEST_USER_2.id, "member");

    // Project A: both users are direct members.
    const projectA = await seedProject(d1, wsId, { name: "WS Labels A" });
    await seedProjectMember(d1, projectA, TEST_USER.id, "admin");
    await seedProjectMember(d1, projectA, TEST_USER_2.id, "member");

    // Project B: only user1 — its labels must stay invisible to user2.
    const projectB = await seedProject(d1, wsId, { name: "WS Labels B" });
    await seedProjectMember(d1, projectB, TEST_USER.id, "admin");

    // Archived project: user2 IS a member, so its exclusion below proves
    // the status filter (not membership) is what hides it.
    const archivedProject = await seedProject(d1, wsId, {
      name: "WS Labels Archived",
      status: "archived",
    });
    await seedProjectMember(d1, archivedProject, TEST_USER.id, "admin");
    await seedProjectMember(d1, archivedProject, TEST_USER_2.id, "member");

    await seedLabel(d1, projectA, "Bug", "#ef4444");
    await seedLabel(d1, projectA, "alpha", "#111111");
    await seedLabel(d1, projectA, "Zeta", "#222222");
    // Case-variant of project A's "Bug" — must collapse into one entry.
    // Its color (#00aaff) sorts before #ef4444 so MIN(color) is observable.
    await seedLabel(d1, projectB, "bug", "#00aaff");
    await seedLabel(d1, projectB, "Backend", "#333333");
    await seedLabel(d1, archivedProject, "Archived Only", "#999999");

    // Workspace where user2 belongs to no project at all — exercises the
    // empty-visibility early return.
    emptyMembershipWsId = await seedWorkspace(d1, TEST_USER.id);
    await seedWorkspaceMember(d1, emptyMembershipWsId, TEST_USER_2.id, "member");
    const lonelyProject = await seedProject(d1, emptyMembershipWsId, {
      name: "Lonely Project",
    });
    await seedProjectMember(d1, lonelyProject, TEST_USER.id, "admin");
    await seedLabel(d1, lonelyProject, "Hidden", "#000000");
  });

  function wsLabelsApp(
    user: typeof TEST_USER | typeof TEST_USER_2,
    role: "owner" | "admin" | "member",
    workspaceId: string,
  ) {
    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/labels",
      fakeAuth(d1, user, {
        workspaceMembership: { id: "wm-labels", workspaceId, role },
      }),
      listWorkspaceLabels,
    );
    return app;
  }

  async function fetchLabels(
    user: typeof TEST_USER | typeof TEST_USER_2,
    role: "owner" | "admin" | "member",
    workspaceId: string,
  ) {
    const app = wsLabelsApp(user, role, workspaceId);
    const res = await app.request(`/workspaces/${workspaceId}/labels`);
    expect(res.status).toBe(200);
    const body = await res.json<{ labels: Array<{ name: string; color: string }> }>();
    return body.labels;
  }

  it("dedupes case-variant names across projects into a single entry", async () => {
    const labels = await fetchLabels(TEST_USER, "owner", wsId);

    const bugEntries = labels.filter((l) => l.name.toLowerCase() === "bug");
    expect(bugEntries).toHaveLength(1);
    // MIN over {"Bug", "bug"} is "Bug" (uppercase sorts first in SQLite's
    // binary collation) and MIN over {"#ef4444", "#00aaff"} is "#00aaff" —
    // deterministic regardless of which project's row was inserted first.
    expect(bugEntries[0].name).toBe("Bug");
    expect(bugEntries[0].color).toBe("#00aaff");
  });

  it("orders deduped labels case-insensitively by name", async () => {
    const labels = await fetchLabels(TEST_USER, "owner", wsId);

    // Owner sees both active projects: alpha/Bug/Zeta (A) + bug/Backend (B),
    // deduped to four entries. Binary ordering would put "Backend", "Bug"
    // and "Zeta" before "alpha"; case-insensitive ordering must not.
    expect(labels.map((l) => l.name)).toEqual(["alpha", "Backend", "Bug", "Zeta"]);
  });

  it("excludes labels from archived projects", async () => {
    const labels = await fetchLabels(TEST_USER, "owner", wsId);

    // Owner can see every project, so only the status filter can hide this.
    expect(labels.find((l) => l.name === "Archived Only")).toBeUndefined();
  });

  it("restricts non-elevated members to labels from their own projects", async () => {
    const labels = await fetchLabels(TEST_USER_2, "member", wsId);

    // user2 is only a member of project A: no "Backend" leak from project B,
    // and "Bug" keeps project A's color because project B's row is invisible.
    expect(labels.map((l) => l.name)).toEqual(["alpha", "Bug", "Zeta"]);
    expect(labels.find((l) => l.name === "Bug")?.color).toBe("#ef4444");
    // Archived exclusion also applies on the membership branch — user2 is a
    // member of the archived project but must not see "Archived Only".
    expect(labels.find((l) => l.name === "Archived Only")).toBeUndefined();
  });

  it("returns an empty array for members with no project memberships", async () => {
    const labels = await fetchLabels(TEST_USER_2, "member", emptyMembershipWsId);

    expect(labels).toEqual([]);
  });
});
