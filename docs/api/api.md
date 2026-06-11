# API

## Overview

The API is a Hono application running inside a Cloudflare Worker. All API endpoints are mounted under `/api/*`. The entry point is `src/api/index.ts`. There are 102 endpoints across workspaces, projects, tasks, labels, attachments, teams, invitations, dashboard, activity, webhooks, freshness, runtime config, Unsplash cover photo search, and API tokens for machine clients.

Two authentication primitives are supported simultaneously:

- **Cookie sessions** for browser-based human users (managed by Better Auth — see [Auth](../auth/auth.md)).
- **Personal Access Tokens (PATs)** for machine clients — Slackbots, GitHub Actions, internal tools, AI agents. See [API Tokens](./api-tokens.md) and [Integrations](./integrations.md).

A PAT in `Authorization: Bearer cdn_pat_…` takes precedence over any cookie on the same request. The two paths never mix — a malformed Bearer token returns `401` immediately rather than silently downgrading to cookie auth, which would otherwise enable a downgrade attack.

## Documentation

- [Middleware](./middleware.md) -- middleware stack, order, and details for each middleware
- [Endpoints](./endpoints.md) -- available API endpoints and request/response formats (labels, task labels, project duplication, and more)
- [Error Handling](./error-handling.md) -- global error handler behavior
- [Rate Limiting](./rate-limiting.md) -- rate limit configuration and behavior
- [Validation](./validation.md) -- request validation middleware
- [Error Response Helper](../../src/api/lib/error-response.ts) -- `errorResponse()` returns a JSON error with `requestId`; `throwWithContext()` re-throws with a contextual prefix for structured logging
- [Parameter Extraction](../../src/api/lib/params.ts) -- `requireParam()` / `requireParams()` type-safe path parameter extraction that throws on missing params (replaces unsafe `as string` casts)
- [Validated Data Access](../../src/api/lib/validated.ts) -- `validJson()` / `validQuery()` type-safe wrappers for accessing zValidator-parsed data in standalone handler functions
- [Access Resolution](../../src/api/lib/access.ts) -- `resolveProjectAccess()` shared function for project authorization checks (single source of truth used by middleware and route handlers)
- [Cursor Pagination](../../src/api/lib/pagination.ts) -- `parseCursorParams()`, `parseCursorDate()`, `computeNextCursor()` helpers for simple cursor pagination; `parseCompoundCursor()`, `compoundCursorCondition()`, and `computeCompoundNextCursor()` for compound `"date|id"` cursors that eliminate gaps when rows share identical dates
- [Adding Routes](./adding-routes.md) -- step-by-step guide for adding new API routes
- [Frontend API Client](./client.md) -- typed fetch wrapper for the frontend
- [CORS](./cors.md) -- CORS configuration and allowed origins
- [Email Service](./email.md) -- email delivery via Resend (production) or console (development)
- [File Storage](./storage.md) -- file uploads via Cloudflare R2 with upload endpoints
- [Webhooks](./webhooks.md) -- event types, payload format, signature verification, retry/delivery, auto-disable, retention, dev mode, limits, OpenAPI spec
- [API Tokens](./api-tokens.md) -- Personal Access Tokens for machine clients: format, scopes, project scoping, expiry, rotation, revocation, rate limits, and security best practices
- [Integrations](./integrations.md) -- end-to-end walkthroughs for Slackbots and GitHub Actions combining PATs (inbound) with webhooks (outbound)
- [Interactive API Docs](./webhooks.md#interactive-api-documentation) -- Scalar-powered OpenAPI 3.1 reference at `/api/docs` (spec at `/api/openapi.json`); the **Authorize** button accepts either a PAT (Bearer) or the cookie session
- [Webhook Internals](../../src/api/lib/webhooks.ts) -- re-export barrel for `webhooks/` sub-modules: delivery with exponential-backoff retries and cron-driven retry processing ([delivery.ts](../../src/api/lib/webhooks/delivery.ts)), HMAC-SHA256 signing, SSRF-safe URL validation, and secret generation ([utils.ts](../../src/api/lib/webhooks/utils.ts))
- [Webhook Payloads](../../src/api/lib/webhook-payloads.ts) -- payload envelope builder, change detection (`computeChanges`), domain-specific data extractors (task, project, invitation, member), enrichment resolvers (`resolveUser`, `resolveTaskGroup`, `resolveTaskEnrichment`), secondary event detection, context fetcher, `fireWebhookEvent` fire-and-forget dispatch, and `dispatchWebhook` convenience wrapper for Hono handlers
- [Project Webhook Handlers](../../src/api/routes/projects/project-webhooks.handlers.ts) -- CRUD + test delivery for project-scoped webhooks (6 endpoints mounted under `/api/projects/:projectId/webhooks`)
- [Deferred Work](../../src/api/lib/defer.ts) -- `deferWork()` helper that uses the Cloudflare Workers `waitUntil()` API to run non-critical side-effects (activity logging, notifications) after the response is sent
- [Recurring Task Spawning](../../src/api/routes/tasks/helpers/spawn-recurring-instance.ts) -- `spawnNextRecurringInstance()` creates the next instance of a recurring task on completion (computes next due date, copies relations, guards against duplicate spawns via unique index); `logRecurringInstanceCreated()` logs activity and notifies the assignee for the new instance
- [Telemetry](../../src/api/lib/telemetry/index.ts) -- pluggable telemetry sink system with three backends: `AnalyticsEngineSink` (Cloudflare Analytics Engine), `ConsoleSink` (structured JSON to stdout), and `NoopSink` (silent discard). The sink is created per-request by `telemetryMiddleware` and stored in context as `c.get("telemetry")`. Events tracked: `http_request`, `webhook_delivery`, `webhook_retry`, `cron_run`, `cron_task`. Sink selection is driven by the `TELEMETRY_SINK` env var or auto-detected from the `ANALYTICS` binding. Types are defined in `src/api/lib/telemetry/types.ts`.
- [Scheduled Handler](../../src/api/scheduled/index.ts) -- Cloudflare Cron Trigger handler (every 5 min) for webhook retry processing, delivery record cleanup, expired auth record cleanup (sessions + verification tokens), notification cleanup, task activity cleanup, and invitation cleanup. Each task is error-isolated so a single failure does not block others. Tracks `cron_task` and `cron_run` telemetry events.
- [Legal Routes](../../src/api/routes/legal/legal.routes.ts) -- ToS status check and acceptance endpoints (`GET /api/legal/tos-status`, `POST /api/legal/accept-tos`), both require auth
- [Config Route](../../src/api/routes/config/config.routes.ts) -- `GET /api/config` unauthenticated runtime feature flags (currently `features.unsplash`); `Cache-Control: private, max-age=300` so SPA navigation does not re-fetch but shared caches never store it
- [Unsplash Routes](../../src/api/routes/unsplash/unsplash.routes.ts) -- `GET /api/unsplash/search` and `GET /api/unsplash/curated` proxy the Unsplash REST API; both require auth and share a 30 req/min per-user rate limit; normalise responses into `UnsplashCoverPayload` with mandatory UTM attribution
- [Unsplash Service](../../src/api/lib/unsplash.ts) -- `createUnsplashService(env)` factory that returns `null` when `UNSPLASH_ACCESS_KEY` is unset (callers surface 503), `appendUtm` / `toCoverPayload` normalisers, `UnsplashError` with upstream status, and `trackDownload` which MUST be safe to call via `waitUntil` and swallows all errors
- [Cover Image Helpers](../../src/api/lib/cover-image.ts) -- shared `handleUploadCover` / `handleApplyUnsplashCover` / `handleDeleteCover` functions used by both project and task cover routes. Enforces the `coverImageKey` ↔ `coverUnsplash` XOR invariant in application code: every write funnels through a single `setEntityCover(db, { coverImageKey, coverUnsplash }, updatedAt)` callback that always writes BOTH fields so one source clears the other atomically. Apply-Unsplash fires `trackDownload()` via `deferWork` after the DB write succeeds.
