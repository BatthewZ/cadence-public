/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the Unsplash proxy routes.
 *
 * These tests mount the real `unsplashRoutes` Hono sub-app behind a test auth
 * middleware and mock `globalThis.fetch` to simulate upstream responses from
 * api.unsplash.com. That way we exercise the real validation, auth, rate
 * limit, and error-mapping code paths without hitting the network.
 *
 * We cover:
 * - 401 when no auth is present (requireAuth in the real chain).
 * - 400 when the query fails validation.
 * - 503 when UNSPLASH_ACCESS_KEY is absent (the service factory returns null).
 * - 200 happy path returning the normalised payload with UTM params.
 * - 502 when upstream Unsplash returns a non-OK status (normalised, no body
 *   leak, still carries requestId).
 * - 200 curated path returning the normalised array.
 * - 429 rate limit after 30 requests in the same window.
 */

import type { MiddlewareHandler } from "hono";
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

import type { AppBindings, AppEnv } from "../../env";
import {
  createTestD1,
  fakeAuth,
  jsonRequest,
  seedUser,
  TEST_USER,
} from "../../test-utils";
import unsplashRoutes from "./unsplash.routes";

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let d1: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
});

afterAll(async () => {
  await dispose();
});

// ---------------------------------------------------------------------------
// Fetch mocking
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOnce(response: Response) {
  globalThis.fetch = vi.fn().mockResolvedValueOnce(response);
}

function mockFetchAlways(response: Response | (() => Response)) {
  globalThis.fetch = vi.fn().mockImplementation(() => {
    return Promise.resolve(
      typeof response === "function" ? response() : response.clone(),
    );
  });
}

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

/**
 * Builds an app that mounts the real unsplashRoutes with an optional auth
 * middleware. Used to verify the full middleware chain (requireAuth + rate
 * limit + validate) against the real handlers.
 */
function buildApp(opts?: { auth?: MiddlewareHandler<AppEnv> }) {
  const app = new Hono<AppEnv>();
  if (opts?.auth) {
    app.use("*", opts.auth);
  }
  app.route("/", unsplashRoutes);
  return app;
}

const buildEnv = (overrides: Partial<AppBindings> = {}): AppBindings =>
  ({
    DB: d1,
    BETTER_AUTH_SECRET: "test",
    BETTER_AUTH_URL: "http://localhost",
    TOKEN_HASH_PEPPER: "test-pepper",
    ASSETS: {} as Fetcher,
    ...overrides,
  }) as AppBindings;

// ---------------------------------------------------------------------------
// Raw photo fixture
// ---------------------------------------------------------------------------

const rawSearchPayload = {
  total: 1,
  total_pages: 1,
  results: [
    {
      id: "abc123",
      width: 4000,
      height: 3000,
      color: "#abcdef",
      blur_hash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      description: "A mountain",
      alt_description: null,
      urls: {
        raw: "https://images.unsplash.com/raw",
        full: "https://images.unsplash.com/full",
        regular: "https://images.unsplash.com/regular",
        small: "https://images.unsplash.com/small",
        thumb: "https://images.unsplash.com/thumb",
      },
      links: {
        self: "https://api.unsplash.com/photos/abc123",
        html: "https://unsplash.com/photos/abc123",
        download: "https://unsplash.com/photos/abc123/download",
        download_location:
          "https://api.unsplash.com/photos/abc123/download?ixid=xxx",
      },
      user: {
        username: "janesmith",
        name: "Jane Smith",
      },
    },
  ],
};

