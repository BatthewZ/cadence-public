import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  current: {
    data: null as unknown,
    error: null as unknown,
    isPending: true,
    isRefetching: false,
    refetch: () => undefined,
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ useSession: () => sessionState.current }),
}));

import { SESSION_FALLBACK_MS, useSession } from "./auth-client";
import { readCachedSession } from "./session-cache";

const future = new Date(Date.now() + 86_400_000).toISOString();
const serverSession = {
  user: { id: "u1", name: "Ada", email: "ada@example.com" },
  session: { id: "s1", userId: "u1", expiresAt: future, token: "secret-token" },
};

function setServer(patch: Partial<typeof sessionState.current>) {
  sessionState.current = { ...sessionState.current, ...patch };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
  sessionState.current = {
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
    refetch: () => undefined,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSession (offline-tolerant)", () => {
  it("returns the server's session and caches it without the token", () => {
    setServer({ data: serverSession, isPending: false });
    const { result } = renderHook(() => useSession());
    expect(result.current.data).toEqual(serverSession);
    const cached = readCachedSession<typeof serverSession>();
    expect(cached?.user.id).toBe("u1");
    expect(cached?.session.token).toBe("");
    expect(localStorage.getItem("cadence:session")).not.toContain("secret-token");
  });

  it("falls back to the cached session when the request fails for lack of a connection", () => {
    setServer({ data: serverSession, isPending: false });
    renderHook(() => useSession()).unmount();

    setServer({ data: null, error: new TypeError("Failed to fetch"), isPending: false });
    const { result } = renderHook(() => useSession());
    expect(result.current.data?.user.id).toBe("u1");
    expect(result.current.error).toBeNull();
  });

  it("uses the cached session at once while offline, and after a slow server", () => {
    setServer({ data: serverSession, isPending: false });
    renderHook(() => useSession()).unmount();

    setServer({ data: null, error: null, isPending: true });
    setOnline(false);
    expect(renderHook(() => useSession()).result.current.data?.user.id).toBe("u1");

    setOnline(true);
    vi.useFakeTimers();
    const { result } = renderHook(() => useSession());
    expect(result.current.isPending).toBe(true);
    act(() => {
      vi.advanceTimersByTime(SESSION_FALLBACK_MS);
    });
    expect(result.current.data?.user.id).toBe("u1");
  });

  it("falls back to the cached session when the server errors, and keeps it for later", () => {
    setServer({ data: serverSession, isPending: false });
    renderHook(() => useSession()).unmount();

    setServer({ data: null, error: { status: 503 }, isPending: false });
    const { result } = renderHook(() => useSession());
    expect(result.current.data?.user.id).toBe("u1");
    expect(result.current.error).toBeNull();
    expect(readCachedSession()).not.toBeNull();
  });

  it("signs out for real on 401 or when the server says there is no session", () => {
    setServer({ data: serverSession, isPending: false });
    renderHook(() => useSession()).unmount();

    setServer({ data: null, error: { status: 401 }, isPending: false });
    const { result } = renderHook(() => useSession());
    expect(result.current.data).toBeNull();
    expect(readCachedSession()).toBeNull();

    setServer({ data: serverSession, isPending: false });
    renderHook(() => useSession()).unmount();
    setServer({ data: null, error: null, isPending: false });
    expect(renderHook(() => useSession()).result.current.data).toBeNull();
    expect(readCachedSession()).toBeNull();
  });

  it("does not trust an expired cached session", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    setServer({
      data: { ...serverSession, session: { ...serverSession.session, expiresAt: past } },
      isPending: false,
    });
    renderHook(() => useSession()).unmount();

    setServer({ data: null, error: new TypeError("Failed to fetch"), isPending: false });
    expect(renderHook(() => useSession()).result.current.data).toBeNull();
  });
});
