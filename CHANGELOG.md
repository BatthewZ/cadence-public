# Changelog

All notable changes to Cadence are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [1.13.0] - 2026-04-09

### Added

- Drag-and-drop project reordering in the workspace sidebar using fractional indexing
- `PATCH /api/projects/:projectId/reorder` endpoint for updating project position
- Lazy backfill: existing projects without a position are automatically assigned one on first list
- New projects and duplicated projects are appended to the end of the sidebar order
- Optimistic UI updates for instant drag-and-drop feedback with rollback on failure

## [1.12.1] - 2026-04-09

### Added

- Webhook payload enrichment: task events include resolved `assignee`, `taskGroup`, and `completedByUser` objects; member events include resolved `user` object; comment events include resolved `author` object
- Enriched `changes` field: `task.updated` and `task.moved` events include resolved objects for ID-based changes (e.g. `assignee: { from, to }` alongside `assigneeId: { from, to }`)
- Non-retryable HTTP status codes (401, 403, 404, 405, 410) skip retries immediately on webhook delivery failure
- Project-scoped webhook management UI in Project Settings > Webhooks tab (6 new API endpoints)
- Archiving a project now auto-deletes its project-scoped webhooks

### Changed

- Workspace webhook form only shows active projects in the project scope selector
- Shared webhook handler helpers (`MAX_WEBHOOKS_PER_WORKSPACE`, `isDevMode`, `omitSecret`) extracted to `src/api/lib/webhooks/utils.ts`
- `resolveRecurringTaskEnrichment()` extracted as shared helper for recurring task webhook payloads
- API client now handles 204 No Content responses

## [1.11.0] - 2026-04-09

### Added

- Project-scoped webhooks: optionally limit a webhook to fire only for events from a specific project
- Validation that project-scoped webhooks cannot subscribe to workspace or invitation events
- Project scope selector in webhook create/edit dialogs with automatic event filtering

## [1.10.1] - 2026-04-06

### Changed

- Webhook retry batch limit increased from 10 to 50 per cron invocation
- Webhook retry backoff delays now include ±20% random jitter to prevent thundering-herd effects
- Scheduled handler tasks are now error-isolated — a failure in one cleanup task no longer blocks the rest
- Comment database index upgraded to compound index on (`taskId`, `createdAt`) for faster chronological queries
- Structured context objects added to error logging across API handlers for improved debuggability

### Added

- Error states with retry UI on ProjectBoard and ProjectTimeline when data queries fail
- `tasksError` and `taskGroupsError` exposed from `ProjectContext` for downstream error handling
- Notifications and Workspaces pages now use the `EmptyState` component family for consistent empty-state UX

### Removed

- One-off `convert-to-oklch.ts` script (color migration complete)

## [1.10.0] - 2026-04-06

### Added

- Terms of Service and Privacy Policy pages (`/terms`, `/privacy`)
- ToS acceptance gate for authenticated users via `TosGuard` route guard — existing users who haven't accepted the current ToS version are redirected to `/accept-terms`
- Legal acceptance API endpoints (`GET /api/legal/tos-status`, `POST /api/legal/accept-tos`) with `legal_acceptance` database table
- ToS acceptance checkbox on the registration form with schema validation (`tosAccepted` field on `registerSchema`)
- Terms and Privacy links in the landing page footer

## [1.9.2] - 2026-04-06

### Changed

- Converted all color tokens from hex/rgb to OKLCH color space across base tokens, all 17 theme files, overlays, shadows, and component CSS. OKLCH provides perceptually uniform lightness and wider gamut for more predictable color mixing across themes.
- `color-mix()` functions now interpolate `in oklch` instead of `in srgb`
- Theme editor color helper (`toHex`) now uses the `culori` library to parse any CSS color format (including OKLCH) back to hex for color picker inputs

### Added

- `culori` dependency for robust CSS color parsing and conversion

## [1.9.1] - 2026-04-05

### Changed

- Converted all hardcoded `px` values to `rem` units across CSS tokens (radius, spacing, typography, motion distances, overlay blur, media), component stylesheets, and Tailwind arbitrary values in TSX components (80 files). Improves accessibility by respecting user font-size preferences.

## [1.9.0] - 2026-04-02

### Added