const rawCuratedPayload = [rawSearchPayload.results[0]];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /unsplash/search", () => {
  it("returns 401 without authentication", async () => {
    const app = buildApp();
    const res = await app.request(
      "/unsplash/search?query=mountains",
      jsonRequest("GET", "/unsplash/search?query=mountains"),
      buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when query is empty", async () => {
    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/search?query=",
      jsonRequest("GET", "/unsplash/search?query="),
      buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 503 when UNSPLASH_ACCESS_KEY is not configured", async () => {
    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/search?query=mountains",
      jsonRequest("GET", "/unsplash/search?query=mountains"),
      buildEnv(),
    );
    expect(res.status).toBe(503);
    const body = await res.json<{ error: string; requestId: string }>();
    expect(body.error).toBe("Unsplash is not configured");
    expect(body.requestId).toBeDefined();
  });

  it("returns normalised payload on success", async () => {
    mockFetchOnce(
      new Response(JSON.stringify(rawSearchPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/search?query=mountains&perPage=10",
      jsonRequest("GET", "/unsplash/search?query=mountains&perPage=10"),
      buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      page: number;
      perPage: number;
      total: number;
      totalPages: number;
      results: Array<{
        id: string;
        url: string;
        thumbUrl: string;
        photoUrl: string;
        downloadLocation: string;
        user: { name: string; username: string; profileUrl: string };
      }>;
    }>();

    expect(body.page).toBe(1);
    expect(body.perPage).toBe(10);
    expect(body.total).toBe(1);
    expect(body.totalPages).toBe(1);
    expect(body.results).toHaveLength(1);

    const first = body.results[0];
    expect(first.id).toBe("abc123");
    expect(first.url).toBe("https://images.unsplash.com/regular");
    expect(first.thumbUrl).toBe("https://images.unsplash.com/thumb");
    expect(first.photoUrl).toContain("utm_source=");
    expect(first.photoUrl).toContain("utm_medium=referral");
    expect(first.user.profileUrl).toBe(
      "https://unsplash.com/@janesmith?utm_source=cadence&utm_medium=referral",
    );
    expect(first.downloadLocation).toBe(
      "https://api.unsplash.com/photos/abc123/download?ixid=xxx",
    );

    // Verify fetch was called with the correct URL and auth header.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain(
      "https://api.unsplash.com/search/photos",
    );
    expect(String(call[0])).toContain("query=mountains");
    expect(String(call[0])).toContain("per_page=10");
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Client-ID test-key");
  });

  it("uses the configured UNSPLASH_APP_NAME for UTM", async () => {
    mockFetchOnce(
      new Response(JSON.stringify(rawSearchPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/search?query=mountains",
      jsonRequest("GET", "/unsplash/search?query=mountains"),
      buildEnv({
        UNSPLASH_ACCESS_KEY: "test-key",
        UNSPLASH_APP_NAME: "cadence-staging",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      results: Array<{ user: { profileUrl: string } }>;
    }>();
    expect(body.results[0].user.profileUrl).toContain(
      "utm_source=cadence-staging",
    );
  });

  it("returns 502 when upstream Unsplash returns 403", async () => {
    mockFetchOnce(
      new Response("Forbidden", {
        status: 403,
      }),
    );

    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/search?query=mountains",
      jsonRequest("GET", "/unsplash/search?query=mountains"),
      buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
    );

    expect(res.status).toBe(502);
    const body = await res.json<{
      error: string;
      requestId: string;
      upstreamStatus: number;
    }>();
    expect(body.error).toBe("Unsplash request failed");
    expect(body.requestId).toBeDefined();
    expect(body.upstreamStatus).toBe(403);
    // Do NOT leak the upstream body ("Forbidden").
    expect(JSON.stringify(body)).not.toContain("Forbidden");
  });

  it("surfaces upstream 429 as 429", async () => {
    mockFetchOnce(new Response("slow down", { status: 429 }));

    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/search?query=mountains",
      jsonRequest("GET", "/unsplash/search?query=mountains"),
      buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
    );
    expect(res.status).toBe(429);
  });
});

describe("GET /unsplash/curated", () => {
  it("returns a normalised array from the /photos endpoint", async () => {
    mockFetchOnce(
      new Response(JSON.stringify(rawCuratedPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/curated?perPage=5",
      jsonRequest("GET", "/unsplash/curated?perPage=5"),
      buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json<{
      page: number;
      perPage: number;
      total: number;
      totalPages: number;
      results: Array<{ id: string; photoUrl: string }>;
    }>();
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(5);
    expect(body.totalPages).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe("abc123");
    expect(body.results[0].photoUrl).toContain("utm_source=");

    // Verify fetch was called against /photos, not /search/photos.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls[0];
    const url = String(call[0]);
    expect(url).toContain("https://api.unsplash.com/photos");
    expect(url).not.toContain("/search/");
    expect(url).toContain("order_by=latest");
  });

  it("returns 401 without authentication", async () => {
    const app = buildApp();
    const res = await app.request(
      "/unsplash/curated",
      jsonRequest("GET", "/unsplash/curated"),
      buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 when UNSPLASH_ACCESS_KEY is not configured", async () => {
    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });
    const res = await app.request(
      "/unsplash/curated",
      jsonRequest("GET", "/unsplash/curated"),
      buildEnv(),
    );
    expect(res.status).toBe(503);
  });
});

describe("Rate limiting", () => {
  /**
   * The rate limit middleware is scoped per-Hono-instance. It extracts the
   * client key from `cf-connecting-ip` (or a fallback); since we don't set
   * one, the key is "unknown" and every request in a single app instance
   * shares the same bucket. This lets us assert the 30 req/min cap fires.
   *
   * We override the route auth for all requests (single logged-in user) and
   * mock fetch to always succeed so we don't hit network.
   */
  it("returns 429 after 30 requests in the same window", async () => {
    mockFetchAlways(
      new Response(JSON.stringify(rawSearchPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Force a stable client IP so we share the rate-limit bucket across all
    // requests in this test. Without this the IP would be "unknown" which
    // also shares a bucket, but setting it explicitly documents intent.
    const app = buildApp({ auth: fakeAuth(d1, TEST_USER) });

    const makeRequest = () =>
      app.request(
        "/unsplash/search?query=mountains",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": "10.0.0.1",
          },
        },
        buildEnv({ UNSPLASH_ACCESS_KEY: "test-key" }),
      );

    // First 30 should all succeed.
    for (let i = 0; i < 30; i++) {
      const res = await makeRequest();
      expect(res.status).toBe(200);
    }

    // 31st must be rate-limited.
    const limited = await makeRequest();
    expect(limited.status).toBe(429);
    const body = await limited.json<{ error: string; requestId: string }>();
    expect(body.error).toBe("Too many requests");
    expect(body.requestId).toBeDefined();
  });
});
