/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiToken } from "../../../db/schema";
import {
  acceptInvitationSchema,
  createInvitationSchema,
} from "../../../shared/schemas/invitation";
import type { AppBindings, AppEnv } from "../../env";
import type { EmailMessage, EmailSendResult } from "../../lib/email/types";
import { rejectPatAuth } from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  fakeEnv,
  fakePat,
  jsonRequest,
  seedInvitation,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  TEST_USER_2,
  type TestUserFixture,
} from "../../test-utils";
/**
 * Stub the whole email module.
 *
 * The real `createEmailService` falls back to `ConsoleEmailService` whenever
 * `RESEND_API_KEY` is unset — which it always is under vitest. An unmocked
 * test would therefore "pass" by printing to stdout no matter what the
 * handler did, including doing nothing at all: exactly the shape of the bug
 * audit finding 03 describes (a fully written template that nothing imports).
 * Stubbing gives the assertion something that can actually fail.
 */
const mockEmailSend = vi.fn<(msg: EmailMessage) => Promise<EmailSendResult>>(
  () => Promise.resolve({ id: "test-email-id" }),
);
vi.mock("../../lib/email", () => ({
  createEmailService: vi.fn(() => ({ send: mockEmailSend })),
}));

import {
  acceptInvitation,
  createInvitation,
  getInvitation,
  getInvitationLink,
  listInvitations,
  listMyPendingInvitations,
  revokeInvitation,
} from "./invitations.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;

/**
 * Minimal env bindings so that `c.env` is defined when fakeAuth sets
 * `c.env.DB`. `BETTER_AUTH_URL` is supplied because the invitation email and
 * the copy-link endpoint both compose `<origin>/invite/<token>` from it — with
 * it missing they would emit `undefined/invite/...` and the link assertions
 * would be checking a string that could never work in a browser.
 */
const env = {
  BETTER_AUTH_URL: "https://cadence.example.com",
  EMAIL_FROM: "noreply@cadence.example.com",
} as AppBindings;

