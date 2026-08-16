# UI Components

The component library is built from scratch (no third-party UI kit). Every component uses the [design system tokens](../design-system/design-system.md), accepts a `className` prop for overrides via `cn()`, and uses `forwardRef`. No JS animation libraries — CSS only.

## Layout Primitives

Structural components for page composition.

| Component                  | Description                              |
| -------------------------- | ---------------------------------------- |
| [Stack](layout.md#stack)   | Vertical flex layout with responsive gap |
| [Row](layout.md#row)       | Horizontal flex with alignment controls  |
| [Center](layout.md#center) | Centers content on both axes             |
| [Container](layout.md#container) | Max-width wrapper (`sm`/`md`/`lg`/`xl`) |
| [Spacer](layout.md#spacer) | Flex spacer                              |
| [Divider](layout.md#divider) | Horizontal/vertical rule               |
| [AuthenticatedLayout](layout.md#authenticatedlayout) | Pre-configured AppShell for authenticated pages |

[Layout docs →](layout.md)

## Application Shell

| Component                      | Description                                                              |
| ------------------------------ | ------------------------------------------------------------------------ |
| [AppShell](app-shell.md)       | Responsive sidebar + navbar grid layout with mobile drawer               |

The `AppShell` is a compound component (`AppShell.Navbar`, `AppShell.Sidebar`, `AppShell.Main`, etc.) that provides the top-level page structure for authenticated views. See also [`AuthenticatedLayout`](layout.md#authenticatedlayout) which wraps AppShell with sign-out and navigation.

[AppShell docs →](app-shell.md)

## UI Components

General-purpose interactive and display primitives.

| Component                          | Description                                            |
| ---------------------------------- | ------------------------------------------------------ |
| [Button](button.md)                | Variants: primary, secondary, ghost, ghost-inverse, danger, link |
| [IconButton](icon-button.md)       | Square icon-only button                                |
| [Card](card.md)                    | Surface container with padding and shadow              |
| [Text](text.md)                    | Typography primitive with responsive text scaling      |
| [Badge](badge.md)                  | Status/label indicator (success, warning, error, info) |
| [Alert](alert.md)                  | Block-level status message                             |
| [Spinner](spinner.md)              | Loading indicator                                      |
| [Skeleton](skeleton.md)            | Loading placeholder                                    |
| [Avatar](avatar.md)                | User avatar with image/initials fallback               |
| [Dialog](dialog.md)                | Modal overlay using native `<dialog>`                  |
| [CreateProjectDialog](create-project-dialog.md) | Form dialog for creating a new project with name, icon, description, and optional budget/theme |
| [TaskDetailDialog](task-detail-dialog.md) | Full task detail dialog with inline editing, subtasks, and comments |
| [Tabs](tabs.md)                    | Animated tab bar (underline, pill, enclosed)            |
| [Accordion](accordion.md)          | Expand/collapse sections                               |
| [ConfirmDialog](confirm-dialog.md) | Confirmation modal for destructive actions (e.g., delete) |
| [Breadcrumbs](breadcrumbs.md)      | Navigation trail with collapsible overflow             |
| [Pagination](pagination.md)        | Page navigation with numbered buttons or compact view  |
| [EmptyState](empty-state.md)       | Centered placeholder for empty/no-results views        |
| [Toast](toast.md)                  | Toast notifications via `ToastContext` with optional action buttons |
| [ThemeSwitcher](theme-switcher.md) | Theme toggle component                                 |
| [ErrorBoundary](error-boundary.md) | React error boundary with fallback                     |
| QueryErrorRetry                    | Standardized error + retry UI for failed query states  |
| [Portal](portal.md)               | Renders children into a DOM node via `createPortal`    |
| [FileUpload](file-upload.md)      | Drag-and-drop file upload dropzone                     |
| [AvatarUpload](avatar-upload.md)  | Circular avatar upload with optimistic preview         |
| [CoverImagePicker](cover-image-picker.md) | Modal with Upload + Unsplash tabs for selecting a cover image; Unsplash tab gated by `features.unsplash` |
| [Markdown / MarkdownEditor / EditableMarkdown](markdown.md) | Lite-markdown renderer + click-to-edit editor for task descriptions and comments. Renderer emits React elements directly (XSS-safe by construction); `@mention` rendering (formerly `MentionText`) is absorbed here |
| NewProjectButton                   | The **New Project** button with the workspace's `allowMemberProjectCreation` policy already applied. Bundles the three things a refusal has to get right — disabled control, hover explanation, and the same sentence everywhere — so a new surface gets all of them by construction. A UX affordance only — `requireProjectCreation` on the server is what actually refuses |
| BulkActionBar                      | Fixed bottom toolbar for multi-select task actions (priority, assign, move, due date, duplicate, delete) with optimistic updates |
| DueDatePopover                     | Shared date-picker popover for setting task due dates, with optional custom trigger and current-date display |
| CommandPalette                     | Unified search, navigation, favorites, recents, and quick actions overlay (Ctrl+K) |
| KeyboardShortcutsDialog            | Modal listing all keyboard shortcuts, opened with `?`  |
| LabelChip                         | Colored pill displaying a label name with its hex color |
| LabelManagementDialog              | CRUD dialog for managing project labels (create, edit, delete) |
| ImportIcsDialog                    | Dialog to import an `.ics` calendar into a project: client-side parse, event preview (with unreadable-event warnings), target task-group picker, and bulk create (1 MB file cap, 500-task limit, UID dedupe) |
| TaskLabelPicker                    | Popover for assigning/removing labels on a task         |
| TaskAttachmentSection              | File attachment list with drag-and-drop upload, image lightbox, and inline delete for task detail views |
| TaskContextMenuItems               | Shared task context menu fragment (priority, assign, move-to-group, optional move up/down within-column reorder, due date, delete) using DropdownMenu sub-menus. The move up/down items render only when `onMoveUp`/`onMoveDown` are passed (board only — the non-drag reorder fallback) and disable at the column edges via `canMoveUp`/`canMoveDown`. Used by ProjectBoard and ProjectTimeline. |
| RecurrencePicker                   | Popover for configuring a task's recurrence rule (frequency, interval, day-of-week, monthly mode, end date) with auto-apply on change |
| RecurrencePickerReadOnly           | Static display of a recurrence rule (non-interactive variant of RecurrencePicker) |

## Overlay Components

Floating UI components for contextual actions, information, and navigation. Built on `@floating-ui/react` via the shared [`useFloating`](hooks.md#usefloating) hook.

| Component                              | Description                                                       |
| -------------------------------------- | ----------------------------------------------------------------- |
| [Tooltip](tooltip.md)                  | Hover/focus tooltip with configurable delay and placement         |
| [Popover](popover.md)                  | Click-triggered floating dialog panel with focus trapping         |
| [DropdownMenu](dropdown-menu.md)       | Menu with keyboard navigation, typeahead, and ARIA menu pattern   |

## Data Components

Structured data display components for tabular content.

| Component                          | Description                                                               |
| ---------------------------------- | ------------------------------------------------------------------------- |
| [Table](table.md)                  | Low-level compound table primitive with density, striping, and sort icons |
| [DataTable](data-table.md)         | High-level typed table with sorting, selection, pagination, and loading   |

## Display Components

Rich visual components for content presentation.

| Component                      | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| [Hero](hero.md)                | Full-width hero section with background and overlay |
| [MediaCard](media-card.md)     | Image card with overlay and hover effects           |
| [Carousel](carousel.md)        | Horizontal scroll with snap scrolling and arrows    |
| [Swimlane](swimlane.md)        | Title + Carousel (Netflix-style browse row)         |
| [MasonryGrid](masonry-grid.md) | CSS columns-based variable-height grid              |
| [Spotlight](spotlight.md)       | Alternating image + text feature section            |
| [Timeline](timeline.md)        | Vertical timeline with animated nodes               |
| [StatCard](stat-card.md)       | Large number with trend indicator and count-up      |
| [ProgressBar](progress-bar.md) | Animated fill bar with accessible markup            |

## Form Components

Input primitives and form structure.

| Component                          | Description                    |
| ---------------------------------- | ------------------------------ |
| [Field](forms.md#field)            | Label + input + error wrapper  |
| [Label](forms.md#label)            | Form label                     |
| [Input](forms.md#input)            | Text input with focus styling  |
| [Textarea](forms.md#textarea)      | Multi-line input               |
| [Select](forms.md#select)          | Native select dropdown         |
| [Checkbox](forms.md#checkbox)      | Styled checkbox                |
| [Radio](forms.md#radio)            | Styled radio button            |
| [FieldError](forms.md#fielderror)  | Inline validation error        |
| [FormActions](forms.md#formactions) | Button row for form submission |
| [PasswordInput](forms.md#passwordinput) | Password input with visibility toggle (eye/eye-off icon) |
| [PasswordRequirements](forms.md#passwordrequirements) | Real-time password requirements checklist with met/unmet icons |
| [SearchInput](search-input.md)     | Search input with icon, clear button, and Escape-to-clear |

[Form docs →](forms.md)

## Animation Primitives

Behavioral wrappers that control how components appear, move, and transition.

| Component                                       | Description                           |
| ----------------------------------------------- | ------------------------------------- |
| [ScrollReveal](animations.md#scrollreveal)      | Animates children into view on scroll |
| [Stagger](animations.md#stagger)                | Cascading entrance delays for lists   |
| [AnimatePresence](animations.md#animatepresence) | Mount/unmount animation wrapper       |
| [ViewTransition](animations.md#viewtransition)  | Browser View Transitions API wrapper  |
| [Parallax](animations.md#parallax)              | Scroll-linked depth effect            |

[Animation docs →](animations.md)

## Shared Auth Components

Form wrappers shared across authentication pages (Login, Register, ForgotPassword, ResetPassword). These live in `src/web/components/auth/`.

| Component | Description |
| --- | --- |
| AuthForm | Centralized auth page wrapper with Zod validation, optimistic error clearing, success message view, and render-prop children for field-level errors. Accepts `schema`, `onSubmit`, `title`, `description`, `footer`, and `getFormData` props. |

## Shared Dashboard Components

Domain-specific widgets shared between Dashboard and ProjectDashboard pages. These live in `src/web/components/dashboard/`.

| Component | Description |
| --- | --- |
| ActivityFeed | Timeline-style activity feed with infinite scroll, avatar display, relative timestamps, and a load-more button. Accepts pre-processed `ActivityFeedRow[]` with formatted messages and an optional `renderExtra` callback for context (e.g., project name). |
| OverdueTasksSection | Alert banner listing overdue tasks with priority badges, assignee avatars, and relative due-date formatting. Accepts an optional `renderContext` callback for additional info per task (e.g., project name). |
| SkeletonPrimitives | Parameterized loading placeholders for dashboard cards: `SkeletonStatGrid`, `SkeletonBreakdownCard`, `SkeletonBarListCard`, `SkeletonListCard`, and `SkeletonActivityFeed`. |
| TaskMetricsCards | Three core metric cards (Active Tasks, Completed, Completion Rate) with animated counters. Supports `extraCards` slot for dashboard-specific additions and a `gridClassName` override. |
| PriorityBreakdownSection | Horizontal bar chart showing task count per priority level (urgent, high, medium, low, none) with proportional colored bars |
| TeamWorkloadSection | Sorted list of team members with avatar, task count, and progress bar showing relative workload |

## Shared Utilities

Pure functions and constants shared across multiple page components. These live in `src/web/util/` and contain no React dependencies.

| Module | Description |
| --- | --- |
| [`task-display`](../../src/web/util/task-display.ts) | Priority badge variant mapping (`PRIORITY_BADGE_VARIANT`), human-readable labels (`PRIORITY_LABEL`), sort ordering (`PRIORITY_SORT_ORDER`), select options list (`PRIORITY_OPTIONS`), dot color classes (`PRIORITY_DOT_CLASS`), left-border classes (`PRIORITY_BORDER_CLASS`), text color classes (`PRIORITY_TEXT_CLASS`), helper functions `getPriorityBadgeVariant()` / `getPriorityLabel()`, and a `TASK_GROUP_COLORS` palette array (8 colors used for task-group visual indicators on the board). |
| [`date`](../../src/web/util/date.ts) | Date display utilities: `formatDueDate()` (relative labels like "Today", "Tomorrow", "2d overdue"), `isOverdue()`, `isDueToday()`, `startOfDay()`, and date-boundary helpers `endOfWeek()`, `endOfNextWeek()`, `endOfMonth()` for due-date quick-pick options. |
| [`format`](../../src/web/util/format.ts) | Value formatting utilities: `formatBytes()` (human-readable file sizes) and `formatCurrency()` (cents to dollar string like "$1,234" using `Intl.NumberFormat`). Used by Dashboard, ProjectDashboard, and attachment components. |
| [`role-display`](../../src/web/util/role-display.ts) | `getRoleBadgeVariant(role)` — maps workspace/project roles to badge variants (owner→success, admin→info, member/viewer→default). Single source of truth for role badge styling. |
| [`array`](../../src/web/util/array.ts) | `toggleArrayValue(values, value)` — immutable XOR toggle (present→removed, absent→appended) shared by every multi-select filter surface (filter popovers, click-to-filter task-card chips, list-view cells). A second click undoes a selection instead of duplicating it into the URL (`assignee=u1,u1`), and removal preserves the rest so toggles compose across surfaces. |

## Shared Hooks

Hooks shared across multiple UI components.

| Hook                                                      | Description                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| [useFloating](hooks.md#usefloating)                       | `@floating-ui/react` wrapper with project defaults             |
| [useClickOutside](hooks.md#useclickoutside)               | Fires a callback on mouse/touch events outside an element      |
| [useFocusTrap](hooks.md#usefocustrap)                     | Traps Tab/Shift+Tab within a container                         |
| [useRovingFocus](hooks.md#userovingfocus)                 | Roving tabindex keyboard navigation                            |
| [useDndSensors](hooks.md#usedndsensors)                   | Single-source dnd-kit sensor set (MouseSensor + TouchSensor + optional KeyboardSensor) shared by board, sidebar, and subtask drag surfaces; touch uses press-and-hold so a finger can both scroll and reorder |
| [useFileUpload](hooks.md#usefileupload)                   | File upload state management with validation                   |
| [useDocumentTitle](hooks.md#usedocumenttitle)             | Sets document title with app name suffix, restores on unmount  |
| [useForceDefaultTheme](hooks.md#useforcedefaulttheme)     | Forces default theme on mount, restores on unmount (Landing, AuthLayout) |
| [usePrefersReducedMotion](hooks.md#useprefersreducedmotion) | Reactively tracks `prefers-reduced-motion` media query       |
| [useApi](hooks.md#useapi)                                 | GET data-fetching with loading/error state and refetch         |
| [useTheme](hooks.md#usetheme)                             | Read and switch the active theme, persisted to localStorage    |
| [useDebounce](hooks.md#usedebounce)                       | Debounces a value with a configurable delay                    |
| [useDeferredDelete](hooks.md#usedeferreddelete)           | Deferred deletion with undo support (5s window)                |
| [useHotkey](hooks.md#usehotkey)                           | Global keyboard shortcut registration                          |
| [useHotkeyChord](hooks.md#usehotkeychord)                 | Two-key chord shortcuts (e.g. `g` then `d`)                    |
| [useChordIndicator](hooks.md#usechordindicator)           | Subscribes to active chord prefix for UI feedback              |
| [useRecents](hooks.md#userecents)                         | Recent items tracking per workspace, persisted to localStorage |
| [useFavorites](hooks.md#usefavorites)                     | Favorite project toggling per workspace, persisted to localStorage |
| [useFieldErrors](hooks.md#usefielderrors)                 | Per-field Zod validation error management for forms                |
| [useTaskComments](hooks.md#usetaskcomments)               | Cursor-paginated comment fetching for task detail views             |
| [useLabels](hooks.md#uselabels)                           | React Query hooks for project label CRUD and task label assignment  |
| [useSavedViews](hooks.md#usesavedviews)                   | React Query hooks for per-user saved-view CRUD (board tab + filter snapshots); list-only cache, no freshness signaling |
| [useTaskAttachments](hooks.md#usetaskattachments)         | Task attachment fetching with optimistic add/remove cache helpers   |
| [useProjectDashboard](hooks.md#useprojectdashboard)       | Project dashboard data fetching (task counts, groups, members, overdue, priority breakdown) |
| [useProjectActivity](hooks.md#useprojectactivity)         | Infinite-scroll activity feed across all tasks in a project        |
| [useMultiSelect](hooks.md#usemultiselect)                 | Multi-select state management for task views with Escape-to-clear and optional event preventDefault |
| [useTaskActions](hooks.md#usetaskactions)                  | Centralized optimistic-update handlers for task mutations (priority, assignee, move, due date, delete) with rollback |
| [useProjectCover](hooks.md#useprojectcover)                | Project cover upload, Unsplash apply, remove, and URL/attribution derivation with XOR invariant |
| [useTaskCover](hooks.md#usetaskcover)                      | Task cover upload, Unsplash apply, remove, and position-change logic with XOR invariant |
| [useFeatures](hooks.md#usefeatures)                        | Fetches server-side feature flags from `/api/config` (e.g. `features.unsplash`) with aggressive caching |
| [useUnsplashSearch](hooks.md#useunsplashsearch)            | Infinite-query wrapper for the Unsplash cover picker (curated ↔ search switch, no retry on 429/503) |
| [useTaskEditing](hooks.md#usetaskediting)                  | Editable field management (title, description, cost) with dirty-field tracking to prevent server clobbering |
| useMentionAutocomplete                                     | Shared `@mention` autocomplete for a `<textarea>` (caret-mirror dropdown positioning, keyboard nav, `@"Name"` quoting). Single source consumed by `MarkdownEditor` (task descriptions + comment composer/edit form) |
| [useTaskSubtasks](hooks.md#usetasksubtasks)                | Subtask CRUD, DnD reorder, and optimistic updates with rollback for the task detail panel |
| [useTaskCommentActions](hooks.md#usetaskcommentactions)    | Comment CRUD mutations + optimistic cache updates, shared between TaskDetailDialog and TaskDetailPanelInner |
| [useTaskDetailActions](hooks.md#usetaskdetailactions)      | Task complete/duplicate/delete actions with delete dialog state, shared between TaskDetailDialog and TaskDetailPanelInner |
| [useTaskServerSync](hooks.md#usetaskserversync)            | Adopts the fetched task row wholesale into a detail view's local copy, keeping an open Dialog/Panel live as collaborators edit |
| [useWorkspaceWebhooks](hooks.md#useworkspacewebhooks)      | Centralised state, queries, mutations, and handlers for the workspace webhooks settings page |
| [useWorkspaceProjects](hooks.md#useworkspaceprojects)      | Fetches the projects in a workspace the current user can see (visibility-scoped) |
| [useWorkspaceTaskGroups](hooks.md#useworkspacetaskgroups)  | Fetches task groups across a set of projects in a workspace, for workspace-level column filters |
| [useWorkspaceLabels](hooks.md#useworkspacelabels)          | Fetches workspace-wide labels deduplicated by name across active projects, for the My Tasks label filter |

[Hooks docs →](hooks.md)
