import { createMiddleware } from "hono/factory";

const SHARED_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-XSS-Protection": "0",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const API_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * SPA CSP allows 'unsafe-inline' for scripts because the FOUC prevention
 * script in index.html must run before any external resources load.
 */
const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Returns true for paths that serve the interactive API documentation UI (Scalar). */
function isDocsPath(path: string): boolean {
  return path.startsWith("/api/docs/") || path === "/api/openapi.json";
}

const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com https://fonts.scalar.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.scalar.com https://cloudflareinsights.com https://static.cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const securityHeadersMiddleware = createMiddleware(async (c, next) => {
  await next();
  for (const [key, value] of Object.entries(SHARED_HEADERS)) {
    c.header(key, value);
  }
  c.header(
    "Content-Security-Policy",
    isDocsPath(c.req.path) ? DOCS_CSP : API_CSP,
  );
});

/**
 * Wraps an ASSETS fetch response with security headers and cache-control.
 *
 * Cache strategy:
 * - Hashed assets (`/assets/*`) are immutable and cached for 1 year.
 * - HTML pages (index.html, SPA routes) use `no-cache` so the browser always
 *   revalidates, preventing stale index.html from referencing outdated asset hashes.
 *
 * The SPA CSP differs from the API CSP: it allows the inline FOUC prevention
 * script via 'unsafe-inline' in script-src.
 */
export function withSpaSecurityHeaders(
  response: Response,
  requestPath: string
): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SHARED_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Security-Policy", SPA_CSP);

  if (requestPath.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    headers.set("Cache-Control", "no-cache");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
