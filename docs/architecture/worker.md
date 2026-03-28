# Worker Architecture

## Single Worker Architecture

The entire application -- API routes, auth logic, scheduled jobs, and the React SPA -- is served from one Cloudflare Worker. The Worker entry point is `src/api/index.ts`, which creates a Hono app and exports both a `fetch` handler (HTTP) and a `scheduled` handler (cron).

The Worker export looks like:

```ts
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
```

The routing strategy splits HTTP traffic into two categories:

1. **`/api/*` requests** are handled by the Hono application (API routes, middleware, auth).
2. **All other requests** are forwarded to the Cloudflare Assets binding, which serves the pre-built Vite output (the React SPA).

This is implemented at the bottom of `src/api/index.ts`:

```ts
// API routes
app.route("/api", routes);

// Catch-all for unknown API paths
app.all("/api/*", (c) => {
  const requestId = c.get("requestId") ?? "unknown";
  return c.json({ error: "Not Found", requestId }, 404);
});

// Everything else -> serve the SPA
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
```

---

## How `run_worker_first` Works

The `wrangler.toml` configuration controls how the Worker and static assets interact:

```toml
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true
```

### What `run_worker_first = true` does

By default, Cloudflare Workers with an assets binding check the static assets directory first. If a file matches the request path (e.g., `/assets/index-abc123.js`), it is served directly without invoking the Worker. The Worker only runs for paths that do not match a static file.

Setting `run_worker_first = true` reverses this: **the Worker always runs first** for every request. The Worker then decides whether to handle the request itself or forward it to the assets binding via `c.env.ASSETS.fetch(c.req.raw)`.

This is necessary because:

1. The Worker needs to apply middleware (request ID, logging, security headers, CORS, session extraction) to all `/api/*` requests before routing.
2. The Worker's catch-all `app.all("*", ...)` explicitly delegates non-API requests to the assets binding.

### What `not_found_handling = "single-page-application"` does

When the assets binding receives a request for a path that does not correspond to a real file (e.g., `/dashboard`, `/settings`), instead of returning a 404, it serves `index.html`. This enables client-side routing -- React Router handles these paths in the browser.

---

## Request Flow

```
                         Incoming Request
                              |
                              v
                    +-------------------+
                    | Cloudflare Worker  |
                    | (run_worker_first) |
                    +-------------------+
                              |
                    Is path /api/* ?
                     /              \
                   Yes               No
                   /                  \
                  v                    v
    +-------------------------+    +------------------+
    | Hono Middleware Stack   |    | ASSETS.fetch()   |
    | 1. requestId            |    | Static file?     |
    | 2. requestLogger        |    |  /          \    |
    | 3. securityHeaders      |    | Yes          No  |
    | 4. CORS                 |    |  |            |  |
    | 5. authSession          |    |  v            v  |
    +-------------------------+    | file.js   index. |
              |                    |            html  |
              v                    +------------------+
    +-------------------------+             |
    | Route Matching          |             v
    | /api/health             |    React SPA boots,
    | /api/auth/**            |    React Router handles
    | /api/me                 |    client-side routing
    | /api/* (404 catch-all)  |
    +-------------------------+
              |
              v
         JSON Response
```

---

## Scheduled (Cron) Handler

The Worker also exports a `scheduled` handler, invoked by Cloudflare Cron Triggers on a recurring schedule. The cron is configured in `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]   # Every 5 minutes
```

The handler lives in `src/api/scheduled/index.ts` and runs six background maintenance tasks:

1. **Webhook retries** -- Re-attempts failed webhook deliveries whose exponential-backoff timer has elapsed (batch of 10 per run).
2. **Delivery cleanup** -- Removes webhook delivery records older than 30 days and enforces a per-webhook cap of 200 records.
3. **Auth cleanup** -- Removes expired sessions and abandoned verification tokens that Better Auth does not clean up automatically.
4. **Notification cleanup** -- Removes read notifications older than 30 days and unread notifications older than 90 days.
5. **Task activity cleanup** -- Removes activity records older than 90 days and enforces a per-task cap of 500 records.
6. **Invitation cleanup** -- Removes non-pending expired invitations and pending invitations expired beyond a 7-day grace period.

All cleanup tasks delete in batches of 100 to stay within Cloudflare Workers free-tier CPU limits.

```
                          Cron Trigger (every 5 min)
                                   |
                                   v
                        +---------------------+
                        | handleScheduled()   |
                        +---------------------+
                                   |
     +----------+----------+------+------+-----------+-----------+
     |          |          |             |           |           |
     v          v          v             v           v           v
  Webhook    Webhook    Auth          Notification  Task       Invitation
  Retries    Delivery   Cleanup       Cleanup       Activity   Cleanup
  (retry     Cleanup    (sessions +   (30d read,    Cleanup    (non-pending
  failed     (30d TTL   verification  90d unread)   (90d TTL   expired +
  sends)     + 200/wh   tokens)                     + 500/     7d pending
             cap)                                   task cap)  grace)
```

Because these run inside the same Worker, they share the same D1 binding and code as the HTTP handlers -- no separate service is needed.
