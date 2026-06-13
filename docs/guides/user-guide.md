# Cadence User Guide

Cadence is a project management app for organizing work with workspaces, projects, kanban boards, and task tracking. This guide covers everything you need to get started and make the most of the platform.

---

## Getting Started

### Creating an Account

Navigate to `/register` and enter your name, email, and password. Password requirements are displayed inline as you type.

### Workspaces

After signing in you'll land on the **Workspaces** page. A workspace is the top-level container for all your projects, teams, and members.

- Click **Create Workspace** to get started
- Give it a name — the URL slug is auto-generated but editable
- Add an optional description

You can belong to multiple workspaces and switch between them from the sidebar dropdown or the workspaces page.

### Navigating the App

Inside a workspace, the left sidebar provides access to:

| Item | Description |
|---|---|
| **Dashboard** | Overview of tasks, activity, and project stats |
| **My Tasks** | Your personally assigned tasks across all projects |
| **Projects** | All projects in the workspace |
| **Notifications** | Updates about task assignments, comments, and invitations |
| **Settings** | Workspace configuration, members, webhooks, and data export/import |

The **command palette** (`Ctrl+K` / `Cmd+K`) provides quick search across projects and tasks, plus navigation shortcuts.

---

## Projects

### Creating a Project

Click **New Project** from the projects page or command palette. Set the name, description, icon, and optionally a budget.

### Views

Each project has five views, accessible from the tab bar:

**Board** — Kanban columns representing task groups (statuses). Drag tasks between columns to change status. Drag columns to reorder them.

**List** — Sortable table with columns for title, status, assignee, due date, and priority. Includes search by task title.

**Timeline** — Tasks grouped by due date buckets (today, this week, next week, later, no date) by default. Use the **Group by** dropdown to switch between grouping by due date, priority, task group, assignee, or label. When grouped by label, a task with multiple labels appears under each of its labels, and tasks with none fall into a trailing "No label" group. The selected grouping mode is persisted in the URL. Completed tasks are hidden by default — use the **Status** filter to view them.

**Calendar** — A month grid (Monday-start) placing each task on its due date; a task with both a start and due date renders as a bar spanning start → due, and a start-only task sits on its start day. Page between months with the arrows or jump back to today; the current month is stored in the URL (`?month=YYYY-MM`) so the view is reload-safe and shareable. Days with more tasks than fit show a "+N more" overflow popover. The same filter bar as the other views applies, so the calendar reflects whatever filters are active.

**Dashboard** — Project-level stats: task counts, completion progress, cost summary, team workload, and activity feed.

### Saved Views

Once you have filters or a grouping set on the Board, List, or Timeline, you can save that arrangement as a named **view** and re-apply it later in one click. Saved views are **private to you** — teammates never see yours, and you never see theirs.

- **Save a view** — With filters active, click **Save view** beside **Clear filters** (shown only before you have any views) or **Save current as view** from the **Views** menu, type a name, and press Enter. You can keep up to 20 views per project.
- **Apply a view** — Open the **Views** pill at the start of the filter bar and pick a view; the board jumps to that view's tab, filters, and grouping. Applying a view updates the URL, so the link is reload-safe and can be shared (recipients who can't see your private view simply get the underlying filters).
- **Clear view** — Done with a view? Open the **Views** menu and choose **Clear view** to release the board back to its default, unfiltered state in one click — it drops both the view and its filters (an open task stays open). This is the "unselect" a list of views can't otherwise express, so you're never stranded in a filtered view.
- **Edited indicator** — When the live filters drift from the applied view, the pill shows "· Edited". From the menu you can **Update** the view to the current filters or **Save as new** to keep both.
- **Rename / delete** — Hover a row in the **Views** menu to reveal rename (pencil) and delete (×) actions. Deleting the view you're currently on just drops the bookmark; your filters stay applied.

### Calendar Export & Import

The calendar menu — the download icon beside the view tabs — moves tasks between Cadence and any `.ics` calendar file. It appears on every view except Settings and Dashboard.

