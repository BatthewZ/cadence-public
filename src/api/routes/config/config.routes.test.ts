/**
 * Tests for the public /config endpoint.
 *
 * This endpoint is how the web client discovers whether optional features
 * (currently just Unsplash) are enabled in the running deployment. The shape
 * is contractual — the client reads `features.unsplash` to decide whether to
 * render the Unsplash tab in the cover picker — so we guard both the true
 * and false paths and confirm the cache header is set.
 */

import { describe, expect, it } from "vitest";

import type { AppBindings } from "../../env";
import configRoutes from "./config.routes";

function buildEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    DB: {} as D1Database,
    BETTER_AUTH_SECRET: "test",
    BETTER_AUTH_URL: "http://localhost",
    ASSETS: {} as Fetcher,
    ...overrides,
  };
}

describe("GET /config", () => {
  it("returns features.unsplash=true when UNSPLASH_ACCESS_KEY is set", async () => {
    const res = await configRoutes.request(
      "/config",
      { method: "GET" },
      buildEnv({ UNSPLASH_ACCESS_KEY: "some-key" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ features: { unsplash: boolean } }>();
    expect(body.features.unsplash).toBe(true);
  });

  it("returns features.unsplash=false when UNSPLASH_ACCESS_KEY is missing", async () => {
    const res = await configRoutes.request(
      "/config",
      { method: "GET" },
      buildEnv(),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ features: { unsplash: boolean } }>();
    expect(body.features.unsplash).toBe(false);
  });

  it("returns features.unsplash=false when UNSPLASH_ACCESS_KEY is empty", async () => {
    const res = await configRoutes.request(
      "/config",
      { method: "GET" },
      buildEnv({ UNSPLASH_ACCESS_KEY: "" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ features: { unsplash: boolean } }>();
    expect(body.features.unsplash).toBe(false);
  });

  it("returns features.unsplash=false when UNSPLASH_ACCESS_KEY is whitespace", async () => {
    // Whitespace-only must match createUnsplashService's treatment (returns
    // null), otherwise the client renders the Unsplash tab while /unsplash/*
    // routes 503.
    const res = await configRoutes.request(
      "/config",
      { method: "GET" },
      buildEnv({ UNSPLASH_ACCESS_KEY: "   " }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ features: { unsplash: boolean } }>();
    expect(body.features.unsplash).toBe(false);
  });

  it("sets Cache-Control: private, max-age=300", async () => {
    const res = await configRoutes.request(
      "/config",
      { method: "GET" },
      buildEnv({ UNSPLASH_ACCESS_KEY: "some-key" }),
    );

    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("is accessible without authentication", async () => {
    // Endpoint has no auth middleware attached; no Authorization header
    // should not produce a 401.
    const res = await configRoutes.request(
      "/config",
      { method: "GET" },
      buildEnv(),
    );
    expect(res.status).toBe(200);
  });
});
