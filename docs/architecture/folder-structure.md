# Folder Structure

## Domain-Driven Folder Structure

The project organizes code by **domain** (what it relates to), not by **technical role** (all components together, all hooks together). This keeps related files co-located and makes the codebase navigable as it scales.

### Core Principles

1. **Co-locate by domain, not by type.** A page's components, hooks, and types live inside that page's folder.
2. **Promote to shared only when reused.** A component starts in `pages/Dashboard/components/`. Once a second page needs it, move it to `components/ui/` or `components/layout/`.
3. **Flat until it hurts.** Do not create sub-folders pre-emptively.
4. **Mirror structure between frontend and backend.** Both `api/routes/` and `shared/schemas/` group by domain (e.g., `auth`, `users`, `workspaces`).

### Directory Map

```
src/
├── api/                          # Backend (Hono Worker)
│   ├── index.ts                  # Worker entry point, global middleware
│   ├── env.ts                    # Bindings & env type definitions
│   ├── middleware/               # Shared middleware
│   │   ├── audit-pat.ts          # Audit-ledger row per successful PAT-attributed mutation (post-response)
│   │   ├── auth.ts               # Auth session middleware (PAT bearer token or cookie session)
│   │   ├── authorize.ts          # Workspace/project/task role guards + PAT binding & scope guards
│   │   ├── cache-control.ts      # Per-route Cache-Control (opt-in TTL, and no-store lockdown)
│   │   ├── logger.ts             # Request logging
│   │   ├── rate-limit.ts         # Rate limiting
│   │   ├── request-id.ts         # Request ID generation
│   │   ├── require-auth.ts       # Auth requirement enforcement
│   │   ├── security-headers.ts   # Security header middleware
│   │   ├── telemetry.ts          # Telemetry sink creation + http_request events
│   │   └── validate.ts           # Request validation middleware
│   ├── lib/                      # Shared API utilities
│   │   ├── access.ts             # Shared project/task access resolution (resolveProjectAccess, resolveTaskAccess)
│   │   ├── api-tokens.ts         # PAT minting, hashing, verification, scope & project-scope predicates
│   │   ├── assignee-validation.ts # Assignee reachability (canUserBeAssigned, retainAssignableAssignee)
│   │   ├── audit-log.ts          # Audit-ledger writer (recordPatAuditLog)
│   │   ├── auth.ts               # Better Auth factory
│   │   ├── cover-image.ts        # Shared project/task cover-image upload, apply, delete
│   │   ├── csv.ts                # RFC 4180 CSV serialization with formula-injection hardening
│   │   ├── defer.ts              # Fire-and-forget work via the Workers waitUntil() API
│   │   ├── email/                # Email service (Resend + console fallback)
│   │   │   ├── index.ts          # Email service entry point
│   │   │   ├── from.ts           # resolveEmailFrom + DEFAULT_EMAIL_FROM (sender single source of truth)
│   │   │   ├── console.ts        # Console fallback transport
│   │   │   ├── resend.ts         # Resend transport
│   │   │   ├── types.ts          # Email type definitions
│   │   │   └── templates/        # Email templates
│   │   │       ├── api-token-created.ts
│   │   │       ├── api-token-revoked.ts
│   │   │       ├── api-token-rotated.ts
│   │   │       ├── email-verification.ts
│   │   │       ├── password-reset.ts
│   │   │       ├── webhook-created.ts
│   │   │       ├── workspace-invitation.ts
│   │   │       └── utils.ts
│   │   ├── error-response.ts     # Uniform `{ error, requestId }` responses + throwWithContext
│   │   ├── mentions.ts           # @mention extraction + resolution to project members
│   │   ├── mime-detect.ts        # Magic-byte MIME sniffing for uploads
│   │   ├── notifications.ts      # In-app notification inserts (single + fan-out)
│   │   ├── pagination.ts         # Cursor pagination parsing & clamping
│   │   ├── params.ts             # requireParam route-parameter accessor
│   │   ├── password-reset-cooldown.ts # Per-email cooldown for password reset requests
│   │   ├── password.ts           # PBKDF2 password hashing (+ legacy scrypt verification)
│   │   ├── position-conflict.ts  # Retry helpers for racing fractional-index position writes
│   │   ├── storage.ts            # R2 storage helpers (put, get, delete)
│   │   ├── telemetry/            # Telemetry sinks
│   │   │   ├── index.ts          # createTelemetrySink factory (sink selection)
│   │   │   ├── analytics-engine.ts # Cloudflare Analytics Engine sink
│   │   │   ├── console.ts        # Structured-JSON console sink
│   │   │   ├── noop.ts           # Discard-everything sink
│   │   │   └── types.ts          # TelemetrySink interface & event types
│   │   ├── unsplash.ts           # Unsplash REST API wrapper (search, curated, download tracking)
│   │   ├── validated.ts          # Typed accessor for Hono's validated-data store
│   │   ├── webhooks.ts           # Re-export barrel for webhooks/ sub-modules
│   │   ├── webhooks/             # Webhook internals (split from monolithic webhooks.ts)
│   │   │   ├── delivery.ts       # Webhook dispatch, delivery with exponential-backoff retries, cron-driven retry processing
│   │   │   ├── notify.ts         # Out-of-band security email when a webhook is created
│   │   │   └── utils.ts          # HMAC-SHA256 signing, SSRF-safe URL validation, secret generation
│   │   ├── webhook-payloads.ts   # Webhook payload builders, context fetcher, change detection, fire-and-forget dispatch
│   │   ├── workspace-policy.ts   # loadWorkspacePolicy — the one server read of workspace.policy for an authorization decision
│   │   └── workspace-roles.ts    # Workspace role hierarchy (outranks, mayGrantAdmin) — single source of truth
│   ├── scheduled/                # Cron-triggered background tasks
│   │   ├── index.ts              # handleScheduled entry point (runs every 5 min)
│   │   ├── auth-cleanup.ts       # Expired session + verification token pruning
│   │   ├── invitation-cleanup.ts # Expired invitation pruning (status + grace period)
│   │   ├── notification-cleanup.ts # Old notification pruning (30d read, 90d unread)
│   │   ├── task-activity-cleanup.ts # Activity record pruning (90d TTL + 500/task cap)
│   │   └── webhook-cleanup.ts    # Delivery retention (30-day TTL + 200/webhook cap)
│   ├── test-utils.ts             # Re-export barrel for test-utils/ sub-modules
│   ├── test-utils/               # Shared API test utilities
│   │   ├── db-setup.ts           # Test database setup helpers
│   │   ├── fakes.ts              # Fake data factories for tests
│   │   ├── request-helpers.ts    # HTTP request helpers for tests
│   │   ├── seed.ts               # Database seeding for integration tests
│   │   └── unsplash.ts           # Unsplash cover-payload fixtures & mocks
│   └── routes/                   # Domain-grouped route modules
│       ├── index.ts              # Route aggregator
│       ├── auth/                 # Auth domain
│       │   └── auth.routes.ts
│       ├── calendar/             # Calendar domain (ICS feed + feed-management surface)
│       │   ├── calendar.routes.ts
│       │   └── calendar.handlers.ts
│       ├── config/               # Public client config domain
│       │   └── config.routes.ts
│       ├── dashboard/            # Dashboard domain
│       │   ├── dashboard.routes.ts
│       │   ├── dashboard.handlers.ts  # Re-export barrel for handlers/
│       │   └── handlers/              # Split handler modules
│       │       ├── activity.ts        # Project & workspace activity feeds
│       │       ├── helpers.ts         # Shared cost aggregation & SQL helpers
│       │       ├── my-tasks.ts        # My tasks endpoint
│       │       ├── project-dashboard.ts # Project dashboard stats
│       │       ├── upcoming-tasks.ts  # Upcoming tasks endpoint
│       │       └── workspace-dashboard.ts # Workspace dashboard stats
│       ├── invitations/          # Invitation domain
│       │   ├── invitations.routes.ts
│       │   └── invitations.handlers.ts
│       ├── legal/                # Legal domain (Terms of Service acceptance)
│       │   ├── legal.routes.ts
│       │   └── legal.handlers.ts
│       ├── notifications/        # Notifications domain
│       │   ├── notifications.routes.ts
│       │   └── notifications.handlers.ts
│       ├── projects/             # Projects domain
│       │   ├── projects.routes.ts
│       │   └── projects.handlers.ts
│       ├── search/               # Cross-project search domain
│       │   ├── search.routes.ts
│       │   └── search.handlers.ts
│       ├── task-groups/          # Task groups domain
│       │   ├── task-groups.routes.ts
│       │   └── task-groups.handlers.ts
│       ├── tasks/                # Tasks domain
│       │   ├── tasks.routes.ts
│       │   ├── tasks.handlers.ts      # Re-export barrel for handlers/
│       │   └── handlers/              # Split handler modules
│       │       ├── activity.ts        # Task activity feed
│       │       ├── comments.ts        # Comment CRUD
│       │       ├── completion.ts      # Task complete/uncomplete
│       │       ├── cover-image.ts     # Task cover image upload/delete
│       │       ├── import.ts          # Bulk .ics calendar import (dedupe by sourceUid, atomic D1 batch)
│       │       ├── subtasks.ts        # Subtask CRUD
│       │       ├── task-crud.ts       # Core task CRUD (create, get, list, update, delete)
│       │       └── task-operations.ts # Task move & duplicate
│       ├── teams/                # Teams domain (UI hidden — feature not yet functionally integrated)
│       │   ├── teams.routes.ts
│       │   └── teams.handlers.ts
│       ├── unsplash/             # Unsplash cover-image search domain
│       │   ├── unsplash.routes.ts
│       │   └── unsplash.handlers.ts
│       ├── uploads/              # File upload domain
│       │   ├── uploads.routes.ts
│       │   └── uploads.handlers.ts
│       ├── users/                # Users domain
│       │   ├── users.routes.ts
│       │   └── users.handlers.ts
│       ├── webhooks/             # Webhooks domain (admin/owner only)
│       │   ├── webhooks.routes.ts
│       │   └── webhooks.handlers.ts
│       └── workspaces/           # Workspaces domain
│           ├── workspaces.routes.ts
│           ├── workspaces.handlers.ts
│           ├── api-tokens.routes.ts   # PAT management sub-resource (rejects PAT callers)
│           ├── api-tokens.handlers.ts
│           ├── export.handlers.ts     # Streamed workspace JSON export
│           ├── freshness.handler.ts   # Workspace freshness polling endpoint
│           ├── import.handlers.ts     # Workspace import endpoint (dry-run preview + execute)
│           └── import/                # Import internals
│               ├── parse.ts           # Format sniffing, parsing, document-integrity validation
│               ├── trello.ts          # Trello board JSON → Cadence import shape
│               └── executor.ts        # Preview & write of the parsed document (batched D1 inserts)
│
├── db/                           # Database layer
│   ├── index.ts                  # createDb(d1) factory
│   └── schema/                   # Drizzle schemas grouped by domain
│       ├── index.ts              # Re-exports all schemas
│       ├── auth.ts               # user, session, account, verification
│       ├── invitation.ts         # workspace invitations
│       ├── label.ts              # labels, task-label assignments
│       ├── notification.ts       # notifications
│       ├── project.ts            # projects
│       ├── task.ts               # tasks, subtasks
│       ├── task-attachment.ts    # task attachments
│       ├── team.ts               # teams, team membership (UI hidden — kept for future use)
│       ├── uploads.ts            # upload
│       ├── webhook.ts            # webhooks, webhook deliveries
│       └── workspace.ts          # workspaces, workspace membership
│
├── shared/                       # Shared (frontend + backend)
│   ├── lib/                      # Pure, isomorphic utilities (run identically on Worker + browser)
│   │   ├── fractional-index.ts   # Ordering keys for drag-and-drop positions
│   │   ├── recurrence.ts         # Recurrence-rule parsing & next-occurrence math
│   │   ├── unsplash-display.ts   # Unsplash cover attribution/display helpers
│   │   ├── ics.ts                # RFC 5545 iCalendar generator (calendar export / subscription feed; all-day floating VALUE=DATE events)
│   │   └── ics-parse.ts          # RFC 5545 iCalendar parser (lenient .ics import; date-only, UTC-safe, bad VEVENTs skipped via warnings)
│   ├── schemas/                  # Zod schemas grouped by domain
│   │   ├── index.ts              # Re-exports all schemas
│   │   ├── auth.ts               # Auth validation schemas (login, register, etc.)
│   │   ├── comment.ts            # Comment validation schemas
│   │   ├── invitation.ts         # Invitation validation schemas
│   │   ├── project.ts            # Project validation schemas
│   │   ├── subtask.ts            # Subtask validation schemas
│   │   ├── task-group.ts         # Task group validation schemas
│   │   ├── task.ts               # Task validation schemas
│   │   ├── team.ts               # Team validation schemas
│   │   ├── upload.ts             # Upload validation constants & schemas
│   │   ├── user.ts               # User profile & password schemas
│   │   ├── webhook.ts            # Webhook validation schemas (create, update)
│   │   └── workspace.ts          # Workspace validation schemas (incl. updateMemberRoleSchema)
│   └── types/                    # Shared TypeScript types
│       ├── invitations.ts        # Canonical Invitation interface (shared across frontend consumers)
│       ├── roles.ts              # Role type definitions
│       ├── webhook.ts            # Webhook event types, event groups, payload envelope interface
│       └── workspace-policy.ts   # WorkspacePolicy shape + resolveWorkspacePolicy — single source of truth for the toggle defaults
│
└── web/                          # Frontend (React SPA)
    ├── App.tsx                   # Root router
    ├── main.tsx                  # React bootstrap
    ├── lib/                      # Utilities & clients
    │   ├── api/                  # API client
    │   │   └── client.ts         # HTTP client for backend requests
    │   ├── auth/                 # Auth client & auth-flow helpers
    │   │   ├── auth-client.ts    # Better Auth React client
    │   │   ├── safe-redirect.ts  # safeRedirectPath — normalises `?redirect=` to a same-origin path
    │   │   └── use-guest-session.ts # Session state for guest surfaces (first-resolve loader only)
    │   ├── export-ics.ts         # Client-side project calendar export (.ics download)
    │   ├── freshness-tracker.ts  # Suppresses freshness invalidations caused by the user's own mutations
    │   ├── icon-map.ts           # Icon-name → Lucide component lookup (ICON_MAP, getIconComponent)
    │   ├── poll-interval.ts      # jitteredInterval — randomised refetchInterval, desynchronises pollers
    │   ├── query-client.ts       # React Query client configuration
    │   ├── query-keys.ts         # Canonical React Query key factory
    │   ├── sort-by-position.ts   # Stable fractional-index sort (position, id tiebreaker)
    │   ├── theme-constants.ts    # Theme labels & metadata shared by theme UI
    │   └── view-state.ts         # Pure view-state utilities for Saved Views
    ├── util/                     # Shared pure utilities
    │   ├── task-display.ts       # Priority badge/label/sort/border/text-color mappings
    │   ├── date.ts               # Date formatting & local-time math (formatDueDate, isOverdue, isDueToday, endOfWeek, endOfNextWeek, endOfMonth, startOfMonth, addMonths — month helpers clamp day-of-month and avoid UTC parsing for calendar navigation)
    │   └── role-display.ts       # Role-to-badge-variant mapping (getRoleBadgeVariant)
    ├── hooks/                    # Shared hooks
    │   ├── use-active-section.ts
    │   ├── use-api.ts
    │   ├── use-click-outside.ts
    │   ├── use-debounce.ts
    │   ├── use-dnd-sensors.ts    # Shared dnd-kit sensor set (MouseSensor + TouchSensor + optional KeyboardSensor) for every drag surface
    │   ├── use-document-title.ts
    │   ├── use-file-upload.ts
    │   ├── use-floating.ts
    │   ├── use-focus-trap.ts
    │   ├── use-multi-select.ts   # Multi-select state for task views (board, timeline)
    │   ├── use-mutation.ts
    │   ├── use-project-activity.ts
    │   ├── use-project-dashboard.ts
    │   ├── use-reduced-motion.ts
    │   ├── use-roving-focus.ts
    │   ├── use-task-actions.ts   # Optimistic task mutation handlers (priority, assign, move, due date, delete)
    │   ├── use-task-comment-actions.ts # Comment CRUD mutations + optimistic cache updates (shared between Dialog & Panel)
    │   ├── use-task-cover.ts    # Task cover image upload, removal, and position-change logic
    │   ├── use-task-detail-actions.ts # Task complete/duplicate/delete actions (shared between Dialog & Panel)
    │   ├── use-task-editing.ts  # Editable field management (title, description, cost) with dirty-field tracking
    │   ├── use-task-server-sync.ts # Mirrors the fetched task row into a detail view's local copy (shared between Dialog & Panel)
    │   ├── use-task-subtasks.ts # Subtask CRUD, DnD reorder, and optimistic updates with rollback
    │   ├── use-theme.ts
    │   └── use-workspace-webhooks.ts # Centralised webhook state, queries, mutations for WorkspaceSettings
    ├── contexts/                 # React context providers & query-based state
    │   ├── ProjectContext.tsx     # Active project state & data (context provider)
    │   └── WorkspaceContext.tsx   # Active workspace state & data (React Query cache, no provider)
    ├── components/               # Shared components
    │   ├── ui/                   # Generic UI primitives
    │   │   ├── bulk-actions/     # BulkActionBar sub-components (PriorityDropdown, AssignDropdown, MoveToGroupDropdown)
    │   │   ├── command-palette/  # CommandPalette sub-components (constants, item-renderers)
    │   ├── auth/                 # Auth page wrappers
    │   │   ├── index.ts
    │   │   └── AuthForm.tsx      # Shared auth form scaffold (validation, error handling, success view)
    │   ├── dashboard/            # Shared dashboard widgets
    │   │   ├── ActivityFeed.tsx        # Timeline activity feed with infinite scroll
    │   │   ├── OverdueTasksSection.tsx # Overdue tasks alert banner
    │   │   ├── PriorityBreakdown.tsx   # Priority breakdown bar chart
    │   │   ├── SkeletonPrimitives.tsx  # Parameterized dashboard loading skeletons
    │   │   ├── TaskMetricsCards.tsx     # Core metric cards (active, completed, rate)
    │   │   └── TeamWorkload.tsx        # Team member workload bars
    │   ├── layout/               # App shell & layout components
    │   │   ├── index.ts
    │   │   ├── shared.ts         # Shared layout utilities
    │   │   ├── AuthLayout.tsx
    │   │   ├── AuthenticatedLayout.tsx
    │   │   ├── WorkspaceLayout.tsx
    │   │   ├── ProjectLayout.tsx
    │   │   ├── NotificationBell.tsx
    │   │   ├── NotificationItem.tsx
    │   │   ├── NotificationPanel.tsx
    │   │   ├── UserMenu.tsx
    │   │   ├── workspace/           # Extracted WorkspaceLayout sub-components
    │   │   │   ├── SidebarNav.tsx
    │   │   │   └── WorkspaceSwitcher.tsx
    │   │   ├── Center.tsx
    │   │   ├── Container.tsx
    │   │   ├── Divider.tsx
    │   │   ├── Row.tsx
    │   │   ├── Spacer.tsx
    │   │   └── Stack.tsx
    │   ├── guards/               # Route guards
    │   │   ├── index.ts
    │   │   ├── AuthGuard.tsx
    │   │   ├── GuestGuard.tsx
    │   │   └── WorkspaceGuard.tsx
    │   ├── animation/            # Animation primitives
    │   │   ├── index.ts
    │   │   ├── AnimatePresence.tsx
    │   │   ├── Parallax.tsx
    │   │   ├── ScrollReveal.tsx
    │   │   ├── Stagger.tsx
    │   │   └── ViewTransition.tsx
    │   └── form/                 # Form primitives
    │       ├── index.ts
    │       ├── Checkbox.tsx
    │       ├── Field.tsx
    │       ├── FieldError.tsx
    │       ├── FormActions.tsx
    │       ├── Input.tsx
    │       ├── Label.tsx
    │       ├── Radio.tsx
    │       ├── SearchInput.tsx
    │       ├── Select.tsx
    │       └── Textarea.tsx
    └── pages/                    # Route-level page components
        ├── Dashboard/
        │   └── components/       # StatCards, TaskLists, ProjectsSection, skeletons (ActivityFeed and OverdueAlert moved to shared dashboard/)
        ├── Demo/
        │   └── sections/         # Demo page section components
        ├── ForgotPassword/
        ├── InviteAccept/
        ├── Landing/
        │   └── components/       # HeroSection, FeaturesSection, ProductShowcase, ThemesSection, CtaSection, nav/footer
        ├── Login/
        ├── MyTasks/
        ├── NotFound/
        ├── Notifications/
        │   └── components/       # NotificationActions, NotificationFilters
        ├── ProjectBoard/
        │   └── components/       # BoardColumn, TaskCard, AddTaskForm, AddGroupColumn, dnd-helpers
        ├── ProjectCalendar/
        │   ├── components/       # CalendarGrid, CalendarDayCell, CalendarTaskChip, DayOverflowPopover
        │   └── lib/              # month-grid (Monday-start grid build + greedy span/lane placement)
        ├── ProjectDashboard/
        │   └── components/       # StatCards, TasksByGroup, BudgetSection, UpcomingTasks, skeletons (ActivityFeed and OverdueAlert moved to shared dashboard/)
        ├── ProjectListView/
        ├── ProjectSettings/
        │   └── components/       # GeneralTab, AppearanceTab, MembersTab, TaskGroupsTab
        ├── ProjectTimeline/
        │   └── components/       # TimelineTaskRow, GroupByDropdown, grouping (date-helpers moved to shared util/date.ts)
        ├── Projects/
        │   └── components/       # ProjectCardGrid, RenameProjectDialog
        ├── Register/
        ├── ResetPassword/
        ├── Settings/
        │   └── components/       # ProfileSection, PasswordSection, SessionsSection, DangerZoneSection
        ├── Showcase/
        ├── TaskDetail/
        │   ├── types.ts          # TaskDetail interface (extends Task with subtasks, commentCount, cost, coverImagePosition)
        │   └── components/       # PropertyRow, PropertyEditors, PropertyDisplays, SortableSubtaskRow, TaskCommentSection, TaskDetailProperties, TaskSubtaskList, attachments
        ├── ThemeEditor/
        │   └── components/       # LivePreview, TokenInputs, helpers, token-constants
        ├── WorkspaceSettings/
        │   └── components/       # Member/webhook dialogs, column defs, WebhookListView, WebhookDetailView; team dialogs + TeamCard (UI hidden, unrouted)
        └── Workspaces/
            └── components/       # CreateWorkspaceDialog, PendingInvitations
```