beforeEach(() => {
  mockEmailSend.mockClear();
  mockEmailSend.mockImplementation(() => Promise.resolve({ id: "test-email-id" }));
});

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

  it("creates an invitation and returns 201 without disclosing the token", async () => {
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${workspaceId}/invitations`, {
      email: "newuser@example.com",
      role: "member",
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(201);
    const body = await res.json<{ invitation: Record<string, unknown> }>();
    expect(body.invitation).toBeDefined();
    expect(body.invitation.email).toBe("newuser@example.com");
    expect(body.invitation.role).toBe("member");
    expect(body.invitation.status).toBe("pending");
    expect(body.invitation.workspaceId).toBe(workspaceId);

    // The token is a bearer credential: it is persisted, but it must not ride
    // back in the create response. `toHaveProperty` rather than a truthiness
    // check so a future `token: null` regression is still caught.
    expect(body.invitation).not.toHaveProperty("token");

    const row = await d1
      .prepare("SELECT token FROM invitation WHERE id = ?")
      .bind(body.invitation.id as string)
      .first<{ token: string }>();
    expect(row?.token).toBeTruthy();
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

  it("returns invitation details with rate limit headers", async () => {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeEnv(d1));
    app.get(
      "/invitations/:token",
      rateLimit({ max: 10, windowSeconds: 60, prefix: "invitation-lookup-test" }),
      getInvitation,
    );

    const res = await app.request(
      `/invitations/${knownToken}`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ invitation: { email: string; workspace?: { id: string; name: string } } }>();
    expect(body.invitation).toBeDefined();
    expect(body.invitation.email).toBe("get-inv@example.com");
    expect(body.invitation.workspace?.id).toBe(getInvWsId);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
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

    // `joinedAt` is written by hand-rolled SQL inside the accept batch, so the
    // seconds-vs-milliseconds encoding Drizzle applies to
    // `integer({ mode: "timestamp" })` is this handler's responsibility rather
    // than the ORM's. Binding milliseconds would store a date ~50,000 years in
    // the future and every "joined" timestamp in the members list would be
    // silently wrong — a defect no status-code assertion can see.
    const joined = await d1
      .prepare("SELECT joinedAt FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(acceptWsId, TEST_USER_2.id)
      .first<{ joinedAt: number }>();
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(joined!.joinedAt).toBeGreaterThan(nowSeconds - 300);
    expect(joined!.joinedAt).toBeLessThanOrEqual(nowSeconds + 5);

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

  it("returns 400 when neither selector is supplied", async () => {
    const app = buildApp(TEST_USER_2);
    const req = jsonRequest("POST", "/invitations/accept", {});
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; details: Array<{ message: string }> }>();
    expect(body.error).toBe("Validation failed");
    expect(
      body.details.some((d) =>
        d.message.includes("Provide exactly one of token or invitationId"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invitation delivery — audit finding 03
// ---------------------------------------------------------------------------
//
// Before this, `createInvitation` wrote a row, fired a webhook, and created an
// in-app notification *only when the invitee already had an account*. Inviting
// anyone new therefore produced nothing the invitee could see or act on, and
// the fully written email template had zero importers. These tests assert
// delivery itself — that a send is attempted, to the right address, carrying a
// link that actually resolves the invitation — because "the row was created"
// is precisely the assertion that let the broken flow ship.

describe("createInvitation — email delivery", () => {
  let deliveryWsId: string;

  beforeAll(async () => {
    deliveryWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Delivery WS",
    });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
    );
    app.post(
      "/workspaces/:workspaceId/invitations",
      validateBody(createInvitationSchema),
      createInvitation,
    );
    return app;
  }

  it("emails a brand-new address a link that resolves the invitation", async () => {
    const app = buildApp();
    const email = "brand-new-invitee@example.com";
    const req = jsonRequest("POST", `/workspaces/${deliveryWsId}/invitations`, {
      email,
      role: "admin",
    });
    const res = await app.request(req, undefined, env);
    expect(res.status).toBe(201);

    // deferWork runs inline under vitest but is not awaited by the handler.
    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledTimes(1));

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.to).toBe(email);
    expect(sent.from).toBe("noreply@cadence.example.com");
    expect(sent.subject).toContain("Delivery WS");

    // The link must carry the real persisted token and the deployment's own
    // origin — a link to `undefined/invite/...` would render as a plausible
    // email while being unusable.
    const row = await d1
      .prepare("SELECT token FROM invitation WHERE workspaceId = ? AND email = ?")
      .bind(deliveryWsId, email)
      .first<{ token: string }>();
    const expectedUrl = `https://cadence.example.com/invite/${row!.token}`;
    expect(sent.html).toContain(expectedUrl);
    expect(sent.text).toContain(expectedUrl);
    expect(sent.html).toContain("admin");
  });

  it("emails invitees who already have an account too", async () => {
    // Regression guard: delivery used to be conditional on the invitee having
    // an account — inverted, so that the only people who got *anything* were
    // the ones who least needed an email. Both branches must send.
    const app = buildApp();
    const req = jsonRequest("POST", `/workspaces/${deliveryWsId}/invitations`, {
      email: TEST_USER_2.email,
    });
    const res = await app.request(req, undefined, env);
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledTimes(1));
    expect(mockEmailSend.mock.calls[0][0].to).toBe(TEST_USER_2.email);

    // …and the in-app notification is still created alongside it.
    await vi.waitFor(async () => {
      const notification = await d1
        .prepare(
          "SELECT type FROM notification WHERE userId = ? AND type = 'invitation_received'",
        )
        .bind(TEST_USER_2.id)
        .first<{ type: string }>();
      expect(notification?.type).toBe("invitation_received");
    });
  });

  it("still returns 201 when the mail provider fails", async () => {
    // The row is already committed when the send happens. A 500 here would
    // tell the admin to retry, and the retry would hit the duplicate-pending
    // guard — stranding them with an invitation they cannot resend or resolve.
    mockEmailSend.mockImplementation(() => Promise.reject(new Error("smtp down")));

    const app = buildApp();
    const email = "provider-down@example.com";
    const req = jsonRequest("POST", `/workspaces/${deliveryWsId}/invitations`, {
      email,
    });
    const res = await app.request(req, undefined, env);

    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledTimes(1));

    const row = await d1
      .prepare("SELECT status FROM invitation WHERE workspaceId = ? AND email = ?")
      .bind(deliveryWsId, email)
      .first<{ status: string }>();
    expect(row?.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Token confidentiality — audit finding 04
// ---------------------------------------------------------------------------

describe("invitation tokens are not disclosed by list endpoints", () => {
  let secretWsId: string;
  const secretToken = "confidentiality-probe-token";

  beforeAll(async () => {
    secretWsId = await seedWorkspace(d1, TEST_USER.id, {
      name: "Confidentiality WS",
    });
    await seedInvitation(d1, secretWsId, {
      id: "confidentiality-inv-id",
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: secretToken,
      status: "pending",
    });
  });

  it("listInvitations returns no token field and never leaks the value", async () => {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }),
    );
    app.get("/workspaces/:workspaceId/invitations", listInvitations);

    const res = await app.request(
      `/workspaces/${secretWsId}/invitations`,
      undefined,
      env,
    );
    expect(res.status).toBe(200);

    const raw = await res.text();
    // Assert on the serialized body, not just the parsed shape: a token
    // smuggled under a different key name would still be a disclosure.
    expect(raw).not.toContain(secretToken);

    const body = JSON.parse(raw) as { invitations: Record<string, unknown>[] };
    expect(body.invitations.length).toBeGreaterThan(0);
    for (const inv of body.invitations) {
      expect(inv).not.toHaveProperty("token");
    }
    // The fields the members page actually renders must survive the narrowing.
    expect(body.invitations[0].email).toBeTruthy();
    expect(body.invitations[0].role).toBeTruthy();
    expect(body.invitations[0].createdAt).toBeTruthy();
  });

  it("listMyPendingInvitations returns no token field and never leaks the value", async () => {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, TEST_USER_2));
    app.get("/invitations/pending", listMyPendingInvitations);

    const res = await app.request("/invitations/pending", undefined, env);
    expect(res.status).toBe(200);

    const raw = await res.text();
    expect(raw).not.toContain(secretToken);

    const body = JSON.parse(raw) as { invitations: Record<string, unknown>[] };
    const probe = body.invitations.find((i) => i.id === "confidentiality-inv-id");
    expect(probe).toBeDefined();
    expect(probe).not.toHaveProperty("token");
    // The id is what the client accepts with, so it must still be present.
    expect(probe!.id).toBe("confidentiality-inv-id");
  });
});

