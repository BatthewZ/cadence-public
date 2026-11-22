import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../env";
import { requestIdMiddleware } from "./request-id";
import { securityHeadersMiddleware, withSpaSecurityHeaders } from "./security-headers";

describe("securityHeadersMiddleware", () => {
  const app = new Hono();
  app.use("*", securityHeadersMiddleware);
  app.get("/test", (c) => c.json({ ok: true }));

  it("sets X-Content-Type-Options to nosniff", async () => {
    const res = await app.request("/test");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets X-Frame-Options to DENY", async () => {
    const res = await app.request("/test");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets Referrer-Policy", async () => {
    const res = await app.request("/test");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets Permissions-Policy", async () => {
    const res = await app.request("/test");
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("sets X-XSS-Protection to 0", async () => {
    const res = await app.request("/test");
    expect(res.headers.get("X-XSS-Protection")).toBe("0");
  });

  it("sets Strict-Transport-Security header", async () => {
    const res = await app.request("/test");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
  });

  it("sets Content-Security-Policy header without unsafe-inline for scripts", async () => {
    const res = await app.request("/test");
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("includes all security headers together", async () => {
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(res.headers.get("X-XSS-Protection")).toBe("0");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });
});

describe("withSpaSecurityHeaders", () => {
  it("adds all shared security headers to a response", () => {
    const original = new Response("<html></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    const wrapped = withSpaSecurityHeaders(original, "/workspaces");

    expect(wrapped.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(wrapped.headers.get("X-Frame-Options")).toBe("DENY");
    expect(wrapped.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(wrapped.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(wrapped.headers.get("X-XSS-Protection")).toBe("0");
    expect(wrapped.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
  });

  it("uses SPA CSP that allows unsafe-inline scripts for FOUC prevention", () => {
    const original = new Response("<html></html>", { status: 200 });
    const wrapped = withSpaSecurityHeaders(original, "/workspaces");
    const csp = wrapped.headers.get("Content-Security-Policy");

    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  /**
   * Unsplash covers hotlink from `images.unsplash.com` per Unsplash API
   * guidelines (no self-hosted caching). If the CSP is ever tightened and
   * this host is dropped, every Unsplash-backed cover silently breaks in
   * production — this test locks in the allowlist entry.
   */
  it("SPA CSP allows https://images.unsplash.com for hotlinked cover images", () => {
    const original = new Response("<html></html>", { status: 200 });
    const wrapped = withSpaSecurityHeaders(original, "/workspaces");
    const csp = wrapped.headers.get("Content-Security-Policy");

    expect(csp).toContain("img-src");
    expect(csp).toContain("https://images.unsplash.com");
  });

  it("preserves original response status and body", async () => {
    const original = new Response("hello", { status: 200, statusText: "OK" });
    const wrapped = withSpaSecurityHeaders(original, "/");

    expect(wrapped.status).toBe(200);
    expect(await wrapped.text()).toBe("hello");
  });

  it("preserves original response headers", () => {
    const original = new Response("", {
      headers: { "Content-Type": "text/html", "X-Custom": "keep-me" },
    });
    const wrapped = withSpaSecurityHeaders(original, "/");

    expect(wrapped.headers.get("Content-Type")).toBe("text/html");
    expect(wrapped.headers.get("X-Custom")).toBe("keep-me");
  });

  it("sets immutable cache-control for hashed assets", () => {
    const original = new Response("console.log('hi')", {
      headers: { "Content-Type": "application/javascript" },
    });
    const wrapped = withSpaSecurityHeaders(original, "/assets/index-Orfbpl8o.js");

    expect(wrapped.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("sets no-cache for HTML pages", () => {
    const original = new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    });
    const wrapped = withSpaSecurityHeaders(original, "/workspaces");

    expect(wrapped.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("SPA CSP lets the app register its service worker and manifest", () => {
    const csp = withSpaSecurityHeaders(new Response("<html></html>"), "/").headers.get("Content-Security-Policy");

    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
  });

  /** The service worker's own fetches of cover images are governed by connect-src, not img-src. */
  it("SPA CSP connect-src allows https://images.unsplash.com for the service worker's image cache", () => {
    const csp = withSpaSecurityHeaders(new Response("<html></html>"), "/").headers.get("Content-Security-Policy") ?? "";
    const connectSrc = csp.split("; ").find((d) => d.startsWith("connect-src "));

    expect(connectSrc).toContain("https://images.unsplash.com");
  });

  it.each(["/sw.js", "/registerSW.js", "/workbox-9a1b2c3d.js", "/manifest.webmanifest"])(
    "serves %s with no-cache so a new deploy's service worker is picked up",
    (path) => {
      const wrapped = withSpaSecurityHeaders(
        new Response("x", { headers: { "Content-Type": "application/octet-stream" } }),
        path,
      );
      expect(wrapped.headers.get("Cache-Control")).toBe("no-cache");
    },
  );

  it.each([
    ["/sw.js", "text/javascript; charset=utf-8"],
    ["/registerSW.js", "text/javascript; charset=utf-8"],
    ["/workbox-9a1b2c3d.js", "text/javascript; charset=utf-8"],
    ["/manifest.webmanifest", "application/manifest+json"],
  ])("serves %s as %s", (path, contentType) => {
    const wrapped = withSpaSecurityHeaders(
      new Response("x", { headers: { "Content-Type": "application/octet-stream" } }),
      path,
    );
    expect(wrapped.headers.get("Content-Type")).toBe(contentType);
  });

  it("leaves the SPA fallback for a missing service worker as HTML so registration fails cleanly", () => {
    const wrapped = withSpaSecurityHeaders(
      new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
      "/sw.js",
    );
    expect(wrapped.headers.get("Content-Type")).toBe("text/html");
  });

  it("turns HTML served for a missing hashed asset into a no-store 404", async () => {
    const wrapped = withSpaSecurityHeaders(
      new Response("<!doctype html><html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      "/assets/index-Gone1234.js",
    );

    expect(wrapped.status).toBe(404);
    expect(wrapped.headers.get("Cache-Control")).toBe("no-store");
    expect(wrapped.headers.get("Content-Type")).not.toContain("text/html");
    expect(wrapped.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await wrapped.text()).not.toContain("<html");
  });

  it("sets no-cache for root path", () => {
    const original = new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    });
    const wrapped = withSpaSecurityHeaders(original, "/");

    expect(wrapped.headers.get("Cache-Control")).toBe("no-cache");
  });
});

describe("requestIdMiddleware", () => {
  const app = new Hono<AppEnv>();
  app.use("*", requestIdMiddleware);
  app.get("/test", (c) => c.json({ requestId: c.get("requestId") }));

  it("generates a request ID and returns it in X-Request-Id header", async () => {
    const res = await app.request("/test");
    const requestId = res.headers.get("X-Request-Id");
    expect(requestId).toBeTruthy();
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("makes request ID available on the context", async () => {
    const res = await app.request("/test");
    const body = await res.json<{ requestId: string }>();
    const headerRequestId = res.headers.get("X-Request-Id");
    expect(body.requestId).toBe(headerRequestId);
  });

  it("echoes back a client-provided X-Request-Id", async () => {
    const clientRequestId = "client-trace-abc-123";
    const req = new Request("http://localhost/test", {
      headers: { "X-Request-Id": clientRequestId },
    });
    const res = await app.request(req);
    expect(res.headers.get("X-Request-Id")).toBe(clientRequestId);
    const body = await res.json<{ requestId: string }>();
    expect(body.requestId).toBe(clientRequestId);
  });

  it("generates unique IDs for different requests", async () => {
    const res1 = await app.request("/test");
    const res2 = await app.request("/test");
    const id1 = res1.headers.get("X-Request-Id");
    const id2 = res2.headers.get("X-Request-Id");
    expect(id1).not.toBe(id2);
  });
});

describe("error handler with request ID", () => {
  it("includes request ID in error responses", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestIdMiddleware);
    app.onError((err, c) => {
      const requestId = c.get("requestId") ?? "unknown";
      return c.json({ error: "Internal Server Error", requestId }, 500);
    });
    app.get("/error", () => {
      throw new Error("test error");
    });

    const res = await app.request("/error");
    expect(res.status).toBe(500);
    const body = await res.json<{ error: string; requestId: string }>();
    expect(body.error).toBe("Internal Server Error");
    expect(body.requestId).toBeTruthy();
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
