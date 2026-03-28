/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for notification handler functions.
 *
 * Uses a real in-memory D1 database (via Miniflare) so the listing, pagination,
 * unread-count, mark-as-read, and deletion logic are all exercised against actual
 * SQL. This catches query-shape regressions that mocks would miss.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppEnv } from "../../env";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedNotification,
  seedUser,
  TEST_USER,
  TEST_USER_2,
} from "../../test-utils";
import {
  deleteNotification,
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
} from "./notifications.handlers";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;

// Notification IDs seeded for TEST_USER
let notifUnread1Id: string;
let notifRead1Id: string;
let notifRead2Id: string;
let notifWithActorId: string;

// Notification seeded for TEST_USER_2 (should never leak to TEST_USER)
let otherUserNotifId: string;

// Deterministic timestamps spaced apart for pagination testing
const T1 = new Date("2025-06-01T00:00:00Z");
const T2 = new Date("2025-06-02T00:00:00Z");
const T3 = new Date("2025-06-03T00:00:00Z");
const T4 = new Date("2025-06-04T00:00:00Z");
const T5 = new Date("2025-06-05T00:00:00Z");
const T6 = new Date("2025-06-06T00:00:00Z");

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);

  // Unread notifications for TEST_USER (oldest first)
  notifUnread1Id = await seedNotification(d1, TEST_USER.id, {
    id: "notif-u1",
    title: "Unread 1",
    read: false,
    createdAt: T1,
  });
  await seedNotification(d1, TEST_USER.id, {
    id: "notif-u2",
    title: "Unread 2",
    read: false,
    createdAt: T2,
  });
  await seedNotification(d1, TEST_USER.id, {
    id: "notif-u3",
    title: "Unread 3",
    read: false,
    createdAt: T3,
  });

  // Read notifications for TEST_USER
  notifRead1Id = await seedNotification(d1, TEST_USER.id, {
    id: "notif-r1",
    title: "Read 1",
    read: true,
    createdAt: T4,
  });
  notifRead2Id = await seedNotification(d1, TEST_USER.id, {
    id: "notif-r2",
    title: "Read 2",
    read: true,
    createdAt: T5,
  });

  // Notification with actorId pointing to TEST_USER_2
  notifWithActorId = await seedNotification(d1, TEST_USER.id, {
    id: "notif-actor",
    title: "With Actor",
    read: false,
    actorId: TEST_USER_2.id,
    createdAt: T6,
  });

  // Another user's notification
  otherUserNotifId = await seedNotification(d1, TEST_USER_2.id, {
    id: "notif-other",
    title: "Other User Notif",
    read: false,
    createdAt: T1,
  });
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

const auth = () => fakeAuth(d1);
const auth2 = () => fakeAuth(d1, TEST_USER_2);

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

