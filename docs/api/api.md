# API

## Overview

The API is a Hono application running inside a Cloudflare Worker. All API endpoints are mounted under `/api/*`. The entry point is `src/api/index.ts`.

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
- [Webhooks](./webhooks.md) -- event types, payload format, signature verification, retry/delivery, auto-disable, retention, dev mode, limits
- [Webhook Internals](../../src/api/lib/webhooks.ts) -- re-export barrel for `webhooks/` sub-modules: delivery with exponential-backoff retries and cron-driven retry processing ([delivery.ts](../../src/api/lib/webhooks/delivery.ts)), HMAC-SHA256 signing, SSRF-safe URL validation, and secret generation ([utils.ts](../../src/api/lib/webhooks/utils.ts))
- [Webhook Payloads](../../src/api/lib/webhook-payloads.ts) -- payload envelope builder, change detection (`computeChanges`), domain-specific data extractors (task, project, invitation, member), secondary event detection, context fetcher, `fireWebhookEvent` fire-and-forget dispatch, and `dispatchWebhook` convenience wrapper for Hono handlers
- [Deferred Work](../../src/api/lib/defer.ts) -- `deferWork()` helper that uses the Cloudflare Workers `waitUntil()` API to run non-critical side-effects (activity logging, notifications) after the response is sent
- [Recurring Task Spawning](../../src/api/routes/tasks/helpers/spawn-recurring-instance.ts) -- `spawnNextRecurringInstance()` creates the next instance of a recurring task on completion (computes next due date, copies relations, guards against duplicate spawns via unique index); `logRecurringInstanceCreated()` logs activity and notifies the assignee for the new instance
- [Scheduled Handler](../../src/api/scheduled/index.ts) -- Cloudflare Cron Trigger handler (every 5 min) for webhook retry processing, delivery record cleanup, and expired auth record cleanup (sessions + verification tokens)
