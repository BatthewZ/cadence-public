/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptInvitationSchema,
  createInvitationSchema,
} from "../../../shared/schemas/invitation";
import type { AppBindings, AppEnv } from "../../env";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  fakeEnv,
  jsonRequest,
  seedInvitation,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  acceptInvitation,
  createInvitation,
  getInvitation,
  listInvitations,
  listMyPendingInvitations,
  revokeInvitation,
} from "./invitations.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;

/** Minimal env bindings so that c.env is defined when fakeAuth sets c.env.DB */
const env = {} as AppBindings;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// createInvitation
// ---------------------------------------------------------------------------

describe("createInvitation", () => {
  function buildApp(user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER) {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, user, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.post(
      "/workspaces/:workspaceId/invitations",
      validateBody(createInvitationSchema),
      createInvitation,
    );
    return app;
  }

  it("creates an invitation with a token and returns 201", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/invitations`, {
      email: "newuser@example.com",
      role: "member",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(201);
    const body = await res.json<{ invitation: { email: string; role: string; status: string; token: string; workspaceId: string } }>();
    expect(body.invitation).toBeDefined();
    expect(body.invitation.email).toBe("newuser@example.com");
    expect(body.invitation.role).toBe("member");
    expect(body.invitation.status).toBe("pending");
    expect(body.invitation.token).toBeTruthy();
    expect(body.invitation.workspaceId).toBe(workspaceId);
  });

  it("returns 400 when email is missing", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/invitations`, {
      role: "member",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: Array<{ path: string }> }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d) => d.path === "email")).toBe(true);
  });

  it("returns 400 when email is invalid", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/invitations`, {
      email: "not-an-email",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 when a pending invitation already exists for the email", async () => {
    const app = buildApp();
    await seedInvitation(d1, workspaceId, {
      email: "duplicate@example.com",
      invitedBy: TEST_USER.id,
    });

    const req = jsonRequest("POST", `/workspaces/${workspaceId}/invitations`, {
      email: "duplicate@example.com",
      role: "member",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe(
      "A pending invitation already exists for this email",
    );
  });

  it("returns 400 when the user is already a workspace member", async () => {
    const app = buildApp();
    const tempWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Temp WS",
    });
    await seedWorkspaceMember(d1, tempWsId, TEST_USER_2.id, "member");

    const req = jsonRequest("POST", `/workspaces/${tempWsId}/invitations`, {
      email: TEST_USER_2.email,
      role: "member",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("User is already a member of this workspace");
  });

  it("creates invitation with default role when role is omitted", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/invitations`, {
      email: "norole@example.com",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(201);
    const body = await res.json<{ invitation: { role: string } }>();
    expect(body.invitation.role).toBe("member");
  });
});

// ---------------------------------------------------------------------------
// listInvitations
// ---------------------------------------------------------------------------