- **Export calendar (.ics)** — Downloads the whole project as a `.ics` file: every task with a date becomes an all-day event — a task with both a start and due date spans start → due, a due-only task sits on its due date, and a start-only task sits on its start date — and the task's description and completed state come along. This exports the **entire project**, not just the currently filtered tasks, and is available to anyone who can see the project. Tasks with no date at all are skipped; if nothing has a date, you're told instead of getting an empty file. For a calendar that stays in sync on its own rather than a one-time snapshot, use a personal **Calendar Feed** from Settings instead (see [Account Settings → Calendar Feed](#account-settings)).
- **Import calendar (.ics)…** — Available to members who can edit tasks. Pick an `.ics` file (up to 1 MB) and Cadence previews the events it found, warns about any it couldn't read, and lets you choose which task group to add them to — up to 500 tasks at once. Re-importing the same file skips events it has already created (matched by each event's unique ID); events without an ID are created again every time.

### Project Settings

Access via the **Settings** tab on a project:

- **General** — Name, description, status (active/archived), budget, auto-assign tasks to creator, and an **Export tasks (CSV)** download. The CSV holds one row per task — title, group, assignee, due date, priority, labels, completion state, and cost — and is available to any project member, including viewers.
- **Members** — Add workspace members with project-specific roles (admin, member, viewer)
- **Task Groups** — Define your workflow columns. Mark a group as a "completion group" to auto-complete tasks moved there. Drag to reorder.
- **Webhooks** — Create and manage webhooks scoped to this project. Project-scoped webhooks only fire for events within the project (task and project events). Workspace and invitation events are not available. Requires the project admin role.
- **Appearance** — Icon (emoji picker), cover image, project theme (visible to workspace admins and project admins)

### Project Lifecycle

Projects have three statuses: **Active**, **Completed**, and **Archived**.

The project list page uses tabs to separate projects by status:

| Tab | Description |
|---|---|
| **Active** | Projects currently in progress (default view) |
| **Completed** | Projects marked as done — can be reopened or archived |
| **Archived** | Inactive projects removed from daily workflows — can be restored |

Use the project card's context menu (three-dot icon) to change status:

- **Active** projects can be marked as completed or archived
- **Completed** projects can be reopened (→ active) or archived
- **Archived** projects can be restored (→ active)

### Duplicating a Project

Use the **Duplicate project** option in the project card's context menu to create a copy of an existing project. The duplicate includes the project's settings, task groups, and labels. Tasks, comments, and attachments are not copied.

A confirmation dialog lets you optionally **include members and their roles**. The duplicated project is set to active status and named `"{original name} (copy)"`. You are automatically added as an admin on the new project and navigated to it after creation.

### Reordering Projects in the Sidebar

Drag and drop projects in the sidebar to reorder them. Hover over a project to reveal the grip handle on the left, then drag to your desired position. The new order is saved automatically and persists across sessions.

The workspace sidebar only shows active projects. Completed and archived projects do not appear in the sidebar, My Tasks, or dashboard statistics — they are accessible from the **Projects** page tabs.

---

## Tasks

### Creating Tasks

On the board view, type in the input field at the bottom of any column and press Enter. The task is created in that column.

### Task Properties

Click a task to open the detail panel:

| Property | Description |
|---|---|
| **Title** | Required. Click to edit inline. |
| **Status** | The task group / kanban column the task belongs to |
| **Priority** | None, Low, Medium, High, Urgent (color-coded) |
| **Assignee** | Any workspace member. Searchable dropdown. |
| **Start Date** | Optional, always shown. Independent of the due date — set it alone (work that begins on a day with no deadline), or alongside a due date to form a range. Must fall on or before the due date when both are set. Clear it with the × beside the field. |
| **Due Date** | Optional, always shown. Date picker with presets: Today, Tomorrow, Next Week. Clear it with the × beside the field — a start date, if set, is left in place. |
| **Labels** | Custom tags for categorization |
| **Cost** | Optional numeric field for budget tracking |
| **Description** | Rich text with `@mention` support |
| **Icon** | Optional emoji icon |
| **Cover Image** | Optional header image with positioning |
| **Recurrence** | Optional repeat schedule (daily, weekly, monthly, yearly) |

### Subtasks

Add subtasks within the detail panel. They support:
- Check off individually
- Drag to reorder
- Double-click to edit inline
- Progress contributes to parent task completion bar

### Comments & Activity

The detail panel shows a combined feed of comments and activity (status changes, assignments, label changes, etc.). Comments support `@mentions` which trigger notifications.

### Attachments

Upload files from the detail panel. Attachments are stored in Cloudflare R2.

### Recurring Tasks

Set a task to repeat on a schedule so the next instance is automatically created when you complete the current one.

**Setting up recurrence:**

Open the task detail panel and click the **Recurrence** property row. The recurrence picker lets you configure:

- **Frequency** — Daily, Weekly, Monthly, or Yearly
- **Interval** — Repeat every N days/weeks/months/years (e.g. every 2 weeks)
- **Day selection (Weekly)** — Pick specific days of the week (e.g. Mon, Wed, Fri)
- **Monthly mode** — By date (e.g. the 15th) or by pattern (e.g. the 2nd Tuesday)
- **End date** — Optional date after which no more instances are created

Changes apply immediately — there is no save button.

**What happens on completion:**

When a recurring task is completed (via checkbox, Mark complete, or drag to a completion column), a new task instance is automatically created with:
- The **next due date** computed from the recurrence rule
- The same title, description, assignee, priority, cost, icon, labels, and subtasks
- Subtask completion is reset on the new instance
- Cover images are not carried over

The new instance appears on the board in the same column as the original task (before it was moved to completion). If the computed next due date falls past the rule's end date, no new instance is created.

**Recurrence indicator:**

Tasks with a recurrence rule display a repeat icon (↻) on their card in the Board and Timeline views.

### Completing Tasks

Four ways to complete a task:
1. Click the checkbox on the task card (Board / Timeline)
2. Use the **Mark complete** button in the detail panel
3. Drag the task to a column marked as a completion group
4. Click the completion checkbox in the **My Tasks** list

### Bulk Actions

Select multiple tasks using checkboxes, then use the bulk action bar to change status, priority, assignee, due date, or delete.

---

## My Tasks

The **My Tasks** page (`/w/{slug}/my-tasks`) shows all tasks assigned to you across every **active** project in the workspace.

Each task row includes a **completion checkbox** on the left. Clicking it marks the task as complete with a fade-out animation and optimistically removes it from the list. If the API call fails, the task reappears and an error toast is shown. Clicking the checkbox does not open the task detail dialog.

Filter by time period:
- **All** — Everything assigned to you
- **Today** — Due today
- **This Week** — Due this week
- **Overdue** — Past due date

Narrow the task list using the filter bar above it. The same controls as the in-project board are available at workspace scope:

- **Project** — narrow to tasks from one or more projects.
- **Task group (column)** — becomes available once at least one project is selected, narrowing to specific columns across the chosen projects.
- **Priority** — narrow to one or more priority levels.
- **Due date** — pick a date range, or toggle **No due date** to surface tasks with no date set. A range and "No due date" combine inclusively (in range **or** no due date).
- **Label** — narrow by one or more labels. Options are deduplicated by name across every active project you can see, so a label appears once even when it exists in several projects. **No label** surfaces tasks with no labels and combines inclusively with any selected labels.

All filters are applied server-side, so counts stay accurate across pagination. Active filters appear as removable chips beneath the controls — including dedicated "No due date" and "No label" chips — and **Clear filters** removes them all at once. Filter selections are persisted in the URL so they survive page reloads and can be shared via link.

---

## Dashboard

The workspace dashboard shows statistics scoped to **active projects only**:

- **Stats** — Active, completed, and total task counts (from active projects)
- **Project Progress** — Per-project completion with progress bars
- **Cost Summary** — Aggregated costs across active projects (if budget tracking is used)
- **Recent Activity** — Timeline of changes across all projects
- **Archived Summary** — Rollup counts for completed and archived projects (project count, total tasks, completed tasks)

The greeting is time-aware ("Good morning", "Good afternoon", "Good evening").

---

## Teams & Members

### Workspace Roles

| Role | Permissions |
|---|---|
| **Owner** | Full access. Manage members, settings, billing. Cannot be removed. |
| **Admin** | Manage members, projects, and settings. Cannot delete workspace. |
| **Member** | Access projects they're added to. Cannot manage workspace settings. |

### Inviting Members

Go to **Settings > Members** and enter an email address with a role. The invitee receives a link that works whether or not they already have an account.

Pending invitations appear on the workspace list page for the invitee, with accept/decline options.

### Project Roles

Projects have separate roles (admin, member, viewer) that can restrict access further. Workspace owners and admins have elevated access to all projects.

### Teams

Create named teams under workspace settings to group members. Useful for organizational purposes and future team-based features.

---

## Exporting & Importing Data

Cadence never holds your data hostage. **Settings > Data** (workspace owners and admins) is the home for moving a whole workspace in and out; per-project CSV export lives on each project's own **Settings** tab. The full reference — the JSON format, exactly what round-trips, and the Trello field mapping — is the [Export & Import guide](./export-import.md).

- **Export workspace (JSON)** — Download a single archive of the entire workspace: every project with its task groups, labels, tasks, subtasks, comments, and attachment *manifests* (the file references attachments by name and link rather than bundling the binaries). An optional toggle includes each task's activity history. Owner/admin only.
- **Import (Cadence JSON or Trello)** — Upload a Cadence export, or a Trello board's JSON export, to add those projects as **new** projects in this workspace; nothing already here is changed. Cadence always shows a preview first — counts, who couldn't be matched (people are matched by email, so unmatched users' tasks come in unassigned), and what is skipped — before you confirm. Each project imports all-or-nothing, so a failure never leaves a half-imported project behind. Owner/admin only, files up to 20 MB.
- **Export tasks (CSV)** — From a project's **Settings**, download a flat spreadsheet with one row per task. Available to any project member, including viewers.

---

## Notifications

Access from the bell icon in the header or **Notifications** in the sidebar.

You'll receive notifications for:
- Task assignments
- Comments mentioning you
- Task completions on tasks you're involved with
- Project membership changes
- Workspace invitations

Filter between **All** and **Unread**. Click a notification to navigate to the relevant task or project. Mark individual notifications or all as read.

---

## Keyboard Shortcuts

Press `?` anywhere to open the shortcuts dialog.

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Open command palette / search |
| `?` | Show keyboard shortcuts |
| `g` then `d` | Go to Dashboard |
| `g` then `m` | Go to My Tasks |
| `g` then `p` | Go to Projects |
| `g` then `s` | Go to Settings |
| `g` then `e` | Go to Members |

Chord shortcuts (two-key sequences like `g` then `d`) have a 1-second timeout between keys. A visual indicator appears when the first key is pressed.

Shortcuts are disabled when typing in text inputs.

---

## Themes

Cadence includes 18 built-in themes:

Minimal, Noir, Botanical, Sunset, Candy, Cyberpunk, Pastel, Brutalist, Ocean, Ember, Luxe, Sakura, Melancholy, Storm, Dreamlike, Terminal, Synthwave, Forest

Set a **workspace theme** in Settings > General — it applies across the entire workspace. Set a **project theme** in Project Settings > Appearance — it overrides the workspace theme while viewing that project.

---

## Webhooks

Webhooks let external systems receive real-time HTTP notifications when events happen in your workspace (task created, member added, etc.).

### Setup

**Workspace webhooks** — Go to **Settings > Webhooks** and click **Create Webhook**:
1. Give it a name
2. Enter your endpoint URL (HTTPS required in production; HTTP allowed in dev mode)
3. Optionally select a **project scope** — when set, the webhook only fires for events from that project. Workspace and invitation events are unavailable for project-scoped webhooks. Only active projects appear in the project selector.
4. Select which events to subscribe to
5. Copy the signing secret — it's only shown once

**Project webhooks** — Go to a project's **Settings > Webhooks** tab. Webhooks created here are automatically scoped to the project. The project scope selector is hidden since it's implied. When a project is archived, its project-scoped webhooks are automatically deleted.

### Verifying Deliveries

Each delivery is signed with HMAC-SHA256. Verify the `X-Webhook-Signature` header against the raw request body using your secret. See the [Webhook Documentation](../api/webhooks.md) for code examples.

### Monitoring

The webhook detail view shows recent deliveries with status codes, response bodies, and retry attempts. Use the **Test** button to send a test ping.

Failed deliveries are retried with exponential backoff (up to 5 attempts over ~2.5 hours). Webhooks are auto-disabled after 10 consecutive failures — re-enable from the settings page.

---

## Account Settings

Access from the user menu or **Settings > Account**:

- **Profile** — Change display name and avatar
- **Password** — Change password (requires current password)
- **Sessions** — View active sessions with browser/OS info. Revoke individual sessions or log out everywhere else.
- **Calendar Feed** — Subscribe to the tasks assigned to you **in the current workspace** from any calendar app. Click **Generate** to mint a personal ICS subscription URL, then add it to Google Calendar, Apple Calendar, or Outlook. The URL is a secret (anyone holding it can see your assigned task titles and dates), so it is shown **only once** at generation time — copy it immediately. If you lose it, **Regenerate** to mint a fresh URL (the old one stops working instantly), or **Revoke** to remove the feed entirely. The feed shows your open tasks plus tasks you completed in the last 30 days; completing a task marks it done in your calendar rather than making it disappear. This section only appears when Settings is opened inside a workspace.
- **Danger Zone** — Permanently delete your account

---

## Search & Command Palette

Open with `Ctrl+K` / `Cmd+K`. Features:

- **Search** — Type to find projects and tasks across the workspace
- **Navigation** — Quick links to Dashboard, My Tasks, Projects, Settings
- **Actions** — Create Project, Toggle Theme
- **Recent** — Recently viewed items
- **Favorites** — Starred projects (toggle with the star icon in the sidebar)

Navigate results with arrow keys, select with Enter, close with Escape.
