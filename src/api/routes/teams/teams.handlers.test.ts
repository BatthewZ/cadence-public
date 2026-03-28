/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for team handler functions.
 *
 * These tests exercise the full handler logic against a real in-memory D1
 * database so that Drizzle ORM queries, validation middleware, and HTTP
 * response shapes are all verified together — avoiding the brittleness of
 * mocking individual query chains.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addTeamMemberSchema, createTeamSchema, updateTeamSchema } from "../../../shared/schemas/team";
import type { AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedTeam,
  seedTeamMember,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeamDetail,
  listTeams,
  removeTeamMember,
  updateTeam,
} from "./teams.handlers";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);

  workspaceId = await seedWorkspace(d1, TEST_USER.id, { id: "ws-1" });
  // TEST_USER is already the workspace owner via seedWorkspace.
  // Add TEST_USER_2 as a workspace member so they can be added to teams.
  await seedWorkspaceMember(d1, workspaceId, TEST_USER_2.id, "member");
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// createTeam
// ---------------------------------------------------------------------------

describe("createTeam", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.post(
      "/workspaces/:workspaceId/teams",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      validateBody(createTeamSchema),
      createTeam,
    );
    return app;
  }

  it("creates a team and returns 201", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams`,
      jsonRequest("POST", `/workspaces/${workspaceId}/teams`, {
        name: "Engineering",
        description: "The engineering team",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ team: { id: string; name: string; description: string; workspaceId: string } }>();
    expect(body.team).toMatchObject({
      name: "Engineering",
      description: "The engineering team",
      workspaceId,
    });
    expect(body.team.id).toBeDefined();
  });

  it("creates a team without optional description", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams`,
      jsonRequest("POST", `/workspaces/${workspaceId}/teams`, {
        name: "Design",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ team: { name: string; workspaceId: string } }>();
    expect(body.team).toMatchObject({
      name: "Design",
      workspaceId,
    });
  });

  it("returns 400 when name is missing", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams`,
      jsonRequest("POST", `/workspaces/${workspaceId}/teams`, {}),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: unknown[] }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("returns 400 when name is empty string", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams`,
      jsonRequest("POST", `/workspaces/${workspaceId}/teams`, { name: "" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });
});

// ---------------------------------------------------------------------------
// listTeams
// ---------------------------------------------------------------------------

describe("listTeams", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/teams",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      listTeams,
    );
    return app;
  }

  it("returns teams in a workspace with member counts", async () => {
    // Seed a team with known members for deterministic assertions
    const teamId = await seedTeam(d1, workspaceId, { id: "list-team-1", name: "Backend" });
    await seedTeamMember(d1, teamId, TEST_USER.id, "lead");
    await seedTeamMember(d1, teamId, TEST_USER_2.id, "member");

    const app = createApp();
    const res = await app.request(`/workspaces/${workspaceId}/teams`);

    expect(res.status).toBe(200);
    const body = await res.json<{ teams: { id: string; name: string; memberCount: number }[] }>();
    expect(Array.isArray(body.teams)).toBe(true);

    const backendTeam = body.teams.find((t: { id: string }) => t.id === teamId);
    expect(backendTeam).toBeDefined();
    expect(backendTeam!.name).toBe("Backend");
    expect(backendTeam!.memberCount).toBe(2);
  });

  it("returns empty array when workspace has no teams", async () => {
    // Use a separate workspace with no teams
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, { id: "ws-empty" });

    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/teams",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-empty", role: "owner" } }),
      listTeams,
    );

    const res = await app.request(`/workspaces/${emptyWsId}/teams`);

    expect(res.status).toBe(200);
    const body = await res.json<{ teams: unknown[] }>();
    expect(body.teams).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTeamDetail
// ---------------------------------------------------------------------------

describe("getTeamDetail", () => {
  let detailTeamId: string;

  beforeAll(async () => {
    detailTeamId = await seedTeam(d1, workspaceId, {
      id: "detail-team-1",
      name: "Detail Team",
    });
    await seedTeamMember(d1, detailTeamId, TEST_USER.id, "lead");
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.get(
      "/workspaces/:workspaceId/teams/:teamId",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      getTeamDetail,
    );
    return app;
  }

  it("returns team detail with members", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${detailTeamId}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ name: string; members: { userId: string; role: string; user: { id: string; name: string; email: string } }[] }>();
    expect(body.name).toBe("Detail Team");
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.length).toBe(1);
    expect(body.members[0].userId).toBe(TEST_USER.id);
    expect(body.members[0].role).toBe("lead");
    expect(body.members[0].user).toMatchObject({
      id: TEST_USER.id,
      name: TEST_USER.name,
      email: TEST_USER.email,
    });
  });

  it("returns 404 for nonexistent team", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/nonexistent-id`,
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Team not found");
  });

  it("returns 404 when team belongs to a different workspace", async () => {
    const otherWsId = await seedWorkspace(d1, TEST_USER.id, { id: "ws-other" });
    const otherTeamId = await seedTeam(d1, otherWsId, { name: "Other WS Team" });

    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${otherTeamId}`,
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Team not found");
  });
});

// ---------------------------------------------------------------------------
// updateTeam
// ---------------------------------------------------------------------------

