import { Scalar } from "@scalar/hono-api-reference";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createDb } from "../db";
import type { AppBindings, AppEnv } from "./env";
import { resolveAllowedOrigin } from "./lib/auth";
import { errorResponse } from "./lib/error-response";
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

// Interactive API documentation (Scalar)
app.get(
  "/api/docs/webhooks",
  Scalar({
    url: "/api/openapi.json",
    pageTitle: "Cadence Webhook API",
  }),
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
