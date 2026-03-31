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
│   │   ├── auth.ts               # Auth session middleware
│   │   ├── authorize.ts          # Role/permission authorization
│   │   ├── logger.ts             # Request logging
│   │   ├── rate-limit.ts         # Rate limiting
│   │   ├── request-id.ts         # Request ID generation
│   │   ├── require-auth.ts       # Auth requirement enforcement
│   │   ├── security-headers.ts   # Security header middleware
│   │   └── validate.ts           # Request validation middleware
│   ├── lib/                      # Shared API utilities
│   │   ├── auth.ts               # Better Auth factory
│   │   ├── email/                # Email service (Resend + console fallback)
│   │   │   ├── index.ts          # Email service entry point
│   │   │   ├── console.ts        # Console fallback transport
│   │   │   ├── resend.ts         # Resend transport
│   │   │   ├── types.ts          # Email type definitions
│   │   │   └── templates/        # Email templates
│   │   │       ├── email-verification.ts
│   │   │       ├── password-reset.ts
│   │   │       ├── workspace-invitation.ts
│   │   │       └── utils.ts
│   │   ├── access.ts             # Shared project access resolution (resolveProjectAccess)
│   │   ├── storage.ts            # R2 storage helpers (put, get, delete)
│   │   ├── webhooks.ts           # Re-export barrel for webhooks/ sub-modules
│   │   ├── webhooks/             # Webhook internals (split from monolithic webhooks.ts)
│   │   │   ├── delivery.ts       # Webhook dispatch, delivery with exponential-backoff retries, cron-driven retry processing
│   │   │   └── utils.ts          # HMAC-SHA256 signing, SSRF-safe URL validation, secret generation
│   │   └── webhook-payloads.ts   # Webhook payload builders, context fetcher, change detection, fire-and-forget dispatch
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
│   │   └── seed.ts               # Database seeding for integration tests
│   └── routes/                   # Domain-grouped route modules
│       ├── index.ts              # Route aggregator
│       ├── auth/                 # Auth domain
│       │   └── auth.routes.ts
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
│       ├── projects/             # Projects domain
│       │   ├── projects.routes.ts
│       │   └── projects.handlers.ts
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
│       │       ├── subtasks.ts        # Subtask CRUD
│       │       ├── task-crud.ts       # Core task CRUD (create, get, list, update, delete)
│       │       └── task-operations.ts # Task move & duplicate
│       ├── teams/                # Teams domain (UI hidden — feature not yet functionally integrated)
│       │   ├── teams.routes.ts
│       │   └── teams.handlers.ts
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
│           └── workspaces.handlers.ts
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
│       └── webhook.ts            # Webhook event types, event groups, payload envelope interface
│
└── web/                          # Frontend (React SPA)
    ├── App.tsx                   # Root router
    ├── main.tsx                  # React bootstrap
    ├── lib/                      # Utilities & clients
    │   ├── api/                  # API client
    │   │   └── client.ts         # HTTP client for backend requests
    │   └── auth/                 # Auth client
    │       └── auth-client.ts    # Better Auth React client
    ├── util/                     # Shared pure utilities
    │   ├── task-display.ts       # Priority badge/label/sort/border/text-color mappings
    │   ├── date.ts               # Date formatting (formatDueDate, isOverdue, isDueToday, endOfWeek, endOfNextWeek, endOfMonth)
    │   └── role-display.ts       # Role-to-badge-variant mapping (getRoleBadgeVariant)
    ├── hooks/                    # Shared hooks
    │   ├── use-active-section.ts
    │   ├── use-api.ts
    │   ├── use-click-outside.ts
    │   ├── use-debounce.ts
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
    │   ├── use-task-cover.ts    # Task cover image upload, removal, and position-change logic
    │   ├── use-task-editing.ts  # Editable field management (title, description, cost) with dirty-field tracking
    │   ├── use-task-subtasks.ts # Subtask CRUD, DnD reorder, and optimistic updates with rollback
    │   └── use-theme.ts
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
        │   └── components/       # PropertyRow, PropertyEditors, PropertyDisplays, SortableSubtaskRow, attachments
        ├── ThemeEditor/
        │   └── components/       # LivePreview, TokenInputs, helpers, token-constants
        ├── WorkspaceSettings/
        │   └── components/       # Member/team/webhook dialogs, TeamCard, column defs
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
| `lib/` | Utilities & clients | Auth client, API client, helper functions. |

### API Conventions

| Folder | Purpose | Rule |
|---|---|---|
| `routes/{domain}/` | Domain route module | Contains `{domain}.routes.ts` and `{domain}.handlers.ts`. Large handler files may be split into a `handlers/` subdirectory with the original file becoming a re-export barrel (e.g. `tasks/handlers/task-crud.ts`, `dashboard/handlers/workspace-dashboard.ts`). |
| `routes/index.ts` | Route aggregator | Imports and mounts all domain routes. |
| `middleware/` | Shared middleware | Cross-cutting concerns: auth, authorization, logging, rate limiting, validation, security headers. |
| `test-utils/` | Shared API test utilities | Test database setup, fake data factories, database seeding, and HTTP request helpers. |
| `lib/` | Shared utilities | Auth factory, email service, storage helpers, project access resolution (`access.ts`), webhook internals (`webhooks/` subdirectory with delivery and utils modules, re-exported via `webhooks.ts`), and payload builders (`webhook-payloads.ts`). |
| `lib/email/` | Email service | Resend + console transports, with domain-specific templates (verification, password reset, workspace invitation). |
| `scheduled/` | Cron-triggered tasks | Background maintenance (webhook retries, delivery cleanup, auth cleanup, notification cleanup, task activity cleanup, invitation cleanup). Entry point: `index.ts`. |
| `env.ts` | Environment types | Bindings, variables, and Hono env type. |
