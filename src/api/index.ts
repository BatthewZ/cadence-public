import { Scalar } from "@scalar/hono-api-reference";
import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createDb } from "../db";
import type { AppBindings, AppEnv } from "./env";
import { resolveAllowedOrigin } from "./lib/auth";
import { errorResponse } from "./lib/error-response";
import { auditPatMutations } from "./middleware/audit-pat";
import { authSessionMiddleware } from "./middleware/auth";
import { requestLogger } from "./middleware/logger";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware, withSpaSecurityHeaders } from "./middleware/security-headers";
import { telemetryMiddleware } from "./middleware/telemetry";
import routes from "./routes";
import { handleScheduled } from "./scheduled";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  console.error(
    JSON.stringify({
      level: "error",
      method: c.req.method,
      path: c.req.path,
      error: err.message,
      stack: err.stack,
      requestId,
    })
  );
  return c.json({ error: "Internal Server Error", requestId }, 500);
});

app.use("/api/*", requestIdMiddleware);
app.use("/api/*", requestLogger);
app.use("/api/*", telemetryMiddleware);
app.use("/api/*", securityHeadersMiddleware);

// Create a single Drizzle DB instance per request, shared across all
// middleware and handlers via the Hono context. This avoids constructing
// 3-5 duplicate Drizzle wrappers for the same underlying D1 binding.
app.use("/api/*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});

app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const env = c.env as AppBindings;
      return resolveAllowedOrigin(origin, env.BETTER_AUTH_URL, env.TRUSTED_ORIGINS);
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Interactive API documentation (Scalar).
//
// `/api/docs` renders the full Cadence API reference (workspaces, projects,
// tasks, labels, API tokens, webhooks) — this is the entry point linked from
// the workspace API Tokens settings and from the public docs.
//
// `/api/docs/webhooks` is kept as an alias (same underlying OpenAPI spec, just
// a webhook-focused page title) because the Project Settings → Webhooks UI
// links there. Both serve the same `/api/openapi.json` spec; Scalar's left-hand
// nav lets the reader jump straight to the webhook section.
//
// Scalar's `getHtmlDocument` template does not expose a favicon hook, so we
// wrap the middleware: render Scalar's HTML, then splice in the same favicon
// links the SPA uses (`/favicon.svg` + `/favicon.png` fallback) right before
// `</head>` so the docs tab shows the Cadence mark instead of the browser
// default. The favicon files themselves are served from `dist/` via the
// ASSETS binding — they aren't `/api/*` paths so they bypass the worker and
// fall through to static assets normally.
const FAVICON_LINKS =
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />' +
  '<link rel="icon" type="image/png" href="/favicon.png" />';

const withCadenceFavicon = (
  handler: MiddlewareHandler<AppEnv>,
): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const response = await handler(c, next);
    if (!response) {
      return response;
    }
    const html = await response.text();
    const patched = html.includes("</head>")
      ? html.replace("</head>", `${FAVICON_LINKS}</head>`)
      : html;
    return c.html(patched);
  };
};

app.get(
  "/api/docs",
  withCadenceFavicon(
    Scalar<AppEnv>({
      url: "/api/openapi.json",
      pageTitle: "Cadence API",
    }),
  ),
);

app.get(
  "/api/docs/webhooks",
  withCadenceFavicon(
    Scalar<AppEnv>({
      url: "/api/openapi.json",
      pageTitle: "Cadence Webhook API",
    }),
  ),
);

app.get("/api/health", async (c) => {
  const db = c.get("db");
  try {
    await db.run(sql`SELECT 1`);
    return c.json({ ok: true, db: "healthy" });
  } catch (err) {
    return c.json(
      { ok: false, db: "unhealthy", error: err instanceof Error ? err.message : "Unknown error" },
      503
    );
  }
});

app.use("/api/*", authSessionMiddleware);

// PAT audit ledger — runs after the handler resolves so we can attribute
// every successful 2xx mutation that arrived with a Bearer cdn_pat_ token.
// No-op on cookie traffic and on non-mutating methods, so it costs nothing
// for the vast majority of requests. Mount order matters: this must come
// AFTER `authSessionMiddleware` (so `c.get("apiToken")` is populated) but
// BEFORE `app.route("/api", routes)` (so it wraps every route handler).
app.use("/api/*", auditPatMutations);

app.route("/api", routes);

app.all("/api/*", (c) => {
  return errorResponse(c, "Not Found", 404);
});

app.get("/robots.txt", () => {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /w/",
  ].join("\n");
  return withSpaSecurityHeaders(
    new Response(body, { headers: { "Content-Type": "text/plain" } }),
    "/robots.txt"
  );
});

app.all("*", async (c) => {
  try {
    const response = await c.env.ASSETS.fetch(c.req.raw);
    return withSpaSecurityHeaders(response, c.req.path);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        handler: "spaFallback",
        method: c.req.method,
        path: c.req.path,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    const errorHtml =
      "<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Something went wrong</h1><p>Please try again later.</p></body></html>";
    return withSpaSecurityHeaders(
      new Response(errorHtml, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
      c.req.path
    );
  }
});

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