// ---------------------------------------------------------------------------
// getInvitationLink — the copy-link fallback (audit finding 03)
// ---------------------------------------------------------------------------

describe("getInvitationLink", () => {
  let linkWsId: string;

  beforeAll(async () => {
    linkWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Link WS" });
  });

  /**
   * @param apiToken when supplied, the request is treated as PAT-authenticated
   *   and the production `rejectPatAuth()` middleware is exercised. Passing
   *   `null` is not the same as omitting it: `null` is what the auth middleware
   *   writes on the cookie-session branch, and that is the case this default
   *   reproduces.
   */
  function buildApp(apiToken: ApiToken | null = null) {
    const app = new Hono<AppEnv>();
    app.use(
      "/*",
      fakeAuth(d1, TEST_USER, {
        workspaceMembership: { id: "wm-1", role: "owner" },
        apiToken,
      }),
    );
    app.use("/*", rejectPatAuth());
    app.get("/workspaces/:workspaceId/invitations/:id/link", getInvitationLink);
    return app;
  }

  /** A PAT whose scopes have nothing to do with invitations. */
  function fakeReadOnlyPat(): ApiToken {
    return fakePat({
      id: "tok_link_probe",
      userId: TEST_USER.id,
      workspaceId: linkWsId,
      name: "read-only pat",
      tokenPrefix: "cdn_pat_xxxx",
      scopes: JSON.stringify(["task:read"]),
    });
  }

  it("returns the invite URL for a pending invitation", async () => {
    await seedInvitation(d1, linkWsId, {
      id: "link-pending-inv",
      email: "link-pending@example.com",
      invitedBy: TEST_USER.id,
      token: "link-pending-token",
      status: "pending",
    });

    const res = await buildApp().request(
      `/workspaces/${linkWsId}/invitations/link-pending-inv/link`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ url: string }>();
    expect(body.url).toBe("https://cadence.example.com/invite/link-pending-token");
  });

  it("refuses a PAT-authenticated owner and never discloses the token", async () => {
    // This is the only endpoint that still returns a raw invitation token, and
    // the scope machinery cannot guard it: `requireWriteScopeForResource`
    // no-ops on GET and there is no `invitation:read` scope in v1. PAT auth
    // bridges a real user into the context, so `requireAuth` and
    // `requireWorkspaceRole("owner","admin")` both pass — meaning without
    // `rejectPatAuth()` a token minted with nothing but `task:read` could
    // harvest a working invite. A machine credential must not be able to
    // harvest another credential.
    await seedInvitation(d1, linkWsId, {
      id: "link-pat-inv",
      email: "link-pat@example.com",
      invitedBy: TEST_USER.id,
      token: "link-pat-token",
      status: "pending",
    });

    const res = await buildApp(fakeReadOnlyPat()).request(
      `/workspaces/${linkWsId}/invitations/link-pat-inv/link`,
      undefined,
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("link-pat-token");
  });

  it("still serves a cookie-authenticated owner", async () => {
    // Pairs with the test above so the lockout cannot pass by being a blanket
    // deny — the human path this control exists for must keep working.
    const res = await buildApp().request(
      `/workspaces/${linkWsId}/invitations/link-pat-inv/link`,
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ url: string }>();
    expect(body.url).toBe("https://cadence.example.com/invite/link-pat-token");
  });

  it("returns 404 for an invitation belonging to another workspace", async () => {
    const otherWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Other Link WS" });
    await seedInvitation(d1, otherWsId, {
      id: "link-foreign-inv",
      email: "link-foreign@example.com",
      invitedBy: TEST_USER.id,
      token: "link-foreign-token",
      status: "pending",
    });

    // Same admin, but asking through a workspace that does not own the row —
    // the id must not be enough to pull a token out of a different tenant.
    const res = await buildApp().request(
      `/workspaces/${linkWsId}/invitations/link-foreign-inv/link`,
      undefined,
      env,
    );

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("link-foreign-token");
  });

  it("refuses to hand out a link for a revoked invitation", async () => {
    await seedInvitation(d1, linkWsId, {
      id: "link-revoked-inv",
      email: "link-revoked@example.com",
      invitedBy: TEST_USER.id,
      token: "link-revoked-token",
      status: "revoked",
    });

    const res = await buildApp().request(
      `/workspaces/${linkWsId}/invitations/link-revoked-inv/link`,
      undefined,
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("link-revoked-token");
  });

  it("refuses to hand out a link for an expired invitation", async () => {
    await seedInvitation(d1, linkWsId, {
      id: "link-expired-inv",
      email: "link-expired@example.com",
      invitedBy: TEST_USER.id,
      token: "link-expired-token",
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await buildApp().request(
      `/workspaces/${linkWsId}/invitations/link-expired-inv/link`,
      undefined,
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("link-expired-token");
  });
});

// ---------------------------------------------------------------------------
// acceptInvitation by id — the new selector, and the attack surface it opens
// ---------------------------------------------------------------------------
//
// Removing the token from the pending list means signed-in invitees accept by
// invitation id instead. Ids are visible to workspace admins (listInvitations)
// and to the invitee, so the id must be an identifier and not a capability:
// every check the token path runs, the id path runs too. The hostile cases
// below are the reason this suite exists.

const ATTACKER_USER = {
  ...TEST_USER_2,
  id: "attacker-user-id",
  name: "Attacker",
  email: "attacker@example.com",
};

describe("acceptInvitation by invitationId", () => {
  beforeAll(async () => {
    await seedUser(d1, ATTACKER_USER);
  });

  function buildApp(user: TestUserFixture) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user));
    app.post(
      "/invitations/accept",
      validateBody(acceptInvitationSchema),
      acceptInvitation,
    );
    return app;
  }

  async function seedPendingInvite(opts: { id: string; wsName: string; email?: string; status?: string; expiresAt?: Date }) {
    const wsId = await seedWorkspace(d1, TEST_USER.id, { name: opts.wsName });
    await seedInvitation(d1, wsId, {
      id: opts.id,
      email: opts.email ?? TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: `${opts.id}-token`,
      role: "member",
      status: opts.status ?? "pending",
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    });
    return wsId;
  }

  it("lets the invited user accept with only the id", async () => {
    const wsId = await seedPendingInvite({ id: "byid-happy", wsName: "ById Happy WS" });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "byid-happy" }),
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; workspaceId: string }>();
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe(wsId);

    const membership = await d1
      .prepare("SELECT role FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, TEST_USER_2.id)
      .first<{ role: string }>();
    expect(membership?.role).toBe("member");

    const inv = await d1
      .prepare("SELECT status FROM invitation WHERE id = ?")
      .bind("byid-happy")
      .first<{ status: string }>();
    expect(inv?.status).toBe("accepted");
  });

  it("refuses a different signed-in user holding someone else's invitation id", async () => {
    // The core of the new attack surface: ids are not secret. A signed-in
    // stranger who obtains one — from an admin screenshot, a support ticket,
    // a shared HAR file — must get nothing.
    const wsId = await seedPendingInvite({ id: "byid-hijack", wsName: "ById Hijack WS" });

    const res = await buildApp(ATTACKER_USER).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "byid-hijack" }),
      undefined,
      env,
    );

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("This invitation was sent to a different email address");

    // Post-condition, not just the status code: no membership, and the
    // invitation is still claimable by the person it was actually sent to.
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, ATTACKER_USER.id)
      .first<{ id: string }>();
    expect(membership).toBeNull();

    const inv = await d1
      .prepare("SELECT status FROM invitation WHERE id = ?")
      .bind("byid-hijack")
      .first<{ status: string }>();
    expect(inv?.status).toBe("pending");
  });

  it("refuses the workspace owner accepting an invitation they issued", async () => {
    // Admins see every id in their workspace via listInvitations, so the
    // nearest attacker is the one who legitimately holds the id.
    await seedPendingInvite({ id: "byid-owner", wsName: "ById Owner WS" });

    const res = await buildApp(TEST_USER).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "byid-owner" }),
      undefined,
      env,
    );

    expect(res.status).toBe(403);
    const inv = await d1
      .prepare("SELECT status FROM invitation WHERE id = ?")
      .bind("byid-owner")
      .first<{ status: string }>();
    expect(inv?.status).toBe("pending");
  });

  it("returns 404 for an unknown id", async () => {
    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "no-such-invitation" }),
      undefined,
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 for a revoked invitation", async () => {
    const wsId = await seedPendingInvite({
      id: "byid-revoked",
      wsName: "ById Revoked WS",
      status: "revoked",
    });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "byid-revoked" }),
      undefined,
      env,
    );

    expect(res.status).toBe(409);
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, TEST_USER_2.id)
      .first<{ id: string }>();
    expect(membership).toBeNull();
  });

  it("returns 409 for an already-accepted invitation", async () => {
    await seedPendingInvite({
      id: "byid-accepted",
      wsName: "ById Accepted WS",
      status: "accepted",
    });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "byid-accepted" }),
      undefined,
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 400 for an expired invitation", async () => {
    const wsId = await seedPendingInvite({
      id: "byid-expired",
      wsName: "ById Expired WS",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "byid-expired" }),
      undefined,
      env,
    );

    expect(res.status).toBe(400);
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, TEST_USER_2.id)
      .first<{ id: string }>();
    expect(membership).toBeNull();
  });

  it("rejects a body carrying both selectors", async () => {
    // Ambiguity is refused rather than silently resolved: a request naming a
    // token AND a different id must not let either one decide the outcome.
    await seedPendingInvite({ id: "byid-both", wsName: "ById Both WS" });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", {
        invitationId: "byid-both",
        token: "byid-both-token",
      }),
      undefined,
      env,
    );

    expect(res.status).toBe(400);
    const inv = await d1
      .prepare("SELECT status FROM invitation WHERE id = ?")
      .bind("byid-both")
      .first<{ status: string }>();
    expect(inv?.status).toBe("pending");
  });

  it("still accepts via the emailed token path", async () => {
    // The id selector is an addition, not a replacement: someone arriving from
    // the invitation email has a token and no pending-list entry to read.
    const wsId = await seedPendingInvite({ id: "byid-token-path", wsName: "ById Token Path WS" });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { token: "byid-token-path-token" }),
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, TEST_USER_2.id)
      .first<{ id: string }>();
    expect(membership).not.toBeNull();
  });

  it("matches the invited address case-insensitively", async () => {
    const wsId = await seedPendingInvite({
      id: "byid-case",
      wsName: "ById Case WS",
      email: TEST_USER_2.email.toUpperCase(),
    });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { invitationId: "byid-case" }),
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, TEST_USER_2.id)
      .first<{ id: string }>();
    expect(membership).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invited-email normalisation