- OpenAPI 3.1 specification for webhook endpoints with Scalar interactive docs at `/api/docs`
- Per-endpoint rate limiting on webhook routes (read 60/min, write 20/min, test 5/min)
- Response schemas for all webhook endpoints (`src/shared/schemas/webhook-responses.ts`)

### Changed

- Webhook routes rewritten from plain Hono to `@hono/zod-openapi` for type-safe OpenAPI definitions
- Upgraded Zod from v3 to v4; updated validation types (`ZodSchema` → `ZodType`) and Zod error access (`.errors` → `.issues`)
- Exported `validationHook` from validate middleware for reuse as `OpenAPIHono` default hook
- Docs-specific CSP policy for Scalar UI paths

## [1.8.0] - 2026-04-02

### Added

- Recurring tasks system: schema, types, recurrence rule helpers, RecurrencePicker UI, task spawning on completion, and webhook payloads for recurrence events (Phases 1-5)

### Fixed

- Timeline date-bucketing timezone bug

## [1.7.1] - 2026-04-01

### Fixed

- Project dashboard overdue count now updates when a task is marked completed

### Changed

- Completed tasks are excluded from the Timeline by default

## [1.7.0] - 2026-03-31

### Added

- Multi-mode grouping for ProjectTimeline with GroupBy dropdown, URL persistence, and input validation

### Fixed

- Skip freshness polling for single-member workspaces to eliminate unnecessary network requests

## [1.6.0] - 2026-03-31

### Added

- Real-time freshness polling system with edge caching and `updatedAt` propagation

## [1.5.1] - 2026-03-31

### Changed

- Pinned all dependencies
- Viewport-constrained height for floating elements via Floating UI size middleware

## [1.5.0] - 2026-03-31

### Changed

- Updated theme palette and aesthetic tweaks

## [1.2.0] - 2026-03-30

### Added

- Project duplication feature with API endpoint, UI dialog, tests, and docs

### Fixed

- Closing task sidebar on route change no longer bounces back to board/project route
- Tab indicator and scroll state now update correctly on tab size changes

## [1.1.0] - 2026-03-30

### Added

- `autoAssignCreator` project setting to auto-assign new tasks to their creator

## [1.0.9] - 2026-03-30

### Fixed

- Centralized My Tasks query keys and fixed DataTable double scrollbar

## [1.0.8] - 2026-03-30

### Fixed

- My Tasks task dialog double scrollbar

## [1.0.7] - 2026-03-29

### Changed

- Split monolithic API handlers and utilities into modular subdirectories
- Added barrel import rule to prevent circular chunk dependencies in build

### Fixed

- Circular dependency issues in build output

## [1.0.6] - 2026-03-29

### Added

- Rate limiting on invitation lookup and acceptance endpoints
- `componentDidCatch` error boundary to force silent refresh after deploy (stale asset hashes)
- Public mirror CI pipeline for private/public repo binding

### Fixed

- UI component error handling, query hooks, and project page refactor
- UserMenu placement on `/workspaces` page
- Delete Tasks no longer produces console errors
- CSP updated for Cloudflare static insights

### Changed

- API error handling, type safety, and parameter validation refactor

## [1.0.4] - 2026-03-29

### Added

- Password reset cooldown and rate limiting

## [1.0.3] - 2026-03-28

### Fixed

- Minor bug fixes

## [1.0.1] - 2026-03-28

### Changed

- Workspace slugs are now unique per-owner (composite index) instead of globally unique

## [1.0.0] - 2026-03-28

Initial public release.

### Pre-1.0 highlights

- **Core platform**: Workspaces, projects, tasks, labels, attachments, teams, invitations
- **Task management**: Kanban board with drag-and-drop, task detail panel, bulk actions, subtasks, comments
- **Project features**: Timeline view, dashboard with stats, budget tracking, project lifecycle (active/completed/archived)
- **Auth**: Better Auth integration with email/password, session management, password hashing
- **API**: 84 endpoints with Hono, rate limiting, HMAC-signed webhooks (23 event types)
- **Performance**: D1 query batching (`db.batch()`), session cookie caching, auth singleton, cache-control middleware
- **Scheduled tasks**: Auth cleanup for expired sessions/tokens, webhook cleanup
- **Notifications**: Real-time notification system with modular components
- **Design system**: Theming, responsive layout, mobile support
- **Database**: 23 tables on Cloudflare D1 with Drizzle ORM
- **Deployment**: Cloudflare Workers