### Web Conventions

| Folder | Purpose | Rule |
|---|---|---|
| `pages/{PageName}/` | Route-level entry point | One folder per route. Folder and file share PascalCase name. |
| `pages/{PageName}/components/` | Page-specific components | Only used by this page. Promote to `components/` if reused. |
| `pages/{PageName}/hooks/` | Page-specific hooks | Custom hooks scoped to this page's logic. |
| `components/ui/` | Generic UI primitives | Button, Input, Modal -- no business logic. |
| `components/auth/` | Auth page wrappers | AuthForm — shared form scaffold used by Login, Register, ForgotPassword, ResetPassword. |
| `components/dashboard/` | Shared dashboard widgets | Components used by both Dashboard and ProjectDashboard (e.g. ActivityFeed, OverdueTasksSection, TaskMetricsCards, SkeletonPrimitives, PriorityBreakdown, TeamWorkload). |
| `components/layout/` | App shell / layout | AuthenticatedLayout, WorkspaceLayout, ProjectLayout, plus layout primitives (Stack, Row, Container, etc.). Domain-scoped sub-components live in named subdirectories (e.g. `workspace/`). |
| `components/guards/` | Route guards | AuthGuard, GuestGuard, WorkspaceGuard. |
| `components/animation/` | Animation primitives | AnimatePresence, ScrollReveal, Stagger, Parallax, ViewTransition. |
| `components/form/` | Form primitives | Field, Input, Select, Checkbox, Radio, Textarea -- reusable form building blocks. |
| `contexts/` | React context providers & query-based state | Domain-scoped state (WorkspaceContext uses React Query cache; ProjectContext uses a context provider). |
| `hooks/` | Shared hooks | Hooks used by 2+ pages. |
| `util/` | Shared pure utilities | Non-React helpers used by 2+ pages (e.g. `task-display.ts`, `date.ts`). |
| `lib/` | Utilities & clients | Auth client, API client, helper functions. `lib/auth/` also holds the auth-flow helpers the guest pages share: `safe-redirect.ts` (normalises a caller-supplied `?redirect=` into a same-origin path before any post-login navigation) and `use-guest-session.ts` (shows the loading state only until the session first resolves, so a background session refetch cannot remount a guest page and discard its post-submit view). |

