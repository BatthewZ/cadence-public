/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the ICS calendar feed endpoint and its management
 * surface.
 *
 * ## Why these tests matter
 *
 * The feed endpoint is the only unauthenticated-by-design surface in the API
 * — the `cdn_cal_…` token in the URL is the whole credential. Every test
 * below pins one invariant that, if silently regressed, becomes either a
 * data leak or a credential-handling bug:
 *
 *  - **Uniform 404, no oracle.** Garbage tokens, well-formed-but-unknown
 *    tokens, and PAT-prefixed tokens must produce byte-identical failures,
 *    or the endpoint becomes an enumeration oracle for live feed URLs.
 *  - **Prefix cheap-reject.** A real PAT plaintext pasted into a feed URL
 *    must never unlock the feed — the credential classes are disjoint.
 *  - **Membership re-check.** Removing a user from a workspace must kill
 *    their feed on the very next fetch even though the token row survives.
 *  - **Plaintext-once.** Mint returns the URL exactly once; the DB stores
 *    only the HMAC hash; regenerate atomically kills the old URL.
 *  - **PAT lockout on management.** A leaked PAT must not be able to mint a
 *    second, independently-revocable credential (the feed) for its user.
 *  - **RFC 5545 correctness.** Stable UIDs (clients dedupe by UID),
 *    exclusive DTEND (+1 day), STATUS:COMPLETED retention — each one is a
 *    visible calendar bug for every subscriber if it drifts.
 *
 * ## Harness
 *
 * Mounts the REAL `calendar.routes.ts` (with its full middleware chain:
 * rate limits, rejectPatAuth, requireWorkspaceMember, no-store) behind the
 * REAL `authSessionMiddleware`, against a real Miniflare D1 — so the tests
 * exercise the same path production requests take. Only better-auth's
 * cookie-session resolver is mocked (external boundary). Feed tokens and
 * PATs are seeded through the production `mintToken`/`hashToken` primitives
 * so the stored hashes are the real thing, not fixtures.
 */

import { Hono } from "hono";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mock better-auth's session resolver BEFORE importing the middleware that
// consumes it — vitest hoists vi.mock, but keeping the declaration first
// makes the substitution obvious to readers.
vi.mock("../../lib/auth", () => ({
  createAuth: vi.fn(),
  resetAuthCache: vi.fn(),
  resolveAllowedOrigin: (origin: string | undefined) => origin ?? null,
}));

import { createDb } from "../../../db";
import type { AppEnv } from "../../env";
import {
  CALENDAR_FEED_TOKEN_PREFIX,
  hashToken,
  mintToken,
  TOKEN_PREFIX,
} from "../../lib/api-tokens";
import { createAuth } from "../../lib/auth";
import { authSessionMiddleware } from "../../middleware/auth";
import {
  createTestD1,
  seedProject,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_TOKEN_HASH_PEPPER,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import calendarRoutes from "./calendar.routes";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;
/** Primary workspace — TEST_USER is the owner. */
let workspaceId: string;
/** Workspace owned by TEST_USER_2; TEST_USER is NOT a member. */
let foreignWorkspaceId: string;
/** Dedicated workspace for the membership-revocation test. */
let revocableWorkspaceId: string;
let projectId: string;
let taskGroupId: string;
let foreignProjectId: string;
let foreignTaskGroupId: string;

const mockCreateAuth = vi.mocked(createAuth);

/**
 * Cookie requests resolve to TEST_USER; requests without the session cookie
 * resolve to no session. Mirrors better-auth closely enough to drive both
 * branches of the real authSessionMiddleware.
 */
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

/**
 * Production-shaped app: env bindings (DB, BETTER_AUTH_URL, pepper) → db on
 * context → real auth middleware → the real calendar route tree. This is
 * the same wiring `src/api/index.ts` performs, minus globals (CORS, logging)
 * that are tested elsewhere and would only add noise here.
 */
function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    const env = c.env as Record<string, unknown>;
    env.DB = d1;
    env.BETTER_AUTH_SECRET = "test-secret";
    env.BETTER_AUTH_URL = "http://localhost";
    env.TOKEN_HASH_PEPPER = TEST_TOKEN_HASH_PEPPER;
    c.set("db", createDb(d1));
    c.set("requestId", "test-request-id");
    await next();
  });

  app.use("*", authSessionMiddleware);
  app.route("/", calendarRoutes);
  return app;
}