describe("listNotifications", () => {
  it("returns notifications for the authenticated user only", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications", auth(), listNotifications);

    const res = await app.request(
      "/notifications",
      jsonRequest("GET", "/notifications"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      notifications: { id: string }[];
      nextCursor: string | null;
    }>();

    const ids = body.notifications.map((n) => n.id);
    expect(ids).not.toContain(otherUserNotifId);
    // Should contain all of TEST_USER's notifications
    expect(ids).toContain(notifUnread1Id);
    expect(ids).toContain(notifRead1Id);
    expect(ids).toContain(notifWithActorId);
  });

  it("orders by createdAt DESC", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications", auth(), listNotifications);

    const res = await app.request(
      "/notifications",
      jsonRequest("GET", "/notifications"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      notifications: { id: string; createdAt: string }[];
      nextCursor: string | null;
    }>();

    // The newest notification (T6) should come first
    expect(body.notifications[0].id).toBe(notifWithActorId);
  });

  it("paginates with cursor (ISO timestamp)", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications", auth(), listNotifications);

    // Request with limit=3 to get first page
    const res1 = await app.request(
      "/notifications?limit=3",
      jsonRequest("GET", "/notifications?limit=3"),
    );

    expect(res1.status).toBe(200);
    const body1 = await res1.json<{
      notifications: { id: string }[];
      nextCursor: string | null;
    }>();

    expect(body1.notifications).toHaveLength(3);
    expect(body1.nextCursor).not.toBeNull();

    // Request next page using cursor
    const res2 = await app.request(
      `/notifications?limit=3&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      jsonRequest(
        "GET",
        `/notifications?limit=3&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      ),
    );

    expect(res2.status).toBe(200);
    const body2 = await res2.json<{
      notifications: { id: string }[];
      nextCursor: string | null;
    }>();

    expect(body2.notifications.length).toBeGreaterThan(0);

    // No overlap between pages
    const page1Ids = new Set(body1.notifications.map((n) => n.id));
    for (const n of body2.notifications) {
      expect(page1Ids.has(n.id)).toBe(false);
    }
  });

  it("respects limit parameter", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications", auth(), listNotifications);

    const res = await app.request(
      "/notifications?limit=2",
      jsonRequest("GET", "/notifications?limit=2"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      notifications: { id: string }[];
      nextCursor: string | null;
    }>();

    expect(body.notifications).toHaveLength(2);
  });

  it("filters by unreadOnly=true", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications", auth(), listNotifications);

    const res = await app.request(
      "/notifications?unreadOnly=true",
      jsonRequest("GET", "/notifications?unreadOnly=true"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      notifications: { id: string; read: boolean }[];
      nextCursor: string | null;
    }>();

    // All returned should be unread
    for (const n of body.notifications) {
      expect(n.read).toBe(false);
    }
    // Should not contain read notifications
    const ids = body.notifications.map((n) => n.id);
    expect(ids).not.toContain(notifRead1Id);
    expect(ids).not.toContain(notifRead2Id);
  });

  it("returns nextCursor: null when no more pages", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications", auth(), listNotifications);

    // Fetch all at once (limit=100 > total count)
    const res = await app.request(
      "/notifications?limit=100",
      jsonRequest("GET", "/notifications?limit=100"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      notifications: { id: string }[];
      nextCursor: string | null;
    }>();

    expect(body.nextCursor).toBeNull();
  });

  it("includes actor name/image via user join", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications", auth(), listNotifications);

    const res = await app.request(
      "/notifications",
      jsonRequest("GET", "/notifications"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      notifications: {
        id: string;
        actorId: string | null;
        actorName: string | null;
        actorImage: string | null;
      }[];
      nextCursor: string | null;
    }>();

    const withActor = body.notifications.find(
      (n) => n.id === notifWithActorId,
    );
    expect(withActor).toBeDefined();
    expect(withActor!.actorId).toBe(TEST_USER_2.id);
    expect(withActor!.actorName).toBe(TEST_USER_2.name);

    // A notification without actorId should have null actor fields
    const withoutActor = body.notifications.find(
      (n) => n.id === notifUnread1Id,
    );
    expect(withoutActor).toBeDefined();
    expect(withoutActor!.actorName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUnreadCount
// ---------------------------------------------------------------------------

describe("getUnreadCount", () => {
  it("returns count of unread notifications", async () => {
    const app = new Hono<AppEnv>();
    app.get("/notifications/unread-count", auth(), getUnreadCount);

    const res = await app.request(
      "/notifications/unread-count",
      jsonRequest("GET", "/notifications/unread-count"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ count: number }>();

    // TEST_USER has 4 unread: notifUnread1, notifUnread2, notifUnread3, notifWithActor
    expect(body.count).toBe(4);
  });

  it("returns 0 when all are read", async () => {
    // Use TEST_USER_2's auth after marking their only notification as read
    const app = new Hono<AppEnv>();
    app.get("/notifications/unread-count", auth2(), getUnreadCount);
    app.patch("/notifications/:id/read", auth2(), markAsRead);

    // Mark the other user's notification as read first
    await app.request(
      `/notifications/${otherUserNotifId}/read`,
      jsonRequest("PATCH", `/notifications/${otherUserNotifId}/read`),
    );

    const res = await app.request(
      "/notifications/unread-count",
      jsonRequest("GET", "/notifications/unread-count"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ count: number }>();
    expect(body.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// markAsRead
// ---------------------------------------------------------------------------

describe("markAsRead", () => {
  it("marks a notification as read and sets readAt", async () => {
    const app = new Hono<AppEnv>();
    app.patch("/notifications/:id/read", auth(), markAsRead);
    app.get("/notifications", auth(), listNotifications);

    const res = await app.request(
      `/notifications/${notifUnread1Id}/read`,
      jsonRequest("PATCH", `/notifications/${notifUnread1Id}/read`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify it is now read by fetching notifications
    const listRes = await app.request(
      "/notifications?unreadOnly=true",
      jsonRequest("GET", "/notifications?unreadOnly=true"),
    );
    const listBody = await listRes.json<{
      notifications: { id: string }[];
      nextCursor: string | null;
    }>();
    const ids = listBody.notifications.map((n) => n.id);
    expect(ids).not.toContain(notifUnread1Id);
  });

  it("returns 404 for non-existent notification", async () => {
    const app = new Hono<AppEnv>();
    app.patch("/notifications/:id/read", auth(), markAsRead);

    const res = await app.request(
      "/notifications/nonexistent-id/read",
      jsonRequest("PATCH", "/notifications/nonexistent-id/read"),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Notification not found");
  });

  it("returns 404 when notification belongs to another user", async () => {
    const app = new Hono<AppEnv>();
    app.patch("/notifications/:id/read", auth(), markAsRead);

    // Try to mark TEST_USER_2's notification as read while authed as TEST_USER
    const res = await app.request(
      `/notifications/${otherUserNotifId}/read`,
      jsonRequest("PATCH", `/notifications/${otherUserNotifId}/read`),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Notification not found");
  });
});

// ---------------------------------------------------------------------------
// markAllAsRead
// ---------------------------------------------------------------------------

describe("markAllAsRead", () => {
  it("marks all unread notifications as read", async () => {
    const app = new Hono<AppEnv>();
    app.post("/notifications/mark-all-read", auth(), markAllAsRead);
    app.get("/notifications/unread-count", auth(), getUnreadCount);

    const res = await app.request(
      "/notifications/mark-all-read",
      jsonRequest("POST", "/notifications/mark-all-read"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify unread count is now 0
    const countRes = await app.request(
      "/notifications/unread-count",
      jsonRequest("GET", "/notifications/unread-count"),
    );
    const countBody = await countRes.json<{ count: number }>();
    expect(countBody.count).toBe(0);
  });

  it("does not error when no unread notifications exist", async () => {
    // After the previous test, all are read. Calling again should still succeed.
    const app = new Hono<AppEnv>();
    app.post("/notifications/mark-all-read", auth(), markAllAsRead);

    const res = await app.request(
      "/notifications/mark-all-read",
      jsonRequest("POST", "/notifications/mark-all-read"),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteNotification
// ---------------------------------------------------------------------------

describe("deleteNotification", () => {
  it("deletes a notification", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/notifications/:id", auth(), deleteNotification);
    app.get("/notifications", auth(), listNotifications);

    const res = await app.request(
      `/notifications/${notifRead2Id}`,
      jsonRequest("DELETE", `/notifications/${notifRead2Id}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);

    // Verify it no longer appears in the list
    const listRes = await app.request(
      "/notifications",
      jsonRequest("GET", "/notifications"),
    );
    const listBody = await listRes.json<{
      notifications: { id: string }[];
      nextCursor: string | null;
    }>();
    const ids = listBody.notifications.map((n) => n.id);
    expect(ids).not.toContain(notifRead2Id);
  });

  it("returns 404 for non-existent notification", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/notifications/:id", auth(), deleteNotification);

    const res = await app.request(
      "/notifications/nonexistent-id",
      jsonRequest("DELETE", "/notifications/nonexistent-id"),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Notification not found");
  });

  it("returns 404 when notification belongs to another user", async () => {
    const app = new Hono<AppEnv>();
    app.delete("/notifications/:id", auth(), deleteNotification);

    // Try to delete TEST_USER_2's notification while authed as TEST_USER
    const res = await app.request(
      `/notifications/${otherUserNotifId}`,
      jsonRequest("DELETE", `/notifications/${otherUserNotifId}`),
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Notification not found");
  });
});