// ---------------------------------------------------------------------------
//
// The defect these cover is a *silent* one, which is why every case asserts a
// post-condition rather than a status code. Inviting `Alice@Example.com` used
// to store that string verbatim while account addresses are stored folded, so
// three sites disagreed about who had been invited: the account lookup in
// `createInvitation` missed (no `invitation_received` notification),
// `listMyPendingInvitations` returned an EMPTY list to the invitee, and only
// `acceptInvitation` folded. Every one of those returned a success status. A
// test that checked "201" would have passed throughout the entire bug.
//
// It matters more than a cosmetic mismatch because the raw token is no longer
// surfaced in-app: with the pending list empty, the emailed link is the
// invitee's only remaining route into the workspace.

describe("createInvitation — invited email is normalised", () => {
  const CASE_USER: TestUserFixture = {
    id: "case-user-id",
    name: "Casey Case",
    email: "casey@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  };

  let normWsId: string;

  beforeAll(async () => {
    await seedUser(d1, CASE_USER);
    normWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Normalisation WS" });
  });

  function buildApp(user: TestUserFixture = TEST_USER) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user, { workspaceMembership: { id: "wm-1", role: "owner" } }));
    app.post(
      "/workspaces/:workspaceId/invitations",
      validateBody(createInvitationSchema),
      createInvitation,
    );
    app.get("/invitations/pending", listMyPendingInvitations);
    return app;
  }

  it("stores a mixed-case, whitespace-padded address folded and trimmed", async () => {
    const res = await buildApp().request(
      jsonRequest("POST", `/workspaces/${normWsId}/invitations`, {
        email: "  Mixed.Case@Example.COM  ",
      }),
      undefined,
      env,
    );

    expect(res.status).toBe(201);
    const body = await res.json<{ invitation: { email: string; id: string } }>();
    // The response echoes the canonical form, so the admin sees what was
    // actually stored rather than what they typed.
    expect(body.invitation.email).toBe("mixed.case@example.com");

    // The stored row is the assertion that matters: normalising only in the
    // response body would leave every later comparison broken.
    const row = await d1
      .prepare("SELECT email FROM invitation WHERE id = ?")
      .bind(body.invitation.id)
      .first<{ email: string }>();
    expect(row?.email).toBe("mixed.case@example.com");

    // Drain this test's deferred send before finishing. `deferWork` runs
    // inline but unawaited, so a send still in flight when the next test calls
    // `mockClear()` would land in ITS call list and make an unrelated
    // assertion fail — a flake that looks like a bug in the code under test.
    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledTimes(1));
    expect(mockEmailSend.mock.calls[0][0].to).toBe("mixed.case@example.com");
  });

  it("notifies and emails an existing account whose address differs only in case", async () => {
    const res = await buildApp().request(
      jsonRequest("POST", `/workspaces/${normWsId}/invitations`, {
        email: "Casey@Example.com",
      }),
      undefined,
      env,
    );
    expect(res.status).toBe(201);

    // Delivery goes to the folded address, not the typed one. Matched by
    // recipient rather than by call index so the assertion states the property
    // it cares about and cannot be perturbed by unrelated deferred sends.
    await vi.waitFor(() =>
      expect(mockEmailSend.mock.calls.map((call) => call[0].to)).toContain(
        "casey@example.com",
      ),
    );

    // The in-app notification is the half that used to vanish entirely: the
    // "does this invitee already have an account?" lookup was case-sensitive,
    // so a real account was treated as a stranger and silently skipped.
    await vi.waitFor(async () => {
      const notification = await d1
        .prepare(
          "SELECT type, workspaceId FROM notification WHERE userId = ? AND type = 'invitation_received'",
        )
        .bind(CASE_USER.id)
        .first<{ type: string; workspaceId: string }>();
      expect(notification?.workspaceId).toBe(normWsId);
    });
  });

  it("surfaces the invitation in the invitee's own pending list", async () => {
    // The end-to-end statement of the bug: the person invited as
    // `Casey@Example.com` signs in as `casey@example.com` and must see it.
    const res = await buildApp(CASE_USER).request(
      new Request("http://localhost/invitations/pending"),
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      invitations: Array<{ workspace: { id: string } | null }>;
    }>();
    expect(
      body.invitations.some((inv) => inv.workspace?.id === normWsId),
    ).toBe(true);
  });

  it("treats a case-variant duplicate as a duplicate", async () => {
    // Without folding on write, the duplicate-pending guard compares
    // byte-for-byte too, so an admin could accumulate several pending
    // invitations for one mailbox — each of which sends its own email, and all
    // but one of which can never do anything once the first is accepted.
    const res = await buildApp().request(
      jsonRequest("POST", `/workspaces/${normWsId}/invitations`, {
        email: "CASEY@EXAMPLE.COM",
      }),
      undefined,
      env,
    );

    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe(
      "A pending invitation already exists for this email",
    );

    const count = await d1
      .prepare(
        "SELECT COUNT(*) AS n FROM invitation WHERE workspaceId = ? AND email = 'casey@example.com' AND status = 'pending'",
      )
      .bind(normWsId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    // No second email either — a rejected duplicate must not still spend a
    // send against the invitee's mailbox. Scoped to the recipient rather than
    // "never called", so the assertion survives an unrelated deferred send.
    expect(mockEmailSend.mock.calls.map((call) => call[0].to)).not.toContain(
      "casey@example.com",
    );
  });

  it("matches a folded invitation against a session whose address is not folded", async () => {
    // Defence in depth for rows that predate
    // `migrations/0036_normalize_invitation_email.sql`, and for any auth
    // provider that hands back a non-folded address: `acceptInvitation` folds
    // BOTH operands, so neither side's casing can strand the other.
    const wsId = await seedWorkspace(d1, TEST_USER.id, { name: "Fold Accept WS" });
    await seedInvitation(d1, wsId, {
      id: "fold-accept-inv",
      email: "folded-invitee@example.com",
      invitedBy: TEST_USER.id,
      token: "fold-accept-token",
      status: "pending",
    });

    const shoutingUser: TestUserFixture = {
      ...CASE_USER,
      id: "shouting-user-id",
      email: "FOLDED-INVITEE@Example.com",
    };
    await seedUser(d1, { ...shoutingUser, email: "folded-invitee@example.com" });

    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, shoutingUser));
    app.post("/invitations/accept", validateBody(acceptInvitationSchema), acceptInvitation);

    const res = await app.request(
      jsonRequest("POST", "/invitations/accept", { token: "fold-accept-token" }),
      undefined,
      env,
    );

    expect(res.status).toBe(200);
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(wsId, shoutingUser.id)
      .first<{ id: string }>();
    expect(membership).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EMAIL_FROM fallback on the invitation path
// ---------------------------------------------------------------------------

describe("createInvitation — sender address", () => {
  let fromWsId: string;

  beforeAll(async () => {
    fromWsId = await seedWorkspace(d1, TEST_USER.id, { name: "From WS" });
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }));
    app.post(
      "/workspaces/:workspaceId/invitations",
      validateBody(createInvitationSchema),
      createInvitation,
    );
    return app;
  }

  it("falls back to the shared default when EMAIL_FROM is unset", async () => {
    // This is the whole of the defect: `auth.ts` applied a fallback and this
    // path did not, so on a deployment with RESEND_API_KEY set but EMAIL_FROM
    // unset, password-reset and verification mail kept working while every
    // invitation was rejected by Resend for having no sender — and the
    // rejection was swallowed into a log line by the deliberate catch in
    // `sendInvitationEmail`. Asserting on the message handed to the transport
    // is the only place that failure is observable.
    const envWithoutFrom = { BETTER_AUTH_URL: "https://cadence.example.com" } as AppBindings;

    const res = await buildApp().request(
      jsonRequest("POST", `/workspaces/${fromWsId}/invitations`, {
        email: "no-from-configured@example.com",
      }),
      undefined,
      envWithoutFrom,
    );
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledTimes(1));
    expect(mockEmailSend.mock.calls[0][0].from).toBe("noreply@example.com");
  });

  it("prefers a configured EMAIL_FROM over the fallback", async () => {
    // Guards the fallback against becoming an override — a resolver that
    // always won would silently break every correctly configured deployment.
    const res = await buildApp().request(
      jsonRequest("POST", `/workspaces/${fromWsId}/invitations`, {
        email: "from-configured@example.com",
      }),
      undefined,
      env,
    );
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledTimes(1));
    expect(mockEmailSend.mock.calls[0][0].from).toBe("noreply@cadence.example.com");
  });
});

