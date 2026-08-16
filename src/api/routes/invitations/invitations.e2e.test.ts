/// <reference types="@cloudflare/workers-types" />
/**
 * End-to-end tests for the invitation routes' authorization wiring.
 *
 * ## Why this file exists separately from `invitations.handlers.test.ts`
 *
 * The handler tests prime a context and call handlers directly, so they can
 * prove what a middleware *does* but never that the production route tree
 * actually *mounts* it. For `GET /workspaces/:id/invitations/:id/link` that
 * gap matters more than usual: it is the only endpoint left that returns a
 * raw invitation token, and the thing standing between a machine credential
 * and that token is one `rejectPatAuth()` line in `invitations.routes.ts`.
 * Deleting that line breaks no handler test.
 *
 * So this file exercises the real router (`src/api/routes/index.ts`) behind
 * the real `authSessionMiddleware`, with a real PAT minted through the real
 * mint endpoint and presented as a real `Authorization: Bearer` header —
 * the same harness shape as `api-tokens.e2e.test.ts`. Only better-auth's
 * cookie session resolver and the email transport are mocked; both are
 * external boundaries this integration does not own.
 *
 * Background: audit findings 03 and 04 in `swarm/plans/multi-user-audit.md`.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/auth", () => ({
  createAuth: vi.fn(),
  resolveAllowedOrigin: (origin: string | undefined) => origin ?? null,
  resetAuthCache: vi.fn(),
}));

type EmailMessage = { to: string; from?: string; subject: string; html: string; text?: string };
const mockEmailSend = vi.fn<(msg: EmailMessage) => Promise<{ id: string }>>(() =>
  Promise.resolve({ id: "test-email-id" }),
);
vi.mock("../../lib/email", () => ({
  createEmailService: vi.fn(() => ({ send: mockEmailSend })),
}));

import { createDb } from "../../../db";
import type { AppEnv } from "../../env";
import { createAuth } from "../../lib/auth";
import { authSessionMiddleware } from "../../middleware/auth";
import routes from "../../routes";
import {
  createTestD1,
  seedInvitation,
  seedUser,
  seedWorkspace,
  TEST_TOKEN_HASH_PEPPER,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
/** Workspaces TEST_USER is invited to but is NOT already a member of. */
let patAcceptWsId: string;
let cookieAcceptWsId: string;

const mockCreateAuth = vi.mocked(createAuth);

/** Resolve a session for any request carrying the test cookie, else null. */
function installCookieAuthMock() {
  mockCreateAuth.mockImplementation(
    () =>
      ({
        api: {
          getSession: vi.fn(({ headers }: { headers: Headers }) => {
            const cookie = headers.get("cookie") ?? "";
            if (!cookie.includes("better-auth.session_token=")) {
              return Promise.resolve(null);
            }
            return Promise.resolve({
              user: { ...TEST_USER },
              session: {
                id: "test-session-id",
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              },
            });
          }),
        },
      }) as never,
  );
}

function buildE2EApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    const env = c.env as Record<string, unknown>;
    env.DB = d1;
    env.BETTER_AUTH_SECRET = "test-secret";
    env.BETTER_AUTH_URL = "https://cadence.example.com";
    env.TOKEN_HASH_PEPPER = TEST_TOKEN_HASH_PEPPER;
    c.set("db", createDb(d1));
    c.set("requestId", "test-request-id");
    await next();
  });
  app.use("*", authSessionMiddleware);
  app.route("/", routes);
  return app;
}

