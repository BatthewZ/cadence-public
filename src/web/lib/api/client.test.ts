import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, setOnUnauthorized } from "./client";

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
});