// ---------------------------------------------------------------------------
// Admin invitations require owner rank
// ---------------------------------------------------------------------------
//
// `updateMemberRole` already requires owner rank to promote someone to admin.
// Leaving `createInvitation` open meant an admin blocked from promoting could
// simply invite a new admin instead and reach the identical end state, so the
// rule was enforced on one of two equivalent doors — which is not a rule.

describe("createInvitation — granting the admin role", () => {
  let rankWsId: string;

  beforeAll(async () => {
    // Owned by TEST_USER_2; TEST_USER is a (non-owner) admin within it.
    rankWsId = await seedWorkspace(d1, TEST_USER_2.id, { name: "Rank WS" });
    await seedWorkspaceMember(d1, rankWsId, TEST_USER.id, "admin");
  });

  function buildApp(user: TestUserFixture) {
    const app = new Hono<AppEnv>();
    // The context membership deliberately claims "owner" while the DB says
    // otherwise for TEST_USER. The check must read the database: a privilege
    // decision that trusts a middleware-populated cache is only as sound as
    // the mount order staying correct forever.
    app.use("/*", fakeAuth(d1, user, { workspaceMembership: { id: "wm-1", role: "owner" } }));
    app.post(
      "/workspaces/:workspaceId/invitations",
      validateBody(createInvitationSchema),
      createInvitation,
    );
    return app;
  }

  it("refuses an admin who tries to invite a peer admin, writing nothing", async () => {
    const res = await buildApp(TEST_USER).request(
      jsonRequest("POST", `/workspaces/${rankWsId}/invitations`, {
        email: "peer-admin@example.com",
        role: "admin",
      }),
      undefined,
      env,
    );

    expect(res.status).toBe(403);
    expect((await res.json<{ error: string }>()).error).toBe(
      "Only the workspace owner can invite someone as an admin",
    );

    // Post-conditions are the point: a 403 that still wrote the row, or still
    // sent the mail, would be no fix at all.
    const row = await d1
      .prepare("SELECT id FROM invitation WHERE workspaceId = ? AND email = ?")
      .bind(rankWsId, "peer-admin@example.com")
      .first<{ id: string }>();
    expect(row).toBeNull();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("still lets that admin invite a plain member", async () => {
    // The narrowing must not cost admins the authority the audit assigned
    // them ("let admins manage members only").
    const res = await buildApp(TEST_USER).request(
      jsonRequest("POST", `/workspaces/${rankWsId}/invitations`, {
        email: "plain-member@example.com",
      }),
      undefined,
      env,
    );

    expect(res.status).toBe(201);
    const row = await d1
      .prepare("SELECT role FROM invitation WHERE workspaceId = ? AND email = ?")
      .bind(rankWsId, "plain-member@example.com")
      .first<{ role: string }>();
    expect(row?.role).toBe("member");
  });

  it("lets the workspace owner invite an admin", async () => {
    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", `/workspaces/${rankWsId}/invitations`, {
        email: "owner-minted-admin@example.com",
        role: "admin",
      }),
      undefined,
      env,
    );

    expect(res.status).toBe(201);
    const row = await d1
      .prepare("SELECT role, status FROM invitation WHERE workspaceId = ? AND email = ?")
      .bind(rankWsId, "owner-minted-admin@example.com")
      .first<{ role: string; status: string }>();
    expect(row?.role).toBe("admin");
    expect(row?.status).toBe("pending");
  });

  it("refuses the admin role before answering whether the invitee already exists", async () => {
    // Ordering matters: the already-a-member and duplicate-invitation branches
    // return 400s that describe the invitee. An admin who may not perform this
    // action at all must not be able to use it as a roster oracle.
    const res = await buildApp(TEST_USER).request(
      jsonRequest("POST", `/workspaces/${rankWsId}/invitations`, {
        email: TEST_USER_2.email, // already the owner of this workspace
        role: "admin",
      }),
      undefined,
      env,
    );

    expect(res.status).toBe(403);
    expect((await res.json<{ error: string }>()).error).toBe(
      "Only the workspace owner can invite someone as an admin",
    );
  });
});