function cookieRequest(method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = {
    cookie: "better-auth.session_token=test-session-token",
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

function patRequest(
  plaintext: string,
  method: string,
  path: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = { Authorization: `Bearer ${plaintext}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

/** Mint a real PAT through the real endpoint and return its plaintext. */
async function mintPat(app: Hono<AppEnv>, scopes: string[]): Promise<string> {
  const res = await app.request(
    cookieRequest("POST", `/workspaces/${workspaceId}/api-tokens`, {
      name: "invite-link probe",
      scopes,
      projectScope: "all",
    }),
  );
  expect(res.status).toBe(201);
  const body = await res.json<{ token: { plaintext: string } }>();
  return body.token.plaintext;
}

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1, TEST_USER);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  await seedInvitation(d1, workspaceId, {
    id: "e2e-link-inv",
    email: "e2e-invitee@example.com",
    invitedBy: TEST_USER.id,
    token: "e2e-secret-invite-token",
    status: "pending",
  });

  // Two further workspaces owned by someone else, each with a live invitation
  // addressed to TEST_USER. Separate workspaces so the PAT and cookie accept
  // tests share no state and can run in any order: accepting one makes
  // TEST_USER a member, which would change the other's expected outcome.
  await seedUser(d1, TEST_USER_2);
  patAcceptWsId = await seedWorkspace(d1, TEST_USER_2.id, { name: "PAT Accept WS" });
  await seedInvitation(d1, patAcceptWsId, {
    id: "e2e-pat-accept-inv",
    email: TEST_USER.email,
    invitedBy: TEST_USER_2.id,
    token: "e2e-pat-accept-token",
    status: "pending",
  });
  cookieAcceptWsId = await seedWorkspace(d1, TEST_USER_2.id, { name: "Cookie Accept WS" });
  await seedInvitation(d1, cookieAcceptWsId, {
    id: "e2e-cookie-accept-inv",
    email: TEST_USER.email,
    invitedBy: TEST_USER_2.id,
    token: "e2e-cookie-accept-token",
    status: "pending",
  });
});

afterAll(async () => {
  await dispose();
});

beforeEach(() => {
  installCookieAuthMock();
  mockEmailSend.mockClear();
});

describe("E2E: invitation token disclosure boundaries", () => {
  it("serves the invite link to a cookie-authenticated owner", async () => {
    // The human recovery path this control exists for. Asserted first so the
    // PAT refusal below cannot pass by the route being broken for everyone.
    const app = buildE2EApp();
    const res = await app.request(
      cookieRequest("GET", `/workspaces/${workspaceId}/invitations/e2e-link-inv/link`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ url: string }>();
    expect(body.url).toBe("https://cadence.example.com/invite/e2e-secret-invite-token");
  });

  it("refuses the invite link to a PAT, even one minted by the workspace owner", async () => {
    // Proves the production mount, not just the middleware: PAT auth bridges
    // TEST_USER into the request, so `requireAuth` and
    // `requireWorkspaceRole("owner","admin")` both pass. Only the
    // `rejectPatAuth()` line in `invitations.routes.ts` stops a machine
    // credential harvesting an invitation credential.
    const app = buildE2EApp();
    const plaintext = await mintPat(app, ["workspace:read", "invitation:write"]);

    const res = await app.request(
      patRequest(
        plaintext,
        "GET",
        `/workspaces/${workspaceId}/invitations/e2e-link-inv/link`,
      ),
    );

    expect(res.status).toBe(403);
    expect(await res.clone().text()).not.toContain("e2e-secret-invite-token");
    expect((await res.json<{ error: string }>()).error).toBe(
      "API tokens cannot retrieve invitation links",
    );
  });

  it("never returns the raw token from the admin invitation list, on either auth path", async () => {
    // The list stays reachable — narrowing the response must not have turned
    // into an outage for the members page — but the secret is gone from it.
    const app = buildE2EApp();
    const plaintext = await mintPat(app, ["workspace:read", "invitation:write"]);

    for (const req of [
      cookieRequest("GET", `/workspaces/${workspaceId}/invitations`),
      patRequest(plaintext, "GET", `/workspaces/${workspaceId}/invitations`),
    ]) {
      const res = await app.request(req);
      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toContain("e2e-secret-invite-token");
      const body = JSON.parse(raw) as { invitations: Record<string, unknown>[] };
      expect(body.invitations.length).toBeGreaterThan(0);
      for (const inv of body.invitations) {
        expect(inv).not.toHaveProperty("token");
      }
    }
  });
});

describe("E2E: listing your pending invitations is closed to machine credentials", () => {
  it("serves the pending list to a cookie session, across workspaces", async () => {
    // Asserted first, and deliberately asserting the CROSS-workspace result:
    // the endpoint selects by the caller's email, not by workspace, and that
    // is correct for a human — you must be able to see an invitation from a
    // workspace you are not yet in, or you could never join one. Without this
    // the PAT refusal below would also pass against an endpoint that had
    // simply been broken for everyone.
    const app = buildE2EApp();
    const res = await app.request(cookieRequest("GET", "/invitations/pending"));

    expect(res.status).toBe(200);
    const body = await res.json<{ invitations: { workspace: { id: string } }[] }>();
    expect(body.invitations.map((i) => i.workspace.id).sort()).toEqual(
      [patAcceptWsId, cookieAcceptWsId].sort(),
    );
  });

  it("refuses a PAT, disclosing no workspace it is not bound to", async () => {
    // The same sequence finding 14 closed at its second step: this endpoint is
    // how a caller DISCOVERS which invitations it can accept, so leaving it
    // open left the discovery half of the credential-acquisition path reachable
    // by a machine credential while accept itself was shut.
    //
    // It is also a workspace-binding leak, which is what this asserts. The PAT
    // is minted in `workspaceId`; both pending invitations belong to OTHER
    // workspaces owned by someone else. Before the fix the token read their ids
    // and display names — tenants it was never bound to — so the assertion
    // below is on the response body, not merely on the status.
    const app = buildE2EApp();
    const plaintext = await mintPat(app, ["workspace:read", "invitation:write"]);

    const res = await app.request(patRequest(plaintext, "GET", "/invitations/pending"));

    expect(res.status).toBe(403);
    const text = await res.clone().text();
    expect(text).not.toContain(patAcceptWsId);
    expect(text).not.toContain(cookieAcceptWsId);
    expect((await res.json<{ error: string }>()).error).toBe(
      "API tokens cannot list invitations",
    );
  });
});

describe("E2E: accepting an invitation is closed to machine credentials", () => {
  it("refuses a PAT, granting no membership and consuming no invitation", async () => {
    // The highest-severity item in this batch, and it is only observable
    // end-to-end. `authSessionMiddleware` verifies the PAT and then bridges its
    // owner into `c.get("user")` as an ordinary user, so `requireAuth` cannot
    // tell the two apart — every handler-level test of `acceptInvitation`
    // passes with or without the guard. The scope machinery cannot cover it
    // either: this route mounts no scope, and the correct policy is not "needs
    // `invitation:write`" but "no token may do this at all", because accepting
    // an invitation converts a bearer credential into durable workspace
    // membership — a second credential of a longer-lived class.
    //
    // The token below is minted with `task:read` and nothing else, which is
    // the point: before `rejectPatAuth()`, that token could insert a
    // `workspace_member` row and fire `invitation.accepted` /
    // `workspace.member_joined` webhooks.
    const app = buildE2EApp();
    const plaintext = await mintPat(app, ["task:read"]);

    const res = await app.request(
      patRequest(plaintext, "POST", "/invitations/accept", {
        token: "e2e-pat-accept-token",
      }),
    );

    expect(res.status).toBe(403);
    // The body must name the right refusal. `rejectPatAuth`'s default message
    // is about token management, which on this route is simply false and sends
    // an integration developer hunting for a scope that does not exist.
    expect((await res.clone().json<{ error: string }>()).error).toBe(
      "API tokens cannot accept invitations",
    );

    // Post-conditions, not just the status: a 403 that had already written the
    // membership row would be the same breach with a different label.
    const membership = await d1
      .prepare("SELECT id FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(patAcceptWsId, TEST_USER.id)
      .first<{ id: string }>();
    expect(membership).toBeNull();

    const inv = await d1
      .prepare("SELECT status, acceptedAt FROM invitation WHERE id = ?")
      .bind("e2e-pat-accept-inv")
      .first<{ status: string; acceptedAt: number | null }>();
    expect(inv?.status).toBe("pending");
    expect(inv?.acceptedAt).toBeNull();
  });

  it("still accepts for a cookie session, writing the membership row", async () => {
    // The other half of the same guard. Asserted so that "PAT gets 403" can
    // never be satisfied by the route being broken for everyone — the failure
    // mode a lockout fix is most likely to ship with.
    const app = buildE2EApp();
    const res = await app.request(
      cookieRequest("POST", "/invitations/accept", {
        token: "e2e-cookie-accept-token",
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json<{ workspaceId: string }>()).workspaceId).toBe(cookieAcceptWsId);

    const membership = await d1
      .prepare(
        "SELECT role FROM workspace_member WHERE workspaceId = ? AND userId = ?",
      )
      .bind(cookieAcceptWsId, TEST_USER.id)
      .first<{ role: string }>();
    expect(membership?.role).toBe("member");

    const inv = await d1
      .prepare("SELECT status FROM invitation WHERE id = ?")
      .bind("e2e-cookie-accept-inv")
      .first<{ status: string }>();
    expect(inv?.status).toBe("accepted");
  });
});

describe("E2E: invitation creation is rate limited", () => {
  it("carries the invite-create limiter on the production route", async () => {
    // Proves the mount and its numbers without exhausting the bucket: the
    // limiter's counter Map is closure-scoped per middleware instance, and the
    // route tree in `src/api/routes/index.ts` is a module-level singleton, so
    // firing 21 requests here would poison every other test in this file.
    // `rateLimit` sets these headers on every response it passes through, so
    // their presence and value is the mount. The 429-and-no-row behaviour is
    // asserted against a dedicated instance in `invitations.handlers.test.ts`.
    //
    // Why it matters at all: creating an invitation now sends mail to an
    // attacker-chosen address, so an unlimited create endpoint is a mail-bomb
    // primitive whose damage — a blocklisted sending domain — outlives the
    // session that caused it.
    const app = buildE2EApp();
    const res = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/invitations`, {
        email: "ratelimit-probe@example.com",
      }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("20");
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });
});