### API Conventions

| Folder | Purpose | Rule |
|---|---|---|
| `routes/{domain}/` | Domain route module | Contains `{domain}.routes.ts` and `{domain}.handlers.ts`. Large handler files may be split into a `handlers/` subdirectory with the original file becoming a re-export barrel (e.g. `tasks/handlers/task-crud.ts`, `dashboard/handlers/workspace-dashboard.ts`). |
| `routes/index.ts` | Route aggregator | Imports and mounts all domain routes. |
| `middleware/` | Shared middleware | Cross-cutting concerns: auth, authorization (role guards plus the PAT workspace/project binding and scope guards), audit logging, request logging, rate limiting, validation, caching, telemetry, security headers. See [Middleware](../api/middleware.md). |
| `test-utils/` | Shared API test utilities | Test database setup, fake data factories, database seeding, and HTTP request helpers. |
| `lib/` | Shared utilities | Auth factory, email service, storage helpers, project access resolution (`access.ts`), webhook internals (`webhooks/` subdirectory with delivery and utils modules, re-exported via `webhooks.ts`), and payload builders (`webhook-payloads.ts`). Authorization *policy* that more than one route needs also lives here rather than as private handler helpers, so a rule stated once cannot disagree with itself: `workspace-roles.ts` holds the workspace role hierarchy (`outranks`, `mayGrantAdmin`) shared by the member endpoints and the invitation endpoint, `assignee-validation.ts` holds the "an assignee must be able to reach the task's project" rule shared by the task write paths, and `workspace-policy.ts` holds the single server-side read of `workspace.policy` behind an authorization decision, shared by the two routes that create projects. Note the split for that last one: the policy's *shape, defaults and resolver* live in `shared/types/workspace-policy.ts`, which the frontend context and the Zod schemas both type against, while this module holds only the D1 query — putting that in `shared/` would drag a `Database` import into browser code. |
| `lib/email/` | Email service | Resend + console transports, with domain-specific templates (verification, password reset, workspace invitation). Sender resolution lives in its own leaf module `from.ts` — not in the barrel — so the transports can depend on it without importing the barrel back, and so every mail path resolves `From:` the same way. |
| `scheduled/` | Cron-triggered tasks | Background maintenance (webhook retries, delivery cleanup, auth cleanup, notification cleanup, task activity cleanup, invitation cleanup). Entry point: `index.ts`. |
| `env.ts` | Environment types | Bindings, variables, and Hono env type. |