describe("updateTeam", () => {
  let updateTeamId: string;

  beforeAll(async () => {
    updateTeamId = await seedTeam(d1, workspaceId, {
      id: "update-team-1",
      name: "Original Name",
    });
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.patch(
      "/workspaces/:workspaceId/teams/:teamId",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      validateBody(updateTeamSchema),
      updateTeam,
    );
    return app;
  }

  it("updates team name", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${updateTeamId}`,
      jsonRequest("PATCH", `/workspaces/${workspaceId}/teams/${updateTeamId}`, {
        name: "Updated Name",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ team: { name: string } }>();
    expect(body.team.name).toBe("Updated Name");
  });

  it("updates team description", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${updateTeamId}`,
      jsonRequest("PATCH", `/workspaces/${workspaceId}/teams/${updateTeamId}`, {
        description: "A new description",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ team: { description: string | null } }>();
    expect(body.team.description).toBe("A new description");
  });

  it("can set description to null", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${updateTeamId}`,
      jsonRequest("PATCH", `/workspaces/${workspaceId}/teams/${updateTeamId}`, {
        description: null,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ team: { description: string | null } }>();
    expect(body.team.description).toBeNull();
  });

  it("returns 404 for nonexistent team", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/nonexistent`,
      jsonRequest("PATCH", `/workspaces/${workspaceId}/teams/nonexistent`, {
        name: "Whatever",
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Team not found");
  });
});

// ---------------------------------------------------------------------------
// deleteTeam
// ---------------------------------------------------------------------------

describe("deleteTeam", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.delete(
      "/workspaces/:workspaceId/teams/:teamId",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      deleteTeam,
    );
    return app;
  }

  it("deletes an existing team", async () => {
    const teamId = await seedTeam(d1, workspaceId, { name: "Deletable Team" });

    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${teamId}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify team is actually gone by querying the detail handler
    const getApp = new Hono<AppEnv>();
    getApp.get(
      "/workspaces/:workspaceId/teams/:teamId",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      getTeamDetail,
    );

    const verifyRes = await getApp.request(
      `/workspaces/${workspaceId}/teams/${teamId}`,
    );
    expect(verifyRes.status).toBe(404);
  });

  it("returns 404 for nonexistent team", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/nonexistent`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Team not found");
  });
});

// ---------------------------------------------------------------------------
// addTeamMember
// ---------------------------------------------------------------------------

describe("addTeamMember", () => {
  let memberTeamId: string;

  beforeAll(async () => {
    memberTeamId = await seedTeam(d1, workspaceId, {
      id: "member-team-1",
      name: "Member Team",
    });
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.post(
      "/workspaces/:workspaceId/teams/:teamId/members",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      validateBody(addTeamMemberSchema),
      addTeamMember,
    );
    return app;
  }

  it("adds a workspace member to the team and returns 201", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
      jsonRequest(
        "POST",
        `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
        { userId: TEST_USER_2.id, role: "member" },
      ),
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ member: { id: string; teamId: string; userId: string; role: string } }>();
    expect(body.member).toMatchObject({
      teamId: memberTeamId,
      userId: TEST_USER_2.id,
      role: "member",
    });
    expect(body.member.id).toBeDefined();
  });

  it("returns 409 when adding a duplicate member", async () => {
    // TEST_USER_2 was already added in the previous test
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
      jsonRequest(
        "POST",
        `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
        { userId: TEST_USER_2.id },
      ),
    );

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("User is already a member of this team");
  });

  it("returns 400 when user is not a workspace member", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
      jsonRequest(
        "POST",
        `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
        { userId: "non-workspace-user" },
      ),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("User is not a member of this workspace");
  });

  it("returns 404 when team does not exist", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/nonexistent/members`,
      jsonRequest(
        "POST",
        `/workspaces/${workspaceId}/teams/nonexistent/members`,
        { userId: TEST_USER.id },
      ),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Team not found");
  });

  it("returns 400 when userId is missing", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
      jsonRequest(
        "POST",
        `/workspaces/${workspaceId}/teams/${memberTeamId}/members`,
        {},
      ),
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });
});

// ---------------------------------------------------------------------------
// removeTeamMember
// ---------------------------------------------------------------------------

describe("removeTeamMember", () => {
  let removeTeamId: string;

  beforeAll(async () => {
    removeTeamId = await seedTeam(d1, workspaceId, {
      id: "remove-team-1",
      name: "Remove Team",
    });
    await seedTeamMember(d1, removeTeamId, TEST_USER.id, "lead");
    await seedTeamMember(d1, removeTeamId, TEST_USER_2.id, "member");
  });

  function createApp() {
    const app = new Hono<AppEnv>();
    app.delete(
      "/workspaces/:workspaceId/teams/:teamId/members/:userId",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      removeTeamMember,
    );
    return app;
  }

  it("removes an existing team member", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${removeTeamId}/members/${TEST_USER_2.id}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify the member is gone by checking team detail
    const detailApp = new Hono<AppEnv>();
    detailApp.get(
      "/workspaces/:workspaceId/teams/:teamId",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
      getTeamDetail,
    );

    const verifyRes = await detailApp.request(
      `/workspaces/${workspaceId}/teams/${removeTeamId}`,
    );
    expect(verifyRes.status).toBe(200);
    const detail = await verifyRes.json<{ members: { userId: string }[] }>();
    const removedMember = detail.members.find(
      (m: { userId: string }) => m.userId === TEST_USER_2.id,
    );
    expect(removedMember).toBeUndefined();
  });

  it("returns 404 for nonexistent membership", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/${removeTeamId}/members/nonexistent-user`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Member not found");
  });

  it("returns 404 when team does not exist", async () => {
    const app = createApp();
    const res = await app.request(
      `/workspaces/${workspaceId}/teams/nonexistent/members/${TEST_USER.id}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Team not found");
  });
});