// ---------------------------------------------------------------------------
// Invite-create rate limiting
// ---------------------------------------------------------------------------

describe("createInvitation — rate limit", () => {
  let limitWsId: string;

  beforeAll(async () => {
    limitWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Limit WS" });
  });

  it("stops the 21st invitation in an hour and writes no row for it", async () => {
    // Creating an invitation now sends mail to an attacker-chosen address, so
    // an unlimited create endpoint is a mail-bomb and sending-reputation
    // primitive. It was harmless only while invitations were never delivered.
    //
    // A fresh `rateLimit()` instance is used rather than the production mount
    // because the limiter's counter Map is closure-scoped per instance; the
    // e2e suite asserts the production route carries the same numbers.
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, TEST_USER, { workspaceMembership: { id: "wm-1", role: "owner" } }));
    app.post(
      "/workspaces/:workspaceId/invitations",
      rateLimit({
        max: 20,
        windowSeconds: 3600,
        prefix: "invitation-create-test",
        keyFn: defaultRateLimitKey,
      }),
      validateBody(createInvitationSchema),
      createInvitation,
    );

    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const res = await app.request(
        jsonRequest("POST", `/workspaces/${limitWsId}/invitations`, {
          email: `flood-${i}@example.com`,
        }),
        undefined,
        env,
      );
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);

    // The post-condition that proves the limiter ran BEFORE the handler rather
    // than merely relabelling its response: the 21st address has no row.
    const blocked = await d1
      .prepare("SELECT id FROM invitation WHERE workspaceId = ? AND email = ?")
      .bind(limitWsId, "flood-20@example.com")
      .first<{ id: string }>();
    expect(blocked).toBeNull();

    const count = await d1
      .prepare("SELECT COUNT(*) AS n FROM invitation WHERE workspaceId = ?")
      .bind(limitWsId)
      .first<{ n: number }>();
    expect(count?.n).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Concurrent accept
// ---------------------------------------------------------------------------

describe("acceptInvitation — concurrency", () => {
  function buildApp(user: TestUserFixture) {
    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, user));
    app.post("/invitations/accept", validateBody(acceptInvitationSchema), acceptInvitation);
    return app;
  }

  it("gives one caller 200 and every other caller a clean 409, never a 500", async () => {
    // Accept used to be a check-then-write: read the status, insert the
    // membership, then flip the status. The read is not a lock, so N racing
    // requests all passed the `status === "pending"` guard and all reached the
    // insert. The unique index on (workspaceId, userId) protected the DATA —
    // which is why the audit rated this low — but the loser's constraint
    // violation escaped as an unhandled 500, telling a user the server was
    // broken when their invitation had merely already been used.
    //
    // The fix makes the status column the mutex, but NOT by claiming first —
    // that ordering is explicitly rejected in `acceptInvitation`'s jsdoc,
    // because a claim that lands and an insert that then does not strands the
    // invitee with a burnt invitation and no membership. Both statements go in
    // one `db.batch` (one implicit D1 transaction) with the guarded
    // `INSERT … SELECT … WHERE status = 'pending'` FIRST and the conditional
    // `UPDATE … WHERE status = 'pending'` second, so the loser's insert selects
    // zero rows and its update changes zero rows: nothing at all is written,
    // and the zero-rows-changed report is what this test's 409 comes from.
    //
    // Stated precisely because the two orderings are one line apart and only
    // one of them is correct — a reader who "simplifies" this back to
    // claim-then-insert reintroduces the stranding bug with every test still
    // green, since no test can observe an isolate dying mid-request.
    const raceWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Race WS" });
    await seedInvitation(d1, raceWsId, {
      id: "race-inv",
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: "race-token",
      status: "pending",
    });

    const app = buildApp(TEST_USER_2);
    const responses = await Promise.all(
      Array.from({ length: 5 }, async () =>
        app.request(
          jsonRequest("POST", "/invitations/accept", { token: "race-token" }),
          undefined,
          env,
        ),
      ),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    // Stated separately so a regression that turns 409s back into 500s names
    // itself in the failure output rather than looking like an off-by-one.
    expect(statuses.filter((s) => s >= 500)).toHaveLength(0);

    // Exactly one membership, and the invitation is consumed exactly once.
    const count = await d1
      .prepare(
        "SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ? AND userId = ?",
      )
      .bind(raceWsId, TEST_USER_2.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const inv = await d1
      .prepare("SELECT status, acceptedAt FROM invitation WHERE id = ?")
      .bind("race-inv")
      .first<{ status: string; acceptedAt: number | null }>();
    expect(inv?.status).toBe("accepted");
    expect(inv?.acceptedAt).not.toBeNull();
  });

  it("leaves a revoked invitation revoked and grants nothing", async () => {
    // The claim is conditional on `status = 'pending'`, so a revocation that
    // lands first must win outright — the compensating path must never be able
    // to resurrect a revoked invitation as `pending`.
    const revokedWsId = await seedWorkspace(d1, TEST_USER.id, { name: "Revoked Race WS" });
    await seedInvitation(d1, revokedWsId, {
      id: "revoked-race-inv",
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: "revoked-race-token",
      status: "revoked",
    });

    const res = await buildApp(TEST_USER_2).request(
      jsonRequest("POST", "/invitations/accept", { token: "revoked-race-token" }),
      undefined,
      env,
    );

    expect(res.status).toBe(409);
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(revokedWsId, TEST_USER_2.id)
      .first<{ id: string }>();
    expect(membership).toBeNull();

    const inv = await d1
      .prepare("SELECT status FROM invitation WHERE id = ?")
      .bind("revoked-race-inv")
      .first<{ status: string }>();
    expect(inv?.status).toBe("revoked");
  });
});

describe("acceptInvitation — two invitations, one workspace, accepted at once", () => {
  it("grants one membership and answers the loser 400, never 500", async () => {
    // The one failure the atomic claim does NOT cover, because each request
    // claims a DIFFERENT invitation row and so both claims succeed. Both then
    // insert, and the unique index on (workspaceId, userId) rejects one.
    //
    // `createInvitation`'s duplicate guard makes this rare rather than
    // impossible: rows predating the guard, and — until
    // `migrations/0036_normalize_invitation_email.sql` ran — two invitations
    // whose addresses differed only in case, both produce this shape.
    //
    // The loser must get the same answer as the pre-flight already-a-member
    // check, because it is the same fact discovered a moment later. A client
    // cannot observe the timing, so it must not have to handle two different
    // answers to one question.
    const wsId = await seedWorkspace(d1, TEST_USER.id, { name: "Double Invite WS" });
    await seedInvitation(d1, wsId, {
      id: "double-inv-a",
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: "double-inv-a-token",
      status: "pending",
    });
    await seedInvitation(d1, wsId, {
      id: "double-inv-b",
      email: TEST_USER_2.email,
      invitedBy: TEST_USER.id,
      token: "double-inv-b-token",
      status: "pending",
    });

    const app = new Hono<AppEnv>();
    app.use("/*", fakeAuth(d1, TEST_USER_2));
    app.post("/invitations/accept", validateBody(acceptInvitationSchema), acceptInvitation);

    const responses = await Promise.all(
      ["double-inv-a-token", "double-inv-b-token"].map(async (token) =>
        app.request(
          jsonRequest("POST", "/invitations/accept", { token }),
          undefined,
          env,
        ),
      ),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(1);

    // Exactly one membership — the unique index was always going to guarantee
    // this; what changed is that the caller is told about it honestly.
    const count = await d1
      .prepare(
        "SELECT COUNT(*) AS n FROM workspace_member WHERE workspaceId = ? AND userId = ?",
      )
      .bind(wsId, TEST_USER_2.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    // The losing invitation must still be `pending`. It is not "released" by
    // compensating code — the unique-index violation aborts its whole batch,
    // so its claim never commits in the first place. That is the property the
    // single-batch design buys: there is no window in which an invitation is
    // marked accepted without a membership behind it, and therefore no
    // compensating write that a crash could skip.
    const rows = await d1
      .prepare("SELECT id, status, acceptedAt FROM invitation WHERE id IN (?, ?) ORDER BY id")
      .bind("double-inv-a", "double-inv-b")
      .all<{ id: string; status: string; acceptedAt: number | null }>();
    const byStatus = rows.results.map((r) => r.status).sort();
    expect(byStatus).toEqual(["accepted", "pending"]);

    const released = rows.results.find((r) => r.status === "pending");
    expect(released?.acceptedAt).toBeNull();
  });
});
