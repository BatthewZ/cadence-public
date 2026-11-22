# API

## Overview

The API is a Hono application running inside a Cloudflare Worker. All API endpoints are mounted under `/api/*`. The entry point is `src/api/index.ts`. There are 124 endpoints across workspaces, projects, tasks (including bulk calendar import), labels, saved views, attachments, teams, invitations, notifications, search, dashboard, activity, webhooks, freshness, runtime config, Unsplash cover photo search, personal ICS calendar feeds, data export (per-project CSV and full-workspace JSON archive), workspace import (Cadence JSON and Trello board JSON), and API tokens for machine clients.

That figure counts distinct `method + path` pairs registered by the route aggregator in `src/api/routes/index.ts`. It excludes the Better Auth catch-all (`GET`/`POST /api/auth/*`, which fronts a whole family of sign-in, session, and account endpoints — see [Endpoints](./endpoints.md#post-apiauth-and-get-apiauth)) and the non-domain meta endpoints served by `src/api/index.ts` itself: `/api/health`, `/api/openapi.json`, `/api/docs`, and `/api/docs/webhooks`.

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
- [Export & Import](../guides/export-import.md) -- the workspace JSON export format spec, per-project CSV export, importing Cadence JSON and Trello boards, what round-trips vs what is deliberately skipped (and why), limits
- [Interactive API Docs](./webhooks.md#interactive-api-documentation) -- Scalar-powered OpenAPI 3.1 reference at `/api/docs` (spec at `/api/openapi.json`); the **Authorize** button accepts either a PAT (Bearer) or the cookie session
- [Webhook Internals](../../src/api/lib/webhooks.ts) -- re-export barrel for `webhooks/` sub-modules: delivery with exponential-backoff retries and cron-driven retry processing ([delivery.ts](../../src/api/lib/webhooks/delivery.ts)), HMAC-SHA256 signing, SSRF-safe URL validation, and secret generation ([utils.ts](../../src/api/lib/webhooks/utils.ts))
- [Webhook Payloads](../../src/api/lib/webhook-payloads.ts) -- payload envelope builder, change detection (`computeChanges`), domain-specific data extractors (task, project, invitation, member), enrichment resolvers (`resolveUser`, `resolveTaskGroup`, `resolveTaskEnrichment`), secondary event detection, context fetcher, `fireWebhookEvent` fire-and-forget dispatch, and `dispatchWebhook` convenience wrapper for Hono handlers
- [Project Webhook Handlers](../../src/api/routes/projects/project-webhooks.handlers.ts) -- CRUD + test delivery for project-scoped webhooks (6 endpoints mounted under `/api/projects/:projectId/webhooks`)
- [Deferred Work](../../src/api/lib/defer.ts) -- `deferWork()` helper that uses the Cloudflare Workers `waitUntil()` API to run non-critical side-effects (activity logging, notifications) after the response is sent
- [Assignee Validation](../../src/api/lib/assignee-validation.ts) -- single source of truth for "may this user hold a task in this project?". `canUserBeAssigned()` gates every request-supplied `assigneeId` (create + update; 400 on failure); `retainAssignableAssignee()` filters an *inherited* assignee on the duplicate, recurring-spawn and completion-notification paths, dropping it to `null` rather than failing the operation. Both delegate to `resolveProjectAccess`, so workspace owner/admin elevation is honoured without a `project_member` row and the access rules are never re-derived. See [Endpoints § Assignee rule](./endpoints.md#assignee-rule)
- [Recurring Task Spawning](../../src/api/routes/tasks/helpers/spawn-recurring-instance.ts) -- `spawnNextRecurringInstance()` creates the next instance of a recurring task on completion (computes next due date, copies relations, guards against duplicate spawns via unique index); the spawned instance inherits the source assignee only while that person can still access the project, otherwise it spawns unassigned. `logRecurringInstanceCreated()` logs activity and notifies the **spawned** instance's assignee. `removeUntouchedRecurringInstance()` undoes a spawn on reopen (uncomplete, or move out of a completion group), deleting the instance only while `updatedAt = createdAt`
- [Telemetry](../../src/api/lib/telemetry/index.ts) -- pluggable telemetry sink system with three backends: `AnalyticsEngineSink` (Cloudflare Analytics Engine), `ConsoleSink` (structured JSON to stdout), and `NoopSink` (silent discard). The sink is created per-request by `telemetryMiddleware` and stored in context as `c.get("telemetry")`. Events tracked: `http_request`, `webhook_delivery`, `webhook_retry`, `cron_run`, `cron_task`. Sink selection is driven by the `TELEMETRY_SINK` env var or auto-detected from the `ANALYTICS` binding. Types are defined in `src/api/lib/telemetry/types.ts`.
- [Scheduled Handler](../../src/api/scheduled/index.ts) -- Cloudflare Cron Trigger handler (every 5 min) for webhook retry processing, delivery record cleanup, expired auth record cleanup (sessions + verification tokens), notification cleanup, task activity cleanup, invitation cleanup, and expired `Idempotency-Key` cleanup. Each task is error-isolated so a single failure does not block others. Tracks `cron_task` and `cron_run` telemetry events.
- [Legal Routes](../../src/api/routes/legal/legal.routes.ts) -- ToS status check and acceptance endpoints (`GET /api/legal/tos-status`, `POST /api/legal/accept-tos`), both require auth
- [Config Route](../../src/api/routes/config/config.routes.ts) -- `GET /api/config` unauthenticated runtime feature flags (currently `features.unsplash`); `Cache-Control: private, max-age=300` so SPA navigation does not re-fetch but shared caches never store it
- [Unsplash Routes](../../src/api/routes/unsplash/unsplash.routes.ts) -- `GET /api/unsplash/search` and `GET /api/unsplash/curated` proxy the Unsplash REST API; both require auth and share a 30 req/min per-user rate limit; normalise responses into `UnsplashCoverPayload` with mandatory UTM attribution
- [Calendar Routes](../../src/api/routes/calendar/calendar.routes.ts) -- the public `GET /api/calendar/feed/:token` ICS subscription endpoint (capability-URL auth, deliberately excluded from the OpenAPI spec) and the cookie-only feed-management surface (`GET`/`POST`/`DELETE /api/workspaces/:workspaceId/calendar-feed`, which rejects PAT auth via `rejectPatAuth()`). Feed tokens are a separate read-only `cdn_cal_` credential class minted through the shared `mintToken` path; the handler enforces a constant-shape verify (prefix reject → peppered HMAC → live workspace-membership re-check) with a uniform 404 on every failure. See [Endpoints § Calendar Feed](./endpoints.md#calendar-feed)
- [Data Export Handlers](../../src/api/routes/workspaces/export.handlers.ts) -- `GET /api/workspaces/:workspaceId/export` streams a canonical, versioned JSON archive of the entire workspace as one valid document (one project subtree stringified at a time, so a heavy workspace never materializes the full object graph + serialized string in the isolate at once). Owner/admin only, 5/hour, secrets (`webhook.secret`, `invitation.token`) structurally excluded via strict-schema projection, attachments as manifests, ex-member identities resolved through a `users` ref directory, and every export written to `audit_log`. The sibling [`export-csv.handler.ts`](../../src/api/routes/projects/export-csv.handler.ts) serves `GET /api/projects/:projectId/export/csv` — a flat per-project task CSV (any member, 30/hour) routed through the OWASP-hardened [`toCsv`](../../src/api/lib/csv.ts) serializer. See [Endpoints § Workspaces](./endpoints.md#get-apiworkspacesworkspaceidexport) and [§ Projects](./endpoints.md#get-apiprojectsprojectidexportcsv)
- [Workspace Import Handler](../../src/api/routes/workspaces/import.handlers.ts) -- `POST /api/workspaces/:workspaceId/import` accepts a multipart file upload (max 20 MB, size-checked before `JSON.parse`) containing either a Cadence workspace export or a Trello board JSON, and creates its projects as **new** projects in the current workspace — it never merges into or mutates existing content. `?dryRun=true` runs the identical parse → user-match → repair pipeline with **zero writes** and returns an `importPreviewSchema` report; the commit returns `importResultSchema` (created counts, unmatched users, skipped sections, per-project failures) — both defined in [`workspace-import.ts`](../../src/shared/schemas/workspace-import.ts). Owner/admin only, 10/hour, audit-logged on commit; oversized files are `413`, malformed/unsupported files are `400`. The pipeline is three pure modules: [`import/parse.ts`](../../src/api/routes/workspaces/import/parse.ts) (size guard → JSON → format sniff → Zod validation → referential-integrity checks), [`import/executor.ts`](../../src/api/routes/workspaces/import/executor.ts) (member-only email matching, fresh-UUID remapping, D1 bound-parameter chunk math, all-or-nothing per project via compensating delete), and [`import/trello.ts`](../../src/api/routes/workspaces/import/trello.ts) (Trello board → the same canonical `ImportDocument`, so Trello imports get preview/commit/rollback for free). See [Endpoints § Workspaces](./endpoints.md#post-apiworkspacesworkspaceidimport) for the full request/response reference and the [Export & Import guide](../guides/export-import.md) for the format spec and what round-trips
- [Task Import Handler](../../src/api/routes/tasks/handlers/import.ts) -- `POST /api/projects/:projectId/tasks/import` bulk-creates up to 500 tasks from a client-parsed `.ics` calendar (server only ever sees validated JSON). Events carrying a `sourceUid` (ICS `UID`) dedupe per project via a partial unique index on (`projectId`, `source_uid`); all inserts run in one atomic D1 batch inside the position-conflict retry loop; no `task.created` webhook fan-out for bulk imports
- [Unsplash Service](../../src/api/lib/unsplash.ts) -- `createUnsplashService(env)` factory that returns `null` when `UNSPLASH_ACCESS_KEY` is unset (callers surface 503), `appendUtm` / `toCoverPayload` normalisers, `UnsplashError` with upstream status, and `trackDownload` which MUST be safe to call via `waitUntil` and swallows all errors
- [Cover Image Helpers](../../src/api/lib/cover-image.ts) -- shared `handleUploadCover` / `handleApplyUnsplashCover` / `handleDeleteCover` functions used by both project and task cover routes. Enforces the `coverImageKey` ↔ `coverUnsplash` XOR invariant in application code: every write funnels through a single `setEntityCover(db, { coverImageKey, coverUnsplash }, updatedAt)` callback that always writes BOTH fields so one source clears the other atomically. Apply-Unsplash fires `trackDownload()` via `deferWork` after the DB write succeeds.

## Offline-safe writes

The web client queues writes made offline and replays them through these same endpoints when the connection returns (design: [Offline](../architecture/offline.md)). Four server mechanisms make a replay safe; PAT clients can use them too. Every refusal below carries a machine-readable `code` next to `error` (values in `src/shared/constants/offline-sync.ts`).

### `Idempotency-Key`

Send `Idempotency-Key: <key>` on any `POST`, `PUT`, `PATCH` or `DELETE` under `/api/*` (except `/api/auth/*`) to make a retry of that request safe. Keys are 1–255 characters of `A–Z a–z 0–9 _ -`; the web client sends `crypto.randomUUID()`. Without the header nothing changes.

Keys are scoped to the authenticated user, whether they arrive with a cookie session or a PAT (one user's PATs and browser sessions share one key space; two users never collide). Each key is bound to the request's method, path (query string included) and exact body bytes. Implemented by `src/api/middleware/idempotency.ts`, mounted after the auth session and before the PAT audit ledger.

| A request with a key that… | Answer |
|---|---|
| has not been seen | Runs normally. A `2xx` JSON response of at most 1 MB is stored |
| was seen, completed, same request | The stored status and body, with `Idempotent-Replayed: true`. The handler does not run again, so no second webhook, activity entry, notification or audit row |
| was seen with a different method, path or body | `422`, `code: "idempotency_mismatch"` |
| is still running (first seen under 60 s ago) | `409`, `code: "idempotency_in_progress"`, `Retry-After: 1` |
| was left pending over 60 s ago (crashed attempt) | Taken over and run |
| is malformed | `400` |

A non-`2xx`, non-JSON or oversized response is not stored, so a retry with the same key runs the handler again. That includes a `204 No Content` (e.g. deleting a webhook): its retry runs the delete again and typically answers `404`. A key whose response was not stored is released, so the next request with it, whatever its body, runs as new. A replay carries only the stored status and JSON body, plus `Idempotent-Replayed: true`; other headers of the first response are not stored. Completed keys are kept for 30 days (`IDEMPOTENCY_TTL_DAYS`), then removed by the scheduled handler; a retry after that runs again, which client-supplied ids below turn into a `409` rather than a duplicate. A request with no authenticated user ignores the header and is handled as if it had none.

Multipart bodies are fingerprinted byte for byte, boundary included, so a retry must resend the identical bytes or it is a mismatch.

### Client-supplied ids

`POST` creates for tasks, subtasks, comments, task groups, project labels and saved views accept an optional `id` (UUID). The row is created with that id, so an offline client can move, edit or comment on a row before the server has seen it. If any row of that type already has the id — in any project — the create answers `409`, `code: "id_conflict"`, and writes nothing.

### Description compare-and-set

`PATCH /api/tasks/:taskId` accepts `descriptionBase`: the description the edit started from. Sent together with `description`, the patch applies only if the stored description still equals it (`null` and `""` count as equal); otherwise the answer is `409`, `code: "description_conflict"`, nothing in the patch is applied, and the body carries the current task under `task` in the `GET /api/tasks/:taskId` shape. `descriptionBase` is never stored and never appears in webhook `changes`. See [Endpoints](./endpoints.md#patch-apitaskstaskid).

### Stale positions and deletes

- **Positions.** `PATCH /api/tasks/:taskId/move`, `PATCH /api/task-groups/:taskGroupId/reorder` and a `position` on `PATCH /api/subtasks/:subtaskId` write the client's fractional index. When a sibling already holds it, the row lands immediately after it instead of failing.
- **Freshness.** `GET /api/projects/:projectId/freshness` also returns `taskCount` and `taskGroupCount`, and `GET /api/workspaces/:workspaceId/freshness` returns `projectCount` and `taskCount`. Deletes are hard and move no `updatedAt`, so a changed count is how a poller sees one. See [Endpoints](./endpoints.md#get-apiprojectsprojectidfreshness).
