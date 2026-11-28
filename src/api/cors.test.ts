import { Hono } from "hono";
import { cors } from "hono/cors";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/password", () => ({
  hashPassword: vi.fn(),
  createMigratingVerify: vi.fn(() => vi.fn()),
}));

import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
} from "../shared/constants/offline-sync";
import type { AppBindings } from "./env";
import worker from "./index";
import { resetAllowedOriginCache, resolveAllowedOrigin } from "./lib/auth";

const BASE_URL = "http://localhost:8787";
const TRUSTED_ORIGIN = "https://trusted.example.com";

function createApp(trustedOrigins?: string) {
  const app = new Hono<{ Bindings: AppBindings }>();

  app.use(
    "/api/*",
    cors({
      origin: (origin, c) => {
        const env = c.env as AppBindings;
        return resolveAllowedOrigin(origin, env.BETTER_AUTH_URL, env.TRUSTED_ORIGINS);
      },
      credentials: true,
    })
  );

  app.get("/api/health", (c) => c.json({ ok: true }));

  return {
    app,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, {
        BETTER_AUTH_URL: BASE_URL,
        TRUSTED_ORIGINS: trustedOrigins,
      } as unknown as AppBindings),
  };
}

describe("CORS middleware", () => {
  beforeEach(() => {
    resetAllowedOriginCache();
  });

  it("allows requests from BETTER_AUTH_URL", async () => {
    const { request } = createApp();
    const res = await request("/api/health", {
      headers: { Origin: BASE_URL },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(BASE_URL);
  });

  it("allows requests from a trusted origin", async () => {
    const { request } = createApp(TRUSTED_ORIGIN);
    const res = await request("/api/health", {
      headers: { Origin: TRUSTED_ORIGIN },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(TRUSTED_ORIGIN);
  });

  it("rejects requests from unlisted origins", async () => {
    const { request } = createApp();
    const res = await request("/api/health", {
      headers: { Origin: "https://evil.com" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("sets Access-Control-Allow-Credentials to true for allowed origins", async () => {
    const { request } = createApp();
    const res = await request("/api/health", {
      headers: { Origin: BASE_URL },
    });

    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("handles preflight OPTIONS requests for allowed origins", async () => {
    const { request } = createApp();
    const res = await request("/api/health", {
      method: "OPTIONS",
      headers: {
        Origin: BASE_URL,
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(BASE_URL);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("handles multiple trusted origins from comma-separated env", async () => {
    const origins = `${TRUSTED_ORIGIN},https://another.example.com`;
    const { request } = createApp(origins);

    const res = await request("/api/health", {
      headers: { Origin: "https://another.example.com" },
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://another.example.com");
  });

  it("works when TRUSTED_ORIGINS is undefined", async () => {
    const { request } = createApp(undefined);
    const res = await request("/api/health", {
      headers: { Origin: BASE_URL },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(BASE_URL);
  });
});

describe("the worker's CORS configuration", () => {
  beforeEach(() => {
    resetAllowedOriginCache();
  });

  const env = { BETTER_AUTH_URL: BASE_URL } as unknown as AppBindings;
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  it("lets an offline replay send PATCH with an Idempotency-Key", async () => {
    const res = await worker.fetch(
      new Request(`${BASE_URL}/api/tasks/t1`, {
        method: "OPTIONS",
        headers: {
          Origin: BASE_URL,
          "Access-Control-Request-Method": "PATCH",
          "Access-Control-Request-Headers": `content-type,${IDEMPOTENCY_KEY_HEADER.toLowerCase()}`,
        },
      }),
      env,
      executionCtx
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(IDEMPOTENCY_KEY_HEADER);
  });

  it("exposes Idempotent-Replayed to the browser", async () => {
    const res = await worker.fetch(
      new Request(`${BASE_URL}/api/health`, { headers: { Origin: BASE_URL } }),
      env,
      executionCtx
    );

    expect(res.headers.get("Access-Control-Expose-Headers")).toContain(IDEMPOTENT_REPLAYED_HEADER);
  });
});