function cookieRequest(method: string, path: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { cookie: "better-auth.session_token=test-session-token" },
  });
}

function patRequest(plaintext: string, method: string, path: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${plaintext}` },
  });
}

/** Anonymous request — the shape every calendar client sends. */
function feedRequest(token: string): Request {
  return new Request(`http://localhost/calendar/feed/${token}`, {
    method: "GET",
  });
}

/**
 * Seed a feed token through the REAL mint primitive so the stored hash is a
 * genuine peppered HMAC — fixture hashes would silently stop covering the
 * `hashToken` round-trip that production verification depends on.
 */
async function seedFeedToken(opts?: {
  userId?: string;
  workspaceId?: string;
}): Promise<{ plaintext: string; id: string }> {
  const { plaintext, hash } = await mintToken(
    CALENDAR_FEED_TOKEN_PREFIX,
    TEST_TOKEN_HASH_PEPPER,
  );
  const id = crypto.randomUUID();
  await d1
    .prepare(
      "INSERT INTO calendar_feed_token (id, userId, workspaceId, tokenHash, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?, NULL)",
    )
    .bind(
      id,
      opts?.userId ?? TEST_USER.id,
      opts?.workspaceId ?? workspaceId,
      hash,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return { plaintext, id };
}

/**
 * Seed a live PAT for TEST_USER in the primary workspace so the real
 * authSessionMiddleware PAT branch authenticates it — required to prove the
 * management surface's `rejectPatAuth()` actually fires for verified PATs,
 * not just malformed bearers.
 */
async function seedPat(): Promise<string> {
  const { plaintext, hash } = await mintToken(
    TOKEN_PREFIX,
    TEST_TOKEN_HASH_PEPPER,
  );
  await d1
    .prepare(
      `INSERT INTO api_token (id, userId, workspaceId, name, tokenHash, tokenPrefix, scopes, projectScope, projectIds, lastUsedAt, expiresAt, revokeAt, revokedAt, rotatedToId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'all', NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      TEST_USER.id,
      workspaceId,
      "Calendar test PAT",
      hash,
      plaintext.slice(0, 12),
      JSON.stringify(["read:*", "write:*"]),
      Math.floor(Date.now() / 1000),
    )
    .run();
  return plaintext;
}

/** Set `completedAt` directly (the shared seedTask helper does not cover it). */
async function setCompletedAt(taskId: string, when: Date): Promise<void> {
  await d1
    .prepare("UPDATE task SET completedAt = ? WHERE id = ?")
    .bind(Math.floor(when.getTime() / 1000), taskId)
    .run();
}

/**
 * Undo RFC 5545 §3.1 line folding (CRLF + single space) so assertions can
 * match logical content lines — SUMMARY/DESCRIPTION/URL lines longer than
 * 75 octets are physically split in the wire format.
 */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id, {
    name: "Primary Workspace",
    slug: "primary-ws",
  });
  foreignWorkspaceId = await seedWorkspace(d1, TEST_USER_2.id, {
    name: "Foreign Workspace",
    slug: "foreign-ws",
  });
  revocableWorkspaceId = await seedWorkspace(d1, TEST_USER.id, {
    name: "Revocable Workspace",
    slug: "revocable-ws",
  });
  projectId = await seedProject(d1, workspaceId, { name: "Feed Project" });
  taskGroupId = await seedTaskGroup(d1, projectId);
  foreignProjectId = await seedProject(d1, foreignWorkspaceId, {
    name: "Foreign Project",
  });
  foreignTaskGroupId = await seedTaskGroup(d1, foreignProjectId);
});

afterAll(async () => {
  await dispose();
});

beforeEach(() => {
  installCookieAuthMock();
});

afterEach(async () => {
  // Tests seed their own tasks/tokens; clean between tests so feed-content
  // and row-count assertions stay isolated. Workspaces/projects from
  // beforeAll persist (recreating them per test would dominate runtime).
  await d1.prepare("DELETE FROM task").run();
  await d1.prepare("DELETE FROM calendar_feed_token").run();
  await d1.prepare("DELETE FROM api_token").run();
});

// ---------------------------------------------------------------------------
// Feed endpoint — content
// ---------------------------------------------------------------------------

describe("GET /calendar/feed/:token — content", () => {
  it("serves the assignee's due tasks as ICS and scopes strictly to the token's workspace", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();

    const mineId = await seedTask(d1, projectId, taskGroupId, {
      title: "Ship the calendar feed",
      assigneeId: TEST_USER.id,
      dueDate: new Date("2026-03-10"),
    });
    // Excluded: assigned to someone else.
    await seedTask(d1, projectId, taskGroupId, {
      title: "Someone elses task",
      assigneeId: TEST_USER_2.id,
      dueDate: new Date("2026-03-10"),
    });
    // Excluded: NO dates at all (neither start nor due) — an undateable event
    // cannot be placed on a calendar. (A start-only task IS included — see the
    // dedicated start-only test below.)
    await seedTask(d1, projectId, taskGroupId, {
      title: "No due date task",
      assigneeId: TEST_USER.id,
    });
    // Excluded: same assignee but a DIFFERENT workspace — one workspace's
    // feed URL must never leak tasks from the user's other workspaces.
    await seedTask(d1, foreignProjectId, foreignTaskGroupId, {
      title: "Cross workspace task",
      assigneeId: TEST_USER.id,
      dueDate: new Date("2026-03-10"),
    });

    const res = await app.request(feedRequest(plaintext));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");

    const body = unfold(await res.text());
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("X-WR-CALNAME:Cadence — Primary Workspace");
    expect(body).toContain("SUMMARY:Ship the calendar feed");
    expect(body).toContain(`UID:task-${mineId}@cadence`);
    // Single-day event: DTEND is exclusive → due + 1 day.
    expect(body).toContain("DTSTART;VALUE=DATE:20260310");
    expect(body).toContain("DTEND;VALUE=DATE:20260311");
    // Canonical deep link, in both URL and DESCRIPTION (project context).
    const taskUrl = `http://localhost/w/primary-ws/projects/${projectId}/board?task=${mineId}`;
    expect(body).toContain(`URL:${taskUrl}`);
    expect(body).toContain(`DESCRIPTION:Project: Feed Project\\n${taskUrl}`);

    expect(body).not.toContain("Someone elses task");
    expect(body).not.toContain("No due date task");
    expect(body).not.toContain("Cross workspace task");
  });

  it("emits exclusive DTEND for multi-day spans (start → due + 1 day)", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();

    await seedTask(d1, projectId, taskGroupId, {
      title: "Span task",
      assigneeId: TEST_USER.id,
      startDate: new Date("2026-03-10"),
      dueDate: new Date("2026-03-12"),
    });

    const body = unfold(await (await app.request(feedRequest(plaintext))).text());
    expect(body).toContain("DTSTART;VALUE=DATE:20260310");
    // Inclusive last day is the 12th, so exclusive DTEND is the 13th. A
    // regression here clips the final day off every multi-day task for
    // every subscriber.
    expect(body).toContain("DTEND;VALUE=DATE:20260313");
  });

  it("includes a start-only task (no due date) as a single all-day event on its start day", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();

    const startOnlyId = await seedTask(d1, projectId, taskGroupId, {
      title: "Kickoff with no deadline",
      assigneeId: TEST_USER.id,
      startDate: new Date("2026-03-10"),
    });

    const body = unfold(await (await app.request(feedRequest(plaintext))).text());
    // A start date with no due date is still scheduled work the subscriber
    // wants on their calendar — it sits on the start day as a single all-day
    // event (exclusive DTEND = start + 1).
    expect(body).toContain("SUMMARY:Kickoff with no deadline");
    expect(body).toContain(`UID:task-${startOnlyId}@cadence`);
    expect(body).toContain("DTSTART;VALUE=DATE:20260310");
    expect(body).toContain("DTEND;VALUE=DATE:20260311");
  });

  it("includes recently-completed tasks with STATUS:COMPLETED and excludes stale or timestampless completions", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();

    await seedTask(d1, projectId, taskGroupId, {
      title: "Open task",
      assigneeId: TEST_USER.id,
      dueDate: new Date("2026-04-01"),
    });
    const recentDoneId = await seedTask(d1, projectId, taskGroupId, {
      title: "Recently done task",
      assigneeId: TEST_USER.id,
      completed: true,
      dueDate: new Date("2026-04-02"),
    });
    await setCompletedAt(recentDoneId, new Date(Date.now() - DAY_MS));
    const staleDoneId = await seedTask(d1, projectId, taskGroupId, {
      title: "Stale done task",
      assigneeId: TEST_USER.id,
      completed: true,
      dueDate: new Date("2026-04-03"),
    });
    await setCompletedAt(staleDoneId, new Date(Date.now() - 40 * DAY_MS));
    // completed=true but completedAt NULL: recency is unprovable, so the
    // OR-branch must fail closed and exclude it.
    await seedTask(d1, projectId, taskGroupId, {
      title: "Timestampless done task",
      assigneeId: TEST_USER.id,
      completed: true,
      dueDate: new Date("2026-04-04"),
    });

    const body = unfold(await (await app.request(feedRequest(plaintext))).text());
    expect(body).toContain("SUMMARY:Open task");
    expect(body).toContain("SUMMARY:Recently done task");
    expect(body).not.toContain("Stale done task");
    expect(body).not.toContain("Timestampless done task");
    // Exactly one STATUS:COMPLETED — the open task must not carry it.
    expect(body.match(/STATUS:COMPLETED/g)).toHaveLength(1);
  });

  it("keeps UIDs stable across fetches so subscribed clients update in place", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();
    const taskId = await seedTask(d1, projectId, taskGroupId, {
      title: "Stable UID task",
      assigneeId: TEST_USER.id,
      dueDate: new Date("2026-05-01"),
    });

    const first = unfold(await (await app.request(feedRequest(plaintext))).text());
    const second = unfold(await (await app.request(feedRequest(plaintext))).text());

    const uidsOf = (ics: string) => ics.match(/UID:[^\r\n]+/g) ?? [];
    expect(uidsOf(first)).toEqual([`UID:task-${taskId}@cadence`]);
    // Unstable UIDs would duplicate every event on every refresh in Google /
    // Apple Calendar — byte-equality across fetches is the contract.
    expect(uidsOf(second)).toEqual(uidsOf(first));
    expect(second).toBe(first);
  });

  it("strips an optional .ics suffix from the token path segment", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();
    await seedTask(d1, projectId, taskGroupId, {
      title: "Suffix task",
      assigneeId: TEST_USER.id,
      dueDate: new Date("2026-05-02"),
    });

    const res = await app.request(feedRequest(`${plaintext}.ics`));
    expect(res.status).toBe(200);
    const body = unfold(await res.text());
    expect(body).toContain("SUMMARY:Suffix task");
  });

  it("caps the feed at 500 events, keeping the earliest-due tasks", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();

    // Seed 501 tasks with strictly ascending due dates via chunked batches —
    // D1 caps bound parameters per statement, so one mega-INSERT is not an
    // option, and 501 sequential round-trips would dominate the suite.
    const baseUtc = Date.UTC(2026, 0, 1);
    const nowSec = Math.floor(Date.now() / 1000);
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 501; i += 1) {
      stmts.push(
        d1
          .prepare(
            `INSERT INTO task (id, projectId, taskGroupId, title, completed, priority, assigneeId, dueDate, position, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, 0, 'none', ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            projectId,
            taskGroupId,
            `Bulk task ${i}`,
            TEST_USER.id,
            Math.floor((baseUtc + i * DAY_MS) / 1000),
            `bulk${String(i).padStart(6, "0")}`,
            nowSec,
            nowSec,
          ),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) {
      await d1.batch(stmts.slice(i, i + 100));
    }

    const body = unfold(await (await app.request(feedRequest(plaintext))).text());
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(500);
    // Ordered by dueDate ASC, so the overflow victim is the LATEST due task.
    expect(body).toContain("SUMMARY:Bulk task 0");
    expect(body).toContain("SUMMARY:Bulk task 499");
    expect(body).not.toContain("SUMMARY:Bulk task 500");
    // Heavy setup (501 chunked inserts) + 500-event ICS generation legitimately
    // exceeds the 5s default under full-suite parallel CPU contention (~3s solo,
    // but spikes past 5s when other test files compete). Generous explicit
    // timeout reflects the real work without weakening any assertion above.
  }, 20000);
});

// ---------------------------------------------------------------------------
// Feed endpoint — verification failures (uniform 404, no oracle)
// ---------------------------------------------------------------------------

describe("GET /calendar/feed/:token — verification", () => {
  it("returns identical 404s for garbage, unknown-but-well-formed, and PAT-prefixed tokens", async () => {
    const app = buildApp();
    await seedFeedToken(); // a live token exists; none of these may match it

    // Garbage: cheap-rejected before any hash or DB work.
    const garbage = await app.request(feedRequest("garbage"));
    // Well-formed cdn_cal_ token minted but never persisted: survives the
    // prefix check, hashes, then misses the DB.
    const { plaintext: unknownToken } = await mintToken(
      CALENDAR_FEED_TOKEN_PREFIX,
      TEST_TOKEN_HASH_PEPPER,
    );
    const unknown = await app.request(feedRequest(unknownToken));
    // PAT prefix: the credential classes are disjoint — even a syntactically
    // perfect PAT must be cheap-rejected by the cdn_cal_ prefix gate.
    const pat = await app.request(
      feedRequest(`${TOKEN_PREFIX}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`),
    );

    expect(garbage.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(pat.status).toBe(404);

    // No oracle: every failure mode must be indistinguishable on the wire.
    const garbageBody = await garbage.json<{ error: string }>();
    const unknownBody = await unknown.json<{ error: string }>();
    const patBody = await pat.json<{ error: string }>();
    expect(unknownBody.error).toBe(garbageBody.error);
    expect(patBody.error).toBe(garbageBody.error);
  });

  it("kills the feed the moment workspace membership is revoked", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken({
      workspaceId: revocableWorkspaceId,
    });

    const before = await app.request(feedRequest(plaintext));
    expect(before.status).toBe(200);

    // Revoke the membership — the token row is untouched.
    await d1
      .prepare("DELETE FROM workspace_member WHERE workspaceId = ? AND userId = ?")
      .bind(revocableWorkspaceId, TEST_USER.id)
      .run();

    // The re-check must fire on the very next fetch — no sweep job, no
    // cache window. And it must look exactly like an unknown token.
    const after = await app.request(feedRequest(plaintext));
    expect(after.status).toBe(404);
  });

  it("rate-limits per token: 31st fetch inside the window gets 429", async () => {
    const app = buildApp();
    const { plaintext } = await seedFeedToken();

    for (let i = 0; i < 30; i += 1) {
      const res = await app.request(feedRequest(plaintext));
      expect(res.status).toBe(200);
    }
    const blocked = await app.request(feedRequest(plaintext));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Management surface
// ---------------------------------------------------------------------------

describe("calendar-feed management surface", () => {
  it("GET reports exists:false (with no-store) before any feed is minted", async () => {
    const app = buildApp();
    const res = await app.request(
      cookieRequest("GET", `/workspaces/${workspaceId}/calendar-feed`),
    );
    expect(res.status).toBe(200);
    // Credential telemetry must never sit in a shared cache.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      exists: false,
      createdAt: null,
      lastUsedAt: null,
    });
  });

  it("POST mints an absolute one-time URL and persists only the peppered hash", async () => {
    const app = buildApp();
    const res = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/calendar-feed`),
    );
    expect(res.status).toBe(201);
    const { url } = await res.json<{ url: string }>();
    // 32 random bytes → 43 unpadded base64url chars.
    expect(url).toMatch(
      new RegExp(
        `^http://localhost/api/calendar/feed/${CALENDAR_FEED_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`,
      ),
    );

    const plaintext = url.slice(url.lastIndexOf("/") + 1);
    const rows = await d1
      .prepare("SELECT tokenHash FROM calendar_feed_token WHERE userId = ? AND workspaceId = ?")
      .bind(TEST_USER.id, workspaceId)
      .all<{ tokenHash: string }>();
    expect(rows.results).toHaveLength(1);
    // Plaintext-once contract: only the HMAC lives in the DB.
    expect(rows.results[0].tokenHash).not.toContain(plaintext);
    expect(rows.results[0].tokenHash).toBe(
      await hashToken(plaintext, TEST_TOKEN_HASH_PEPPER),
    );

    // The minted URL's token must actually open the feed (mint → verify
    // round-trip through the production hash path, mounted at /api in prod
    // and at / in this harness).
    const feedPath = new URL(url).pathname.replace(/^\/api/, "");
    const feedRes = await app.request(
      new Request(`http://localhost${feedPath}`, { method: "GET" }),
    );
    expect(feedRes.status).toBe(200);
  });

  it("regenerating replaces the row and instantly kills the old URL", async () => {
    const app = buildApp();
    const first = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/calendar-feed`),
    );
    const { url: urlA } = await first.json<{ url: string }>();
    const second = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/calendar-feed`),
    );
    expect(second.status).toBe(201);
    const { url: urlB } = await second.json<{ url: string }>();
    expect(urlB).not.toBe(urlA);

    // One feed per user per workspace — upsert, never a second row.
    const count = await d1
      .prepare("SELECT COUNT(*) AS n FROM calendar_feed_token WHERE userId = ? AND workspaceId = ?")
      .bind(TEST_USER.id, workspaceId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const tokenA = urlA.slice(urlA.lastIndexOf("/") + 1);
    const tokenB = urlB.slice(urlB.lastIndexOf("/") + 1);
    // Old credential dead, new credential live — atomic rotation.
    expect((await app.request(feedRequest(tokenA))).status).toBe(404);
    expect((await app.request(feedRequest(tokenB))).status).toBe(200);
  });

  it("DELETE revokes the feed, is idempotent, and the old URL 404s", async () => {
    const app = buildApp();
    const minted = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/calendar-feed`),
    );
    const { url } = await minted.json<{ url: string }>();
    const token = url.slice(url.lastIndexOf("/") + 1);

    const del = await app.request(
      cookieRequest("DELETE", `/workspaces/${workspaceId}/calendar-feed`),
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    expect((await app.request(feedRequest(token))).status).toBe(404);

    const status = await app.request(
      cookieRequest("GET", `/workspaces/${workspaceId}/calendar-feed`),
    );
    expect(await status.json()).toEqual({
      exists: false,
      createdAt: null,
      lastUsedAt: null,
    });

    // Idempotent: a retried revoke must not error.
    const delAgain = await app.request(
      cookieRequest("DELETE", `/workspaces/${workspaceId}/calendar-feed`),
    );
    expect(delAgain.status).toBe(200);
    expect(await delAgain.json()).toEqual({ ok: true });
  });

  it("GET reflects createdAt immediately and lastUsedAt after a feed fetch", async () => {
    const app = buildApp();
    const minted = await app.request(
      cookieRequest("POST", `/workspaces/${workspaceId}/calendar-feed`),
    );
    const { url } = await minted.json<{ url: string }>();
    const token = url.slice(url.lastIndexOf("/") + 1);

    const before = await app.request(
      cookieRequest("GET", `/workspaces/${workspaceId}/calendar-feed`),
    );
    const beforeBody = await before.json<{
      exists: boolean;
      createdAt: string | null;
      lastUsedAt: string | null;
    }>();
    expect(beforeBody.exists).toBe(true);
    expect(beforeBody.createdAt).toEqual(expect.any(String));
    expect(beforeBody.lastUsedAt).toBeNull();

    // A feed fetch bumps lastUsedAt via deferred work — poll the DB rather
    // than sleeping, since the bump is fire-and-forget by design.
    expect((await app.request(feedRequest(token))).status).toBe(200);
    await vi.waitFor(async () => {
      const row = await d1
        .prepare("SELECT lastUsedAt FROM calendar_feed_token WHERE userId = ? AND workspaceId = ?")
        .bind(TEST_USER.id, workspaceId)
        .first<{ lastUsedAt: number | null }>();
      expect(row?.lastUsedAt).not.toBeNull();
    });

    const after = await app.request(
      cookieRequest("GET", `/workspaces/${workspaceId}/calendar-feed`),
    );
    const afterBody = await after.json<{ lastUsedAt: string | null }>();
    expect(afterBody.lastUsedAt).toEqual(expect.any(String));
  });

  it("rejects PAT-authenticated callers on every management route with 403", async () => {
    const app = buildApp();
    const pat = await seedPat();

    // A verified, live PAT — not a malformed bearer — must still be locked
    // out: a leaked API token must never mint a second credential class.
    for (const method of ["GET", "POST", "DELETE"] as const) {
      const res = await app.request(
        patRequest(pat, method, `/workspaces/${workspaceId}/calendar-feed`),
      );
      expect(res.status).toBe(403);
      const body = await res.json<{ error: string }>();
      expect(body.error).toContain("API tokens cannot manage");
    }
  });

  it("rejects non-members of the workspace with 403", async () => {
    const app = buildApp();
    // Cookie auth resolves to TEST_USER, who is not a member of the foreign
    // workspace — mint and status must both refuse.
    const get = await app.request(
      cookieRequest("GET", `/workspaces/${foreignWorkspaceId}/calendar-feed`),
    );
    expect(get.status).toBe(403);
    const post = await app.request(
      cookieRequest("POST", `/workspaces/${foreignWorkspaceId}/calendar-feed`),
    );
    expect(post.status).toBe(403);
  });

  it("rejects unauthenticated callers with 401", async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(`http://localhost/workspaces/${workspaceId}/calendar-feed`, {
        method: "GET",
      }),
    );
    expect(res.status).toBe(401);
  });
});
