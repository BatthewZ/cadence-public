import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth", () => ({
  createAuth: vi.fn(),
  resetAuthCache: vi.fn(),
}));

import { createAuth, resetAuthCache } from "../lib/auth";
import { authSessionMiddleware } from "./auth";

const mockCreateAuth = vi.mocked(createAuth);

function createApp() {
  const app = new Hono();

  app.use("*", authSessionMiddleware as never);
  app.get("/test", (c) => {
    const user = c.get("user" as never);
    const session = c.get("session" as never);
    return c.json({ user, session });
  });

  return app;
}

/**
 * Helper to build a Request with a cookie header so the middleware proceeds
 * past the early-exit check and actually calls getSession.
 */
function requestWithCookie(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { cookie: "better-auth.session_token=test-token" },
  });
}

describe("authSessionMiddleware", () => {
  beforeEach(() => {
    vi.mocked(resetAuthCache).mockClear();
    mockCreateAuth.mockReset();
  });

  it("skips getSession and sets null user/session when no cookie or auth header is present", async () => {
    // Do NOT set up mockCreateAuth — if getSession were called it would throw
    const app = createApp();
    const res = await app.request("/test");

    expect(res.status).toBe(200);
    const body = await res.json<{ user: null; session: null }>();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();

    // createAuth should never have been called
    expect(mockCreateAuth).not.toHaveBeenCalled();
  });

  it("sets user and session when getSession returns a session", async () => {
    const fakeUser = { id: "1", email: "test@example.com", name: "Test" };
    const fakeSession = { id: "s1", expiresAt: new Date() };

    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: fakeUser,
          session: fakeSession,
        }),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    expect(res.status).toBe(200);
    const body = await res.json<{ user: typeof fakeUser; session: typeof fakeSession }>();
    expect(body.user).toEqual(fakeUser);
    expect(body.session).toMatchObject({ id: "s1" });
  });

  it("sets user and session to null when getSession returns null", async () => {
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    expect(res.status).toBe(200);
    const body = await res.json<{ user: null; session: null }>();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();
  });

  it("falls back to null user/session when getSession throws (stale/corrupt cookie)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockRejectedValue(new Error("D1_ERROR: no such table: session")),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    expect(res.status).toBe(200);
    const body = await res.json<{ user: null; session: null }>();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();

    expect(errorSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string) as {
      level: string;
      middleware: string;
    };
    expect(logged.level).toBe("error");
    expect(logged.middleware).toBe("authSession");

    errorSpy.mockRestore();
  });

  it("calls next() in both cases — handler is always reached", async () => {
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    } as never);

    const app = createApp();
    const res = await app.request(requestWithCookie("/test"));

    // If next() wasn't called, we'd get a 404
    expect(res.status).toBe(200);
  });

  it("calls next() when early-exiting due to missing credentials", async () => {
    const app = createApp();
    // No cookie, no authorization header — early exit path
    const res = await app.request("/test");

    // If next() wasn't called, we'd get a 404
    expect(res.status).toBe(200);
  });

  it("proceeds to getSession when authorization header is present (no cookie)", async () => {
    const fakeUser = { id: "2", email: "bearer@example.com", name: "Bearer" };
    const fakeSession = { id: "s2", expiresAt: new Date() };

    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: fakeUser,
          session: fakeSession,
        }),
      },
    } as never);

    const app = createApp();
    const req = new Request("http://localhost/test", {
      headers: { authorization: "Bearer some-token" },
    });
    const res = await app.request(req);

    expect(res.status).toBe(200);
    expect(mockCreateAuth).toHaveBeenCalled();
    const body = await res.json<{ user: typeof fakeUser; session: typeof fakeSession }>();
    expect(body.user).toEqual(fakeUser);
  });
});