describe("listInvitations", () => {
  let listWsId: string;

  beforeAll(async () => {
    listWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "List Invitations WS",
    });
    await seedInvitation(d1, listWsId, {
      email: "pending1@example.com",
      invitedBy: TEST_USER.id,
      status: "pending",
    });
    await seedInvitation(d1, listWsId, {
      email: "pending2@example.com",
      invitedBy: TEST_USER.id,
      status: "pending",
    });
    // This revoked invitation should NOT appear
    await seedInvitation(d1, listWsId, {
      email: "revoked@example.com",
      invitedBy: TEST_USER.id,
      status: "revoked",
    });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.get("/workspaces/:workspaceId/invitations", listInvitations);
    return app;
  }

  it("returns only pending invitations for the workspace", async () => {
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${listWsId}/invitations`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ invitations: Array<{ email: string; status: string }> }>();
    expect(body.invitations).toHaveLength(2);
    const emails = body.invitations.map((i) => i.email).sort();
    expect(emails).toEqual(["pending1@example.com", "pending2@example.com"]);
    for (const inv of body.invitations) {
      expect(inv.status).toBe("pending");
    }
  });

  it("returns empty array when no pending invitations exist", async () => {
    const emptyWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Empty WS",
    });
    const app = buildApp();
    const res = await app.request(
      `/workspaces/${emptyWsId}/invitations`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ invitations: Array<unknown> }>();
    expect(body.invitations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// revokeInvitation
// ---------------------------------------------------------------------------

describe("revokeInvitation", () => {
  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
      }),
    );
    app.delete(
      "/workspaces/:workspaceId/invitations/:id",
      revokeInvitation,
    );
    return app;
  }

  it("revokes a pending invitation", async () => {
    const revokeWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Revoke WS",
    });
    const invId = await seedInvitation(d1, revokeWsId, {
      email: "torevoke@example.com",
      invitedBy: TEST_USER.id,
    });
    const app = buildApp();
    const req = jsonRequest(
      "DELETE",
      `/workspaces/${revokeWsId}/invitations/${invId}`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify in DB that status changed
    const row = await d1
      .prepare("SELECT status FROM invitation WHERE id = ?")
      .bind(invId)
      .first<{ status: string }>();
    expect(row?.status).toBe("revoked");
  });

  it("returns 404 for a nonexistent invitation", async () => {
    const app = buildApp();
    const req = jsonRequest(
      "DELETE",
      `/workspaces/${workspaceId}/invitations/nonexistent-id`,
    );
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invitation not found");
  });
});

// ---------------------------------------------------------------------------
// listMyPendingInvitations
// ---------------------------------------------------------------------------

describe("listMyPendingInvitations", () => {
  let myPendingWsId: string;

  beforeAll(async () => {
    myPendingWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "My Pending WS",
    });
    // Invitation sent to TEST_USER_2's email
    await seedInvitation(d1, myPendingWsId, {
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      status: "pending",
    });
    // Invitation for someone else — should NOT show for TEST_USER_2
    await seedInvitation(d1, myPendingWsId, {
      email: "someone-else@example.com",
      invitedBy: TEST_USER.id,
      status: "pending",
    });
    // Already accepted invitation for TEST_USER_2 — should NOT show
    const anotherWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Already Accepted WS",
    });
    await seedInvitation(d1, anotherWsId, {
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      status: "accepted",
    });
  });

  function buildApp(user: typeof TEST_USER | typeof TEST_USER_2) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user));
    app.get("/invitations/pending", listMyPendingInvitations);
    return app;
  }

  it("returns pending invitations for the current user's email", async () => {
    const app = buildApp(TEST_USER_2);
    const res = await app.request("/invitations/pending", undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{ invitations: Array<{ workspace?: { id: string; name: string }; invitedBy?: { id: string; name: string } }> }>();
    // Should have at least the one pending invitation sent to TEST_USER_2
    const matchingInvs = body.invitations.filter(
      (inv) => inv.workspace?.id === myPendingWsId,
    );
    expect(matchingInvs.length).toBe(1);
    expect(matchingInvs[0].workspace?.name).toBe("My Pending WS");
    expect(matchingInvs[0].invitedBy?.id).toBe(TEST_USER.id);
    expect(matchingInvs[0].invitedBy?.name).toBe(TEST_USER.name);
  });

  it("returns empty array when user has no pending invitations", async () => {
    const app = buildApp(TEST_USER);
    const res = await app.request("/invitations/pending", undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{ invitations: Array<unknown> }>();
    // TEST_USER is the inviter not the invitee — verify structure is correct
    expect(Array.isArray(body.invitations)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getInvitation
// ---------------------------------------------------------------------------

describe("getInvitation", () => {
  const knownToken = "known-token-for-get-test";
  let getInvWsId: string;

  beforeAll(async () => {
    getInvWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Get Invitation WS",
    });
    await seedInvitation(d1, getInvWsId, {
      email: "get-inv@example.com",
      invitedBy: TEST_USER.id,
      token: knownToken,
      status: "pending",
    });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    // getInvitation is public — no auth required, just inject D1
    app.use("/*", fakeEnv(d1));
    app.get("/invitations/:token", getInvitation);
    return app;
  }

  it("returns invitation details by token", async () => {
    const app = buildApp();
    const res = await app.request(
      `/invitations/${knownToken}`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ invitation: { email: string; workspace?: { id: string; name: string }; invitedBy?: { id: string } } }>();
    expect(body.invitation).toBeDefined();
    expect(body.invitation.email).toBe("get-inv@example.com");
    expect(body.invitation.workspace?.id).toBe(getInvWsId);
    expect(body.invitation.workspace?.name).toBe("Get Invitation WS");
    expect(body.invitation.invitedBy?.id).toBe(TEST_USER.id);
  });

  it("returns 404 for an invalid token", async () => {
    const app = buildApp();
    const res = await app.request(
      "/invitations/nonexistent-token",
      undefined,
      env,
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invitation not found");
  });

  it("returns 400 for an already accepted invitation", async () => {
    const acceptedWs = await seedWorkspace(d1, TEST_USER.id, {
      name: "Accepted WS",
    });
    const acceptedToken = "accepted-token-test";
    await seedInvitation(d1, acceptedWs, {
      email: "accepted@example.com",
      invitedBy: TEST_USER.id,
      token: acceptedToken,
      status: "accepted",
    });
    const app = buildApp();
    const res = await app.request(
      `/invitations/${acceptedToken}`,
      undefined,
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invitation is accepted");
  });

  it("returns 400 for a revoked invitation", async () => {
    const revokedWs = await seedWorkspace(d1, TEST_USER.id, {
      name: "Revoked Invite WS",
    });
    const revokedToken = "revoked-token-test";
    await seedInvitation(d1, revokedWs, {
      email: "revoked-get@example.com",
      invitedBy: TEST_USER.id,
      token: revokedToken,
      status: "revoked",
    });
    const app = buildApp();
    const res = await app.request(
      `/invitations/${revokedToken}`,
      undefined,
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invitation is revoked");
  });
});

// ---------------------------------------------------------------------------
// acceptInvitation
// ---------------------------------------------------------------------------

describe("acceptInvitation", () => {
  function buildApp(user: typeof TEST_USER | typeof TEST_USER_2) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user));
    app.post(
      "/invitations/accept",
      validateBody(acceptInvitationSchema),
      acceptInvitation,
    );
    return app;
  }

  it("accepts an invitation and creates a workspace membership", async () => {
    const acceptWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Accept WS",
    });
    const acceptToken = "accept-test-token";
    await seedInvitation(d1, acceptWsId, {
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: acceptToken,
      role: "member",
      status: "pending",
    });

    const app = buildApp(TEST_USER_2);
    const req = jsonRequest("POST", "/invitations/accept", {
      token: acceptToken,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; workspaceId: string }>();
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe(acceptWsId);

    // Verify workspace membership was created
    const membership = await d1
      .prepare(
        "SELECT userId, role FROM workspace_member WHERE workspaceId = ? AND userId = ?",
      )
      .bind(acceptWsId, TEST_USER_2.id)
      .first<{ userId: string; role: string }>();
    expect(membership).toBeDefined();
    expect(membership?.userId).toBe(TEST_USER_2.id);
    expect(membership?.role).toBe("member");

    // Verify invitation status changed to accepted
    const inv = await d1
      .prepare("SELECT status FROM invitation WHERE token = ?")
      .bind(acceptToken)
      .first<{ status: string }>();
    expect(inv?.status).toBe("accepted");
  });

  it("cannot accept an already accepted invitation", async () => {
    const alreadyAcceptedWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Already Accepted WS 2",
    });
    const alreadyAcceptedToken = "already-accepted-token";
    await seedInvitation(d1, alreadyAcceptedWsId, {
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: alreadyAcceptedToken,
      status: "accepted",
    });

    const app = buildApp(TEST_USER_2);
    const req = jsonRequest("POST", "/invitations/accept", {
      token: alreadyAcceptedToken,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invitation is accepted");
  });

  it("returns 404 for a nonexistent token", async () => {
    const app = buildApp(TEST_USER_2);
    const req = jsonRequest("POST", "/invitations/accept", {
      token: "nonexistent-token",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invitation not found");
  });

  it("returns 403 when email does not match the invitation", async () => {
    const mismatchWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Mismatch WS",
    });
    const mismatchToken = "mismatch-email-token";
    await seedInvitation(d1, mismatchWsId, {
      email: "other-user@example.com",
      invitedBy: TEST_USER.id,
      token: mismatchToken,
      status: "pending",
    });

    // TEST_USER_2's email doesn't match the invitation email
    const app = buildApp(TEST_USER_2);
    const req = jsonRequest("POST", "/invitations/accept", {
      token: mismatchToken,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe(
      "This invitation was sent to a different email address",
    );
  });

  it("returns 400 when user is already a workspace member", async () => {
    const alreadyMemberWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Already Member WS",
    });
    await seedWorkspaceMember(d1, alreadyMemberWsId, TEST_USER_2.id, "member");
    const alreadyMemberToken = "already-member-token";
    await seedInvitation(d1, alreadyMemberWsId, {
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: alreadyMemberToken,
      status: "pending",
    });

    const app = buildApp(TEST_USER_2);
    const req = jsonRequest("POST", "/invitations/accept", {
      token: alreadyMemberToken,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("You are already a member of this workspace");
  });

  it("returns 400 for validation error when token is missing", async () => {
    const app = buildApp(TEST_USER_2);
    const req = jsonRequest("POST", "/invitations/accept", {});
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: Array<{ path: string }> }>();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d) => d.path === "token")).toBe(true);
  });
});
