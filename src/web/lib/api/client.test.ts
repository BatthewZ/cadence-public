import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setReadBarrier } from "../offline/read-barrier";
import { api, ApiError, OFFLINE_MESSAGE, OfflineError, setOnUnauthorized } from "./client";

describe("api client", () => {
  beforeEach(() => {
    setOnUnauthorized(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOnUnauthorized(null);
  });

  function mockFetch(status: number, body: unknown = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: "Status " + status,
        json: () => Promise.resolve(body),
      })
    );
  }

  it("calls onUnauthorized callback when response is 401", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);
    mockFetch(401, { error: "Unauthorized" });

    await expect(api("/api/me")).rejects.toThrow();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does NOT call onUnauthorized for non-401 errors", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);

    mockFetch(403, { error: "Forbidden" });
    await expect(api("/api/admin")).rejects.toThrow();

    mockFetch(500, { error: "Internal" });
    await expect(api("/api/fail")).rejects.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });

  it("still throws ApiError after calling the callback", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);
    mockFetch(401, { error: "Unauthorized" });

    await expect(api("/api/me")).rejects.toThrowError(ApiError);
    await expect(api("/api/me")).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("disables the callback when set to null", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);
    setOnUnauthorized(null);
    mockFetch(401, { error: "Unauthorized" });

    await expect(api("/api/me")).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws normally on 401 when no callback is set", async () => {
    mockFetch(401, { error: "Unauthorized" });

    await expect(api("/api/me")).rejects.toThrowError(ApiError);
    await expect(api("/api/me")).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("turns a request that never reached the server into an OfflineError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await api("/api/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OfflineError);
    expect(error).toMatchObject({ status: 0, message: OFFLINE_MESSAGE });
  });

  it("keeps the server's error code and body on ApiError", async () => {
    mockFetch(409, { error: "Changed", code: "description_conflict", task: { id: "t1" } });

    await expect(api("/api/tasks/t1", { method: "PATCH" })).rejects.toMatchObject({
      status: 409,
      code: "description_conflict",
      body: { task: { id: "t1" } },
    });
  });

  it("holds GETs, and only GETs, behind the read barrier", async () => {
    let release = () => undefined as void;
    setReadBarrier(() => new Promise<void>((resolve) => (release = resolve)));
    mockFetch(200, { ok: true });
    try {
      let got = false;
      const pending = api("/api/projects/p1/tasks").then(() => (got = true));
      await api("/api/tasks/t1", { method: "PATCH" });
      expect(got).toBe(false);
      release();
      await pending;
      expect(got).toBe(true);
    } finally {
      setReadBarrier(null);
    }
  });
});
