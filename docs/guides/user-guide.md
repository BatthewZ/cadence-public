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
| **Settings** | Workspace configuration, members, and webhooks |

The **command palette** (`Ctrl+K` / `Cmd+K`) provides quick search across projects and tasks, plus navigation shortcuts.

---

## Projects

### Creating a Project

Click **New Project** from the projects page or command palette. Set the name, description, icon, and optionally a budget.

### Views

Each project has four views, accessible from the tab bar:

**Board** — Kanban columns representing task groups (statuses). Drag tasks between columns to change status. Drag columns to reorder them.

**List** — Sortable table with columns for title, status, assignee, due date, and priority. Includes search by task title.

**Timeline** — Tasks grouped by due date buckets (today, this week, next week, later, no date).

**Dashboard** — Project-level stats: task counts, completion progress, cost summary, team workload, and activity feed.

### Project Settings

Access via the **Settings** tab on a project:

- **General** — Name, description, status (active/archived), budget
- **Appearance** — Icon (emoji picker), cover image, project theme
- **Task Groups** — Define your workflow columns. Mark a group as a "completion group" to auto-complete tasks moved there. Drag to reorder.
- **Members** — Add workspace members with project-specific roles (admin, member, viewer)

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
| **Due Date** | Date picker with presets: Today, Tomorrow, Next Week |
| **Labels** | Custom tags for categorization |
| **Cost** | Optional numeric field for budget tracking |
| **Description** | Rich text with `@mention` support |
| **Icon** | Optional emoji icon |
| **Cover Image** | Optional header image with positioning |

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

Cadence includes 14 built-in themes:

Minimal, Noir, Botanical, Sunset, Candy, Cyberpunk, Pastel, Brutalist, Chalk, Ocean, Ember, Luxe, Deco, Sakura

Set a **workspace theme** in Settings > General — it applies across the entire workspace. Set a **project theme** in Project Settings > Appearance — it overrides the workspace theme while viewing that project.

---

## Webhooks

Webhooks let external systems receive real-time HTTP notifications when events happen in your workspace (task created, member added, etc.).

### Setup

Go to **Settings > Webhooks** and click **Create Webhook**:
1. Give it a name
2. Enter your endpoint URL (HTTPS required in production; HTTP allowed in dev mode)
3. Select which events to subscribe to
4. Copy the signing secret — it's only shown once

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
