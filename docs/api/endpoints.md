# Endpoints

## Available Endpoints

### `GET /api/health`

Health check endpoint. No authentication required.

**Response**:

```json
{ "ok": true }
```

### `POST /api/auth/**` and `GET /api/auth/**`

All Better Auth endpoints are delegated to the Better Auth handler. These include:

- `POST /api/auth/sign-in/email` -- sign in with email/password
- `POST /api/auth/sign-up/email` -- register with email/password
- `POST /api/auth/sign-out` -- sign out (clear session)
- `GET /api/auth/session` -- get current session
- `POST /api/auth/forget-password` -- request password reset
- `POST /api/auth/reset-password` -- reset password with token
- `POST /api/auth/change-password` -- change password (authenticated)
- `GET /api/auth/list-sessions` -- list active sessions
- `POST /api/auth/revoke-session` -- revoke a specific session
- `POST /api/auth/revoke-other-sessions` -- revoke all other sessions
- `POST /api/auth/delete-user` -- delete account

See the [Better Auth documentation](https://www.better-auth.com/docs) for the full list of supported endpoints.

### `GET /api/me`

Returns the authenticated user's data. Requires authentication (uses `requireAuth` middleware).

**Response** (200):

```json
{
  "user": {
    "id": "abc123",
    "name": "John Doe",
    "email": "john@example.com",
    "emailVerified": false,
    "image": null,
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

**Response** (401, unauthenticated):

```json
{ "error": "Unauthorized" }
```

### `PUT /api/users/me/avatar`

Uploads a user avatar image. Requires authentication. Rate-limited to 10 requests per minute.

**Request:** `multipart/form-data` with a `file` field (JPEG, PNG, GIF, or WebP, max 2 MB).

**Response** (200):

```json
{
  "upload": {
    "id": "abc123",
    "url": "/api/uploads/avatar/userId/uuid.jpg",
    "filename": "photo.jpg",
    "mimeType": "image/jpeg",
    "size": 102400
  }
}
```

See [File Storage](./storage.md) for full details and error responses.

### `GET /api/uploads/:purpose/:userId/:filename`

Serves a stored file from R2. No authentication required. Responses are cached with `Cache-Control: public, max-age=31536000, immutable`.

### `DELETE /api/uploads/:id`

Deletes an upload. Requires authentication. Only the file owner can delete.

**Response** (200):

```json
{ "ok": true }
```

---

## Workspaces

### `POST /api/workspaces`

Creates a new workspace. The authenticated user is automatically added as the workspace owner.

**Auth:** Required.
**Authorization:** Any authenticated user.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--100 characters | Yes |
| `slug` | `string` | 2--50 characters, lowercase alphanumeric and hyphens only (`^[a-z0-9-]+$`) | Yes |
| `description` | `string` | max 500 characters | No |

**Response** (201):

```json
{
  "workspace": {
    "id": "uuid",
    "name": "My Workspace",
    "slug": "my-workspace",
    "description": null,
    "ownerId": "userId",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Errors:** 409 (slug already exists for this owner).

### `GET /api/workspaces`

Lists all workspaces the authenticated user is a member of, including their role and member count in each.

**Auth:** Required.
**Authorization:** Any authenticated user.

**Response** (200):

```json
{
  "workspaces": [
    {
      "id": "uuid",
      "name": "My Workspace",
      "slug": "my-workspace",
      "description": null,
      "ownerId": "userId",
      "createdAt": "...",
      "updatedAt": "...",
      "role": "owner",
      "memberCount": 5
    }
  ]
}
```

### `GET /api/workspaces/:workspaceId`

Returns a single workspace by ID, including a member count.

**Auth:** Required.
**Authorization:** Workspace member.

**Response** (200):

```json
{
  "workspace": {
    "id": "uuid",
    "name": "My Workspace",
    "slug": "my-workspace",
    "description": null,
    "ownerId": "userId",
    "createdAt": "...",
    "updatedAt": "...",
    "memberCount": 5
  }
}
```

### `PATCH /api/workspaces/:workspaceId`

Updates workspace details.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Request body (all fields optional):**

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | `string` | 1--100 characters |
| `slug` | `string` | 2--50 characters, lowercase alphanumeric and hyphens only |
| `description` | `string \| null` | max 500 characters |

**Response** (200):

```json
{ "workspace": { "id": "...", "name": "...", "slug": "...", "..." } }
```

**Errors:** 409 (slug already exists for this owner).

### `DELETE /api/workspaces/:workspaceId`

Deletes a workspace and all associated data.

**Auth:** Required.
**Authorization:** Workspace owner only.

**Response** (200):

```json
{ "ok": true }
```

### `GET /api/workspaces/:workspaceId/members`

Lists all members of a workspace with their user profile data.

**Auth:** Required.
**Authorization:** Workspace member.

**Response** (200):

```json
{
  "members": [
    {
      "id": "memberId",
      "userId": "userId",
      "role": "owner",
      "joinedAt": "...",
      "user": {
        "id": "userId",
        "name": "John Doe",
        "email": "john@example.com",
        "image": null
      }
    }
  ]
}
```

### `PATCH /api/workspaces/:workspaceId/members/:userId`

Updates the role of a workspace member. Cannot change the owner's role.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Request body** (validated via `updateMemberRoleSchema` from `src/shared/schemas/workspace.ts`):

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `role` | `string` | `z.enum(["admin", "member"])` | Yes |

**Response** (200):

```json
{ "member": { "id": "...", "workspaceId": "...", "userId": "...", "role": "admin", "..." } }
```

### `DELETE /api/workspaces/:workspaceId/members/:userId`

Removes a member from the workspace. Cannot remove the workspace owner.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{ "ok": true }
```

---

## Projects

### `POST /api/workspaces/:workspaceId/projects`

Creates a new project within a workspace. The creator is automatically added as a project admin. Three default task groups ("To Do", "In Progress", "Done") are created, with "Done" marked as the completion group (`isCompletionGroup: true`).

**Auth:** Required.
**Authorization:** Workspace member.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--100 characters | Yes |
| `description` | `string` | max 1000 characters | No |
| `icon` | `string \| null` | max 50 characters | No |
| `status` | `string` | One of `PROJECT_STATUSES` enum values | No (defaults to `"active"`) |
| `budget` | `number \| null` | Integer >= 0 (cents) | No (defaults to `null`) |
| `theme` | `string \| null` | One of `THEMES` enum values | No (defaults to `null`) |
| `autoAssignCreator` | `boolean` | | No (defaults to `false`) |

**Response** (201):

```json
{
  "project": {
    "id": "uuid",
    "workspaceId": "workspaceId",
    "name": "My Project",
    "description": null,
    "status": "active",
    "icon": null,
    "budget": null,
    "theme": null,
    "autoAssignCreator": false,
    "coverImageKey": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### `GET /api/workspaces/:workspaceId/projects`

Lists all projects in a workspace, enriched with member and task group counts.

**Auth:** Required.
**Authorization:** Workspace member.

**Response** (200):

```json
{
  "projects": [
    {
      "id": "uuid",
      "workspaceId": "workspaceId",
      "name": "My Project",
      "description": null,
      "status": "active",
      "createdAt": "...",
      "updatedAt": "...",
      "memberCount": 3,
      "taskGroupCount": 3
    }
  ]
}
```

### `GET /api/projects/:projectId`

Returns a single project by ID.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Response** (200):

```json
{ "project": { "id": "...", "workspaceId": "...", "name": "...", "..." } }
```

### `PATCH /api/projects/:projectId`

Updates project details.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Request body (all fields optional):**

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | `string` | 1--100 characters |
| `description` | `string \| null` | max 1000 characters |
| `status` | `string` | `"active"`, `"archived"`, or `"completed"` |
| `icon` | `string \| null` | max 50 characters |
| `coverImageKey` | `string \| null` | R2 object key for cover image |
| `coverImagePosition` | `number \| null` | 0–100, vertical position of cover image |
| `theme` | `string \| null` | One of the supported theme names |
| `budget` | `number \| null` | Project budget in cents (integer, >= 0) |
| `autoAssignCreator` | `boolean` | Auto-assign new tasks to their creator |

**Response** (200):

```json
{ "project": { "id": "...", "name": "...", "status": "...", "icon": "...", "coverImageKey": "...", "budget": 50000, "..." } }
```

### `DELETE /api/projects/:projectId`

Deletes a project and all associated data.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Response** (200):

```json
{ "ok": true }
```

### `POST /api/projects/:projectId/duplicate`

Duplicates a project, creating a new copy with the name `"{original name} (copy)"`. Copies the project's settings (description, icon, budget, theme, autoAssignCreator), task groups (with positions and colors), and labels. Optionally includes members and their roles. Tasks, comments, attachments, and cover images are not copied. The duplicating user is always added as an admin on the new project.

**Auth:** Required.
**Authorization:** Project admin or member.

**Request body** (JSON, validated via `duplicateProjectSchema`):

| Field | Type | Description | Required |
| --- | --- | --- | --- |
| `includeMembers` | `boolean` | Whether to copy project members and their roles | No (defaults to `false`) |

**Behavior:**
1. Batch-reads the source project, task groups, labels, and members in one round-trip.
2. Creates a new project with copied settings and status set to `"active"`.
3. Copies all task groups with their positions, colors, and completion-group flags.
4. Copies all labels with their names and colors.
5. If `includeMembers` is `true`, copies all members with their roles (the duplicating user is always admin regardless).
6. Writes all records in an atomic batch operation.
7. Fires a `project.created` webhook event.

**Response** (201):

```json
{
  "project": {
    "id": "new-uuid",
    "workspaceId": "...",
    "name": "Original Name (copy)",
    "description": "...",
    "icon": "...",
    "status": "active",
    "budget": 50000,
    "theme": "...",
    "autoAssignCreator": false,
    "coverImageKey": null,
    "coverImagePosition": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project admin or member |
| 404 | Source project not found |

### `PUT /api/projects/:projectId/cover`

Uploads a cover image for a project. Replaces any existing cover. Rate-limited to 10 requests per minute.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Request:** `multipart/form-data` with a `file` field (JPEG, PNG, GIF, or WebP, max 5 MB).

**Behavior:**
1. Validates the file type and size.
2. Looks up the project's previous cover image (if any) but does not delete it yet.
3. Uploads the new file to R2 under `project-cover/{userId}/{uuid}{ext}`. If the R2 upload fails, the old cover remains intact.
4. Creates a record in the `upload` table and sets the project's `coverImageKey` to the new R2 key. If either DB write fails, the orphaned R2 object and any partial upload record are cleaned up before returning 500.
5. Deletes the old cover from R2 and the database only after the new one is fully saved.

**Response** (200):

```json
{
  "upload": {
    "id": "abc123",
    "url": "/api/uploads/project-cover/userId/uuid.jpg",
    "filename": "cover.jpg",
    "mimeType": "image/jpeg",
    "size": 204800
  }
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 400 | No file provided, invalid file type, or file too large |
| 401 | Not authenticated |
| 403 | Not a project admin |
| 404 | Project not found |
| 429 | Rate limit exceeded |
| 500 | R2 upload failed or database write failed (with automatic cleanup) |
| 503 | R2 storage binding not configured |

### `DELETE /api/projects/:projectId/cover`

Removes the cover image from a project. Idempotent -- returns success even if no cover exists.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Response** (200):

```json
{ "ok": true }
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project admin |
| 404 | Project not found |
| 503 | R2 storage binding not configured |

### `GET /api/projects/:projectId/members`

Lists all members of a project with their user profile data.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Response** (200):

```json
{
  "members": [
    {
      "id": "memberId",
      "projectId": "projectId",
      "userId": "userId",
      "role": "admin",
      "addedAt": "...",
      "user": {
        "id": "userId",
        "name": "John Doe",
        "email": "john@example.com",
        "image": null
      }
    }
  ]
}
```

### `POST /api/projects/:projectId/members`

Adds a workspace member to the project. The target user must already be a member of the parent workspace.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `userId` | `string` | non-empty | Yes |
| `role` | `string` | `z.enum(["admin", "member", "viewer"])` via `addProjectMemberSchema` | Yes |

**Response** (201):

```json
{ "member": { "id": "...", "projectId": "...", "userId": "...", "role": "member", "addedAt": "..." } }
```

### `DELETE /api/projects/:projectId/members/:userId`

Removes a member from the project.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Response** (200):

```json
{ "ok": true }
```

---

## Labels

### `POST /api/projects/:projectId/labels`

Creates a new label within a project. Maximum 50 labels per project. Label names must be unique within a project (case-insensitive).

**Auth:** Required.
**Authorization:** Project admin or member.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--30 characters, trimmed | Yes |
| `color` | `string` | Hex color (`#rrggbb`) | Yes |

**Response** (201):

```json
{
  "label": {
    "id": "uuid",
    "projectId": "projectId",
    "name": "Bug",
    "color": "#ef4444",
    "createdAt": "..."
  }
}
```

**Errors:** 400 (max labels reached), 409 (duplicate name).

### `GET /api/projects/:projectId/labels`

Lists all labels for a project, ordered by name. Each label includes a `taskCount` of how many tasks use it.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Response** (200):

```json
{
  "labels": [
    {
      "id": "uuid",
      "projectId": "projectId",
      "name": "Bug",
      "color": "#ef4444",
      "createdAt": "...",
      "taskCount": 5
    }
  ]
}
```

### `PATCH /api/projects/:projectId/labels/:labelId`

Updates a label's name and/or color.

**Auth:** Required.
**Authorization:** Project admin or member.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--30 characters, trimmed | No |
| `color` | `string` | Hex color (`#rrggbb`) | No |

**Response** (200):

```json
{
  "label": {
    "id": "uuid",
    "projectId": "projectId",
    "name": "Feature",
    "color": "#22c55e",
    "createdAt": "..."
  }
}
```

**Errors:** 404 (not found), 409 (duplicate name).

### `DELETE /api/projects/:projectId/labels/:labelId`

Deletes a label. All task-label assignments are cascaded.

**Auth:** Required.
**Authorization:** Project admin.

**Response** (200):

```json
{ "ok": true, "deletedId": "labelId" }
```

**Errors:** 404 (not found).

---

## Task Labels

### `POST /api/tasks/:taskId/labels`

Assigns a label to a task. The label must belong to the same project as the task. Maximum 10 labels per task. Idempotent — assigning an already-assigned label returns 200.

**Auth:** Required.
**Authorization:** Project admin or member.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `labelId` | `string` | Non-empty string | Yes |

**Response** (201):

```json
{ "ok": true }
```

**Errors:** 400 (max labels or cross-project), 404 (task or label not found).

### `DELETE /api/tasks/:taskId/labels/:labelId`

Removes a label from a task. Logs a `label_removed` activity entry.

**Auth:** Required.
**Authorization:** Project admin or member.

**Response** (200):

```json
{ "ok": true }
```

**Errors:** 404 (assignment not found).

---

## Task Groups

### `POST /api/projects/:projectId/task-groups`

Creates a new task group within a project. Position is automatically assigned at the end.

**Auth:** Required.
**Authorization:** Project admin or member.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--100 characters | Yes |
| `color` | `string` | Valid hex color (`^#[0-9a-fA-F]{6}$`) | No |

**Response** (201):

```json
{
  "taskGroup": {
    "id": "uuid",
    "projectId": "projectId",
    "name": "Backlog",
    "color": "#ff5733",
    "position": "a3",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### `GET /api/projects/:projectId/task-groups`

Lists all task groups in a project, ordered by position. Includes a task count per group.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Response** (200):

```json
{
  "taskGroups": [
    {
      "id": "uuid",
      "projectId": "projectId",
      "name": "To Do",
      "color": null,
      "position": "a0",
      "createdAt": "...",
      "updatedAt": "...",
      "taskCount": 5
    }
  ]
}
```

### `PATCH /api/task-groups/:taskGroupId`

Updates a task group's name, color, or completion-group flag. Access is checked inline by resolving the parent project.

**Auth:** Required.
**Authorization:** Project admin or member (via inline check).

**Request body (all fields optional):**

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | `string` | 1--100 characters |
| `color` | `string \| null` | Valid hex color (`^#[0-9a-fA-F]{6}$`) |
| `isCompletionGroup` | `boolean` | Tasks moved into this group are auto-completed |

**Response** (200):

```json
{ "taskGroup": { "id": "...", "name": "...", "color": "...", "..." } }
```

### `DELETE /api/task-groups/:taskGroupId`

Deletes a task group. All tasks in the group are reassigned to the target group.

**Auth:** Required.
**Authorization:** Project admin (via inline check).

**Query parameters:**

| Param | Type | Constraints | Required |
|-------|------|-------------|----------|
| `targetGroupId` | `string` | Must be a different group in the same project | Yes |

**Response** (200):

```json
{ "ok": true }
```

### `PATCH /api/task-groups/:taskGroupId/reorder`

Updates the position of a task group for drag-and-drop reordering.

**Auth:** Required.
**Authorization:** Project admin or member (via inline check).

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `position` | `string` | non-empty fractional index | Yes |

**Response** (200):

```json
{ "taskGroup": { "id": "...", "position": "...", "..." } }
```

---

## Tasks

### `POST /api/projects/:projectId/tasks`

Creates a new task within a project. The task is placed at the end of the specified task group. If the project has `autoAssignCreator` enabled and no `assigneeId` is provided, the task is automatically assigned to the authenticated user.

**Auth:** Required.
**Authorization:** Project admin or member.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `title` | `string` | 1--200 characters | Yes |
| `description` | `string` | max 5000 characters | No |
| `taskGroupId` | `string` | UUID, must belong to the project | Yes |
| `assigneeId` | `string \| null` | UUID | No |
| `priority` | `string` | `"urgent"`, `"high"`, `"medium"`, `"low"`, or `"none"` (default: `"none"`) | No |
| `dueDate` | `string \| null` | ISO 8601 datetime | No |
| `cost` | `integer \| null` | Non-negative integer (cents) | No |
| `icon` | `string \| null` | max 50 characters | No |

**Response** (201):

```json
{
  "task": {
    "id": "uuid",
    "projectId": "projectId",
    "taskGroupId": "taskGroupId",
    "title": "Implement login page",
    "description": null,
    "assigneeId": null,
    "priority": "none",
    "status": "open",
    "dueDate": null,
    "cost": null,
    "icon": null,
    "coverImageKey": null,
    "position": "a0",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### `GET /api/projects/:projectId/tasks`

Lists all tasks in a project, ordered by position. Supports optional query-parameter filters.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Query parameters (all optional):**

| Param | Type | Description |
|-------|------|-------------|
| `taskGroupId` | `string` | Filter by task group |
| `assigneeId` | `string` | Filter by assignee |
| `completed` | `string` | Filter by completion state (`"true"` or `"false"`) |
| `priority` | `string` | Filter by priority (`urgent`, `high`, `medium`, `low`, `none`) |
| `labelIds` | `string` | Comma-separated label IDs — only tasks with all specified labels |

**Response** (200):

```json
{ "tasks": [ { "id": "...", "title": "...", "status": "...", "..." } ] }
```

### `GET /api/tasks/:taskId`

Returns a single task with its subtasks and comments.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Response** (200):

```json
{
  "task": {
    "id": "...",
    "title": "...",
    "description": "...",
    "status": "open",
    "priority": "medium",
    "assigneeId": "...",
    "dueDate": "...",
    "position": "...",
    "subtasks": [
      { "id": "...", "title": "...", "completed": false, "position": "...", "createdAt": "..." }
    ],
    "comments": [
      { "id": "...", "authorId": "...", "body": "...", "createdAt": "...", "updatedAt": "..." }
    ]
  }
}
```

### `PATCH /api/tasks/:taskId`

Updates task fields.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Request body (all fields optional):**

| Field | Type | Constraints |
|-------|------|-------------|
| `title` | `string` | 1--200 characters |
| `description` | `string \| null` | max 5000 characters |
| `assigneeId` | `string \| null` | UUID |
| `priority` | `string` | `"urgent"`, `"high"`, `"medium"`, `"low"`, or `"none"` |
| `status` | `string` | `"open"`, `"in_progress"`, `"completed"`, or `"cancelled"` |
| `dueDate` | `string \| null` | ISO 8601 datetime |
| `cost` | `integer \| null` | Non-negative integer (cents) |
| `icon` | `string \| null` | max 50 characters |
| `coverImageKey` | `string \| null` | R2 object key for cover image |

**Response** (200):

```json
{ "task": { "id": "...", "title": "...", "status": "...", "cost": 0, "icon": "...", "coverImageKey": "...", "..." } }
```

### `DELETE /api/tasks/:taskId`

Deletes a task and its subtasks/comments.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Response** (200):

```json
{ "ok": true }
```

### `PATCH /api/tasks/:taskId/move`

Moves a task to a different task group and/or position (drag-and-drop). The target group must belong to the same project.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `taskGroupId` | `string` | UUID, must be in the same project | Yes |
| `position` | `string` | non-empty fractional index | Yes |

**Response** (200):

```json
{ "task": { "id": "...", "taskGroupId": "...", "position": "...", "..." } }
```

### `POST /api/tasks/:taskId/duplicate`

Duplicates a task including its subtasks. The new task is placed at the end of the same task group with `" (copy)"` appended to the title. Subtask completion state is reset. Cover image and comments are not copied.

**Auth:** Required.
**Authorization:** Project admin or member (resolved via `requireTaskRole`).

**Request body:** Empty object `{}`.

**Response** (201):

```json
{
  "task": {
    "id": "new-uuid",
    "projectId": "...",
    "taskGroupId": "...",
    "title": "Original Title (copy)",
    "description": "...",
    "assigneeId": "...",
    "priority": "...",
    "completed": false,
    "dueDate": "...",
    "cost": null,
    "icon": "...",
    "coverImageKey": null,
    "position": "...",
    "subtaskCount": 2,
    "subtaskCompletedCount": 0,
    "commentCount": 0,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Behavior:**
1. Fetches the source task and its subtasks.
2. Creates a new task copying title (with `" (copy)"` suffix), description, assignee, priority, due date, cost, and icon. Cover image is not copied.
3. Duplicates all subtasks with completion reset to `false`.
4. Logs a `"created"` activity entry with `newValue: "Duplicated from: <original title>"`.
5. If the source task has an assignee, creates a `task_assigned` notification for them.

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project admin or member |
| 404 | Task not found |

---

### `PUT /api/tasks/:taskId/cover`

Uploads a cover image for a task. Replaces any existing cover. Rate-limited to 10 requests per minute.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Request:** `multipart/form-data` with a `file` field (JPEG, PNG, GIF, or WebP, max 5 MB).

**Behavior:**
1. Validates the file type and size.
2. Looks up the task's previous cover image (if any) but does not delete it yet.
3. Uploads the new file to R2 under `task-cover/{userId}/{uuid}{ext}`. If the R2 upload fails, the old cover remains intact.
4. Creates a record in the `upload` table and sets the task's `coverImageKey` to the new R2 key. If either DB write fails, the orphaned R2 object and any partial upload record are cleaned up before returning 500.
5. Deletes the old cover from R2 and the database only after the new one is fully saved.

**Response** (200):

```json
{
  "upload": {
    "id": "abc123",
    "url": "/api/uploads/task-cover/userId/uuid.jpg",
    "filename": "cover.jpg",
    "mimeType": "image/jpeg",
    "size": 204800
  }
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 400 | No file provided, invalid file type, or file too large |
| 401 | Not authenticated |
| 403 | Not a project member |
| 404 | Task not found |
| 429 | Rate limit exceeded |
| 500 | R2 upload failed or database write failed (with automatic cleanup) |
| 503 | R2 storage binding not configured |

### `DELETE /api/tasks/:taskId/cover`

Removes the cover image from a task. Idempotent -- returns success even if no cover exists.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Response** (200):

```json
{ "ok": true }
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project member |
| 404 | Task not found |
| 503 | R2 storage binding not configured |

---

## Subtasks

### `POST /api/tasks/:taskId/subtasks`

Creates a subtask on a task. Position is automatically assigned at the end.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `title` | `string` | 1--200 characters | Yes |

**Response** (201):

```json
{
  "subtask": {
    "id": "uuid",
    "taskId": "taskId",
    "title": "Write tests",
    "completed": false,
    "position": "a0",
    "createdAt": "..."
  }
}
```

### `PATCH /api/subtasks/:subtaskId`

Updates a subtask's title or completion status. Access is verified by looking up the parent task's project.

**Auth:** Required.
**Authorization:** Project member (via inline check).

**Request body (all fields optional):**

| Field | Type | Constraints |
|-------|------|-------------|
| `title` | `string` | 1--200 characters |
| `completed` | `boolean` | |

**Response** (200):

```json
{ "subtask": { "id": "...", "title": "...", "completed": true, "..." } }
```

### `DELETE /api/subtasks/:subtaskId`

Deletes a subtask. Access is verified by looking up the parent task's project.

**Auth:** Required.
**Authorization:** Project member (via inline check).

**Response** (200):

```json
{ "ok": true }
```

---

## Comments

### `GET /api/tasks/:taskId/comments`

Lists comments for a task with compound cursor-based pagination (`createdAt|id`). Returns comments in ascending order by creation date then id for stable pagination without gaps or duplicates.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | 20 | Number of comments per page (max 100) |
| `cursor` | `string` | — | Compound cursor in `"isoDate\|id"` format for pagination (paginates by `createdAt` + `id` tiebreaker) |

**Response** (200):

```json
{
  "comments": [
    {
      "id": "uuid",
      "taskId": "taskId",
      "authorId": "userId",
      "authorName": "John Doe",
      "body": "Looks good to me!",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "nextCursor": "2025-01-15T10:30:00.000Z|abc123-uuid"
}
```

`nextCursor` is `null` when there are no more pages. `authorName` falls back to `"Unknown"` when the author has been deleted.

### `POST /api/tasks/:taskId/complete`

Marks a task as complete. If the project has a completion group, the task is automatically moved into it. Creates activity log entries and notifies the assignee (if different from the actor).

**Auth:** Required.
**Authorization:** Project admin or member (resolved via `requireTaskRole`).

**Response** (200):

```json
{
  "task": { "id": "...", "completed": true, "completedAt": "...", "completedBy": "userId", "..." }
}
```

Returns 404 if the task is not found. Returns the task unchanged if already completed.

### `POST /api/tasks/:taskId/uncomplete`

Marks a completed task as incomplete. If the task is in a completion group, it is automatically moved to the first non-completion group. Creates activity log entries.

**Auth:** Required.
**Authorization:** Project admin or member (resolved via `requireTaskRole`).

**Response** (200):

```json
{
  "task": { "id": "...", "completed": false, "completedAt": null, "completedBy": null, "..." }
}
```

Returns 404 if the task is not found. Returns the task unchanged if already incomplete.

### `POST /api/tasks/:taskId/comments`

Adds a comment to a task. The authenticated user is recorded as the author. Creates a `comment_added` activity log entry with the first 100 characters of the comment body as `newValue`.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `body` | `string` | 1--5000 characters | Yes |

**Response** (201):

```json
{
  "comment": {
    "id": "uuid",
    "taskId": "taskId",
    "authorId": "userId",
    "body": "Looks good to me!",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### `PATCH /api/comments/:commentId`

Updates a comment's body. Only the comment author can edit. Creates a `comment_updated` activity log entry.

**Auth:** Required.
**Authorization:** Comment author only.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `body` | `string` | 1--5000 characters | Yes |

**Response** (200):

```json
{ "comment": { "id": "...", "body": "...", "updatedAt": "...", "..." } }
```

### `DELETE /api/comments/:commentId`

Deletes a comment. The comment author can always delete their own comment. Project admins (or workspace owners/admins) can also delete any comment. Creates a `comment_deleted` activity log entry.

**Auth:** Required.
**Authorization:** Comment author, or project admin.

**Response** (200):

```json
{ "ok": true }
```

---

## Task Attachments

### `GET /api/tasks/:taskId/attachments`

Lists all attachments for a task, ordered by creation date ascending. Each attachment includes uploader info and a serveable URL.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Response** (200):

```json
{
  "attachments": [
    {
      "id": "attachmentId",
      "uploadId": "uploadId",
      "filename": "report.pdf",
      "mimeType": "application/pdf",
      "size": 204800,
      "url": "/api/uploads/task-attachment/userId/uuid.pdf",
      "uploaderName": "John Doe",
      "uploaderImage": "https://...",
      "createdAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

### `POST /api/tasks/:taskId/attachments`

Uploads a file attachment to a task. Rate-limited to 20 requests per minute. Files are stored in R2 under the `task-attachment` purpose. Creates an `attachment_added` activity log entry.

**Auth:** Required.
**Authorization:** Project admin or member.

**Request:** `multipart/form-data` with a `file` field.

**Constraints:**
- Allowed types: images (JPEG, PNG, GIF, WebP), PDFs, Office documents (Word, Excel, PowerPoint), text (plain, CSV, Markdown), ZIP archives
- Maximum size: 10 MB
- Maximum attachments per task: 20

**Response** (201):

```json
{
  "attachment": {
    "id": "attachmentId",
    "uploadId": "uploadId",
    "filename": "report.pdf",
    "mimeType": "application/pdf",
    "size": 204800,
    "url": "/api/uploads/task-attachment/userId/uuid.pdf",
    "uploaderName": "John Doe",
    "uploaderImage": null,
    "createdAt": "2025-01-15T10:30:00.000Z"
  }
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 400 | No file provided, invalid file type, file too large, or max attachments reached |
| 401 | Not authenticated |
| 403 | Not a project admin or member |
| 429 | Rate limit exceeded |
| 500 | R2 upload failed or database write failed (with automatic cleanup) |
| 503 | R2 storage binding not configured |

### `DELETE /api/tasks/:taskId/attachments/:attachmentId`

Deletes an attachment from a task. Removes the R2 object (best-effort), the `task_attachment` record, and the `upload` record. Creates an `attachment_removed` activity log entry.

**Auth:** Required.
**Authorization:** Project member (any role via `requireTaskAccess`). Handler-level check: user must be the attachment uploader OR have project admin/member role. Viewers can only delete their own uploads.

**Response** (200):

```json
{ "ok": true, "deletedId": "attachmentId" }
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not the uploader and not a project admin or member |
| 404 | Attachment not found or doesn't belong to this task |
| 503 | R2 storage binding not configured |

---

## Teams

> **Note:** The Teams feature is currently hidden from the UI. The API endpoints below still exist and function, but there are no UI entry points. Teams are not yet functionally integrated into the product (they don't affect task assignment, project access, or permissions). The feature will be re-enabled once a functional purpose is defined.

### `POST /api/workspaces/:workspaceId/teams`

Creates a new team within a workspace.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--100 characters | Yes |
| `description` | `string` | max 500 characters | No |

**Response** (201):

```json
{
  "team": {
    "id": "uuid",
    "workspaceId": "workspaceId",
    "name": "Engineering",
    "description": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### `GET /api/workspaces/:workspaceId/teams`

Lists all teams in a workspace, including a member count per team.

**Auth:** Required.
**Authorization:** Workspace member.

**Response** (200):

```json
{
  "teams": [
    {
      "id": "uuid",
      "workspaceId": "workspaceId",
      "name": "Engineering",
      "description": null,
      "createdAt": "...",
      "updatedAt": "...",
      "memberCount": 4
    }
  ]
}
```

### `PATCH /api/workspaces/:workspaceId/teams/:teamId`

Updates a team's name or description.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Request body (all fields optional):**

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | `string` | 1--100 characters |
| `description` | `string \| null` | max 500 characters |

**Response** (200):

```json
{ "team": { "id": "...", "name": "...", "description": "...", "..." } }
```

### `DELETE /api/workspaces/:workspaceId/teams/:teamId`

Deletes a team.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{ "ok": true }
```

### `POST /api/workspaces/:workspaceId/teams/:teamId/members`

Adds a workspace member to a team. The target user must already be a member of the workspace.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `userId` | `string` | non-empty | Yes |
| `role` | `string` | e.g. `"lead"`, `"member"` (defaults to `"member"`) | No |

**Response** (201):

```json
{ "member": { "id": "...", "teamId": "...", "userId": "...", "role": "member", "joinedAt": "..." } }
```

### `DELETE /api/workspaces/:workspaceId/teams/:teamId/members/:userId`

Removes a member from a team.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{ "ok": true }
```

---

## Invitations

### `POST /api/workspaces/:workspaceId/invitations`

Creates a workspace invitation. Sends an invite to the specified email. A unique token is generated and the invitation expires after 7 days.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `email` | `string` | Valid email address | Yes |
| `role` | `string` | `"admin"` or `"member"` (cannot be `"owner"`; defaults to `"member"`) | No |

**Response** (201):

```json
{
  "invitation": {
    "id": "uuid",
    "workspaceId": "workspaceId",
    "email": "invitee@example.com",
    "role": "member",
    "invitedBy": "userId",
    "token": "uuid-token",
    "status": "pending",
    "expiresAt": "...",
    "createdAt": "..."
  }
}
```

### `GET /api/workspaces/:workspaceId/invitations`

Lists all pending invitations for a workspace.

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{
  "invitations": [
    {
      "id": "uuid",
      "workspaceId": "workspaceId",
      "email": "invitee@example.com",
      "role": "member",
      "invitedBy": "userId",
      "token": "...",
      "status": "pending",
      "expiresAt": "...",
      "createdAt": "..."
    }
  ]
}
```

### `DELETE /api/workspaces/:workspaceId/invitations/:id`

Revokes a pending invitation (sets its status to `"revoked"`).

**Auth:** Required.
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{ "ok": true }
```

### `GET /api/invitations/:token`

Looks up an invitation by its token. Returns workspace and inviter details. No authentication required -- used for the public invitation acceptance page. Rate-limited to 10 requests per minute.

**Auth:** Not required.

**Response** (200):

```json
{
  "invitation": {
    "id": "uuid",
    "email": "invitee@example.com",
    "role": "member",
    "expiresAt": "...",
    "workspace": { "id": "workspaceId", "name": "My Workspace" },
    "invitedBy": { "id": "userId", "name": "John Doe", "email": "john@example.com" }
  }
}
```

**Errors:** 400 (invitation expired or not pending), 404 (invalid token), 429 (rate limit exceeded).

### `POST /api/invitations/accept`

Accepts a workspace invitation. The authenticated user is added as a workspace member with the role specified in the invitation. Rate-limited to 10 requests per minute.

**Auth:** Required.
**Authorization:** Any authenticated user.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `token` | `string` | non-empty | Yes |

**Response** (200):

```json
{ "ok": true, "workspaceId": "workspaceId" }
```

**Errors:** 400 (invitation expired), 404 (invalid token), 409 (invitation already accepted/declined), 429 (rate limit exceeded).

---

## Dashboard

### `GET /api/workspaces/:workspaceId/dashboard`

Returns a workspace-level dashboard scoped to **active projects only**. Includes task count breakdowns by status, aggregate task counts, priority breakdown, per-member workload, overdue tasks, cost aggregation, and a summary of non-active (completed/archived) projects across the workspace.

**Auth:** Required.
**Authorization:** Workspace member. Non-elevated members only see projects they belong to.

**Response** (200):

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "My Project",
      "status": "active",
      "taskCounts": {
        "active": 5,
        "completed": 12,
        "total": 17
      },
      "memberCount": 4
    }
  ],
  "taskCounts": { "activeCount": 10, "completedCount": 20, "totalCount": 30 },
  "priorityBreakdown": [{ "priority": "high", "count": 5 }],
  "tasksPerMember": [{ "id": "userId", "name": "John Doe", "count": 7 }],
  "overdueTasks": [{ "id": "...", "title": "...", "priority": "high", "dueDate": "...", "assigneeId": "...", "assigneeName": "...", "assigneeImage": "...", "taskGroupName": "..." }],
  "costAggregation": {
    "totalCost": 30000,
    "completedCost": 10000,
    "activeCost": 20000,
    "tasksWithCost": 3
  },
  "archivedSummary": [
    { "status": "archived", "projectCount": 2, "totalTasks": 15, "completedTasks": 12 },
    { "status": "completed", "projectCount": 1, "totalTasks": 8, "completedTasks": 8 }
  ]
}
```

Cost values are in cents. `costAggregation` sums costs across all tasks in visible active projects. `archivedSummary` provides per-status rollups for non-active projects (empty array when there are none).

### `GET /api/workspaces/:workspaceId/dashboard/my-tasks`

Returns tasks assigned to the authenticated user across **active projects** in the workspace. Excludes completed and cancelled tasks. Supports compound cursor-based pagination (`createdAt|id`), ordered by `createdAt` descending then `id` descending for stable pagination without gaps or duplicates. Query parameters are validated via `myTasksQuerySchema`.

**Auth:** Required.
**Authorization:** Workspace member.

**Query parameters (all optional):**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | `string` | — | Filter by due date window: `"week"`, `"fortnight"`, or `"month"` |
| `limit` | `number` | 50 | Number of tasks per page (1–200) |
| `cursor` | `string` | — | Compound cursor in `"isoDate\|id"` format for pagination (paginates by `createdAt` + `id` tiebreaker) |

**Response** (200):

```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "Fix bug",
      "status": "open",
      "priority": "high",
      "dueDate": "...",
      "createdAt": "...",
      "projectId": "...",
      "projectName": "My Project",
      "taskGroupId": "...",
      "taskGroupName": "To Do"
    }
  ],
  "nextCursor": "2025-01-15T10:30:00.000Z|abc123-uuid"
}
```

`nextCursor` is `null` when there are no more pages.

### `GET /api/workspaces/:workspaceId/dashboard/upcoming`

Returns upcoming tasks across **active projects** in the workspace with due dates, grouped into time buckets. Excludes completed and cancelled tasks. Supports compound cursor-based pagination (`dueDate|id`), ordered by `dueDate` ascending then `id` ascending for stable pagination without gaps or duplicates. Query parameters are validated via `upcomingTasksQuerySchema`.

**Auth:** Required.
**Authorization:** Workspace member.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | 50 | Number of tasks per page (1–200) |
| `cursor` | `string` | — | Compound cursor in `"isoDate\|id"` format for pagination (paginates by `dueDate` + `id` tiebreaker) |

**Response** (200):

```json
{
  "buckets": {
    "overdue": [ { "id": "...", "title": "...", "dueDate": "...", "..." } ],
    "today": [],
    "this_week": [],
    "next_week": [],
    "this_month": [],
    "later": []
  },
  "nextCursor": "2025-02-10T00:00:00.000Z|def456-uuid"
}
```

`nextCursor` is `null` when there are no more pages.

Each task object in the buckets includes: `id`, `title`, `status`, `priority`, `dueDate`, `assigneeId`, `projectId`, `projectName`, `taskGroupId`, `taskGroupName`.

---

## Activity

### `GET /api/tasks/:taskId/activity`

Lists activity log entries for a task with compound cursor-based pagination (`createdAt|id`). Returns activities in descending order by creation date then id for stable pagination without gaps or duplicates. Query parameters are validated via `listActivityQuerySchema`.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | 5 | Number of activities per page (1–100) |
| `cursor` | `string` | — | Compound cursor in `"isoDate\|id"` format for pagination (paginates by `createdAt` + `id` tiebreaker) |

**Response** (200):

```json
{
  "activities": [
    {
      "id": "uuid",
      "taskId": "taskId",
      "actorId": "userId",
      "actorName": "John Doe",
      "actorImage": "https://...",
      "action": "completed",
      "field": null,
      "oldValue": null,
      "newValue": null,
      "createdAt": "..."
    }
  ],
  "nextCursor": "2025-01-15T10:30:00.000Z|def456-uuid"
}
```

`nextCursor` is `null` when there are no more pages. `actorName` and `actorImage` are `null` when the actor has been deleted.

### `GET /api/projects/:projectId/activity`

Lists activity log entries across all tasks in a project with compound cursor-based pagination (`createdAt|id`). Returns activities in descending order by creation date then id. Each entry includes the task title for context.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | 15 | Number of activities per page (1–100) |
| `cursor` | `string` | — | Compound cursor in `"isoDate\|id"` format for pagination (paginates by `createdAt` + `id` tiebreaker) |

**Response** (200):

```json
{
  "activities": [
    {
      "id": "uuid",
      "taskId": "taskId",
      "taskTitle": "Implement login flow",
      "actorId": "userId",
      "actorName": "John Doe",
      "actorImage": "https://...",
      "action": "completed",
      "field": null,
      "oldValue": null,
      "newValue": null,
      "createdAt": "..."
    }
  ],
  "nextCursor": "2025-01-15T10:30:00.000Z|def456-uuid"
}
```

`nextCursor` is `null` when there are no more pages. `actorName` and `actorImage` are `null` when the actor has been deleted.

### `GET /api/projects/:projectId/dashboard`

Returns a project-level dashboard with task breakdowns by status, by task group, per member, upcoming tasks for the next 30 days, overdue tasks (past-due incomplete tasks with assignee details), priority breakdown (count of active tasks by priority level), cost aggregation across the project's tasks, project budget, and cost per assigned member.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Response** (200):

```json
{
  "taskCounts": {
    "activeCount": 5,
    "completedCount": 12,
    "totalCount": 17
  },
  "tasksByGroup": [
    { "taskGroupId": "...", "taskGroupName": "To Do", "count": 4 }
  ],
  "tasksPerMember": [
    { "id": "userId", "name": "John Doe", "count": 7 }
  ],
  "upcomingTasks": [
    {
      "id": "...",
      "title": "...",
      "completed": false,
      "priority": "medium",
      "dueDate": "...",
      "assigneeId": "...",
      "taskGroupId": "...",
      "taskGroupName": "To Do"
    }
  ],
  "overdueTasks": [
    {
      "id": "...",
      "title": "...",
      "priority": "high",
      "dueDate": "...",
      "assigneeId": "...",
      "assigneeName": "Jane Smith",
      "assigneeImage": "https://...",
      "taskGroupName": "In Progress"
    }
  ],
  "priorityBreakdown": [
    { "priority": "urgent", "count": 2 },
    { "priority": "high", "count": 5 },
    { "priority": "medium", "count": 8 },
    { "priority": "low", "count": 3 },
    { "priority": "none", "count": 4 }
  ],
  "costAggregation": {
    "totalCost": 30000,
    "completedCost": 10000,
    "activeCost": 20000,
    "tasksWithCost": 3
  },
  "budget": 50000,
  "costPerMember": [
    { "id": "userId", "name": "John Doe", "totalCost": 15000 }
  ]
}
```

`costAggregation` sums task costs for the project (values in cents). `budget` is the project's budget in cents (or `null` if unset). `costPerMember` lists each member's total cost from assigned tasks that have a cost value.

---

### `POST /api/workspaces/:workspaceId/webhooks`

Creates a webhook for the workspace. Requires `owner` or `admin` role. Maximum 20 webhooks per workspace. The webhook `secret` is only returned on creation.

**Auth**: `requireAuth` + `requireWorkspaceRole("owner", "admin")`

**Body** (`CreateWebhookInput`):

```json
{
  "name": "My Webhook",
  "url": "https://example.com/hook",
  "events": ["task.created", "task.updated"]
}
```

**Response** (201):

```json
{
  "webhook": {
    "id": "uuid",
    "workspaceId": "uuid",
    "name": "My Webhook",
    "url": "https://example.com/hook",
    "secret": "whsec_...",
    "events": "[\"task.created\",\"task.updated\"]",
    "active": true,
    "consecutiveFailures": 0,
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

**Errors**: `400` invalid URL (SSRF validation), `409` webhook limit exceeded.

---

### `GET /api/workspaces/:workspaceId/webhooks`

Lists all webhooks for the workspace. Secrets are omitted from the response.

**Auth**: `requireAuth` + `requireWorkspaceRole("owner", "admin")`

**Response** (200):

```json
{
  "webhooks": [
    {
      "id": "uuid",
      "workspaceId": "uuid",
      "name": "My Webhook",
      "url": "https://example.com/hook",
      "events": "[\"task.created\",\"task.updated\"]",
      "active": true,
      "consecutiveFailures": 0,
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### `GET /api/workspaces/:workspaceId/webhooks/:webhookId`

Returns a single webhook (secret omitted) with its 20 most recent delivery records.

**Auth**: `requireAuth` + `requireWorkspaceRole("owner", "admin")`

**Response** (200):

```json
{
  "webhook": { "id": "uuid", "name": "...", "url": "...", "..." : "..." },
  "deliveries": [
    {
      "id": "uuid",
      "webhookId": "uuid",
      "event": "task.created",
      "success": true,
      "statusCode": 200,
      "response": "OK",
      "createdAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

**Errors**: `404` webhook not found.

---

### `PATCH /api/workspaces/:workspaceId/webhooks/:webhookId`

Updates a webhook. All fields are optional. Set `regenerateSecret: true` to rotate the secret (the new secret is returned only in this response).

**Auth**: `requireAuth` + `requireWorkspaceRole("owner", "admin")`

**Body** (`UpdateWebhookInput`):

```json
{
  "name": "New Name",
  "url": "https://new-url.com/hook",
  "events": ["task.created"],
  "active": false,
  "regenerateSecret": true
}
```

**Response** (200): The updated webhook. Secret is included only when `regenerateSecret` was `true`.

**Errors**: `400` invalid URL, `404` webhook not found.

---

### `DELETE /api/workspaces/:workspaceId/webhooks/:webhookId`

Deletes a webhook and all associated delivery records (cascade).

**Auth**: `requireAuth` + `requireWorkspaceRole("owner", "admin")`

**Response**: `204 No Content`

**Errors**: `404` webhook not found.

---

### `POST /api/workspaces/:workspaceId/webhooks/:webhookId/test`

Sends a test `webhook.test` event to the webhook URL synchronously and returns the delivery result.

**Auth**: `requireAuth` + `requireWorkspaceRole("owner", "admin")`

**Response** (200):

```json
{
  "delivery": {
    "id": "uuid",
    "success": true,
    "statusCode": 200,
    "response": "OK"
  }
}
```

**Errors**: `404` webhook not found.

---

### `* /api/*` (404 catch-all)

Any `/api/*` request that does not match a defined route returns a 404:

```json
{
  "error": "Not Found",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## Request/Response Formats

### Requests

- API requests should use `Content-Type: application/json` (or `multipart/form-data` for file uploads).
- Session cookies are included automatically by the browser (`credentials: "include"`).
- An optional `x-request-id` header can be sent to correlate requests; if omitted, one is generated.

### Responses

All API responses are JSON. Successful responses vary by endpoint. Error responses follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Validation errors include additional detail:

```json
{
  "error": "Validation failed",
  "details": [
    { "path": "email", "message": "Invalid email" },
    { "path": "password", "message": "Password must be at least 8 characters" }
  ]
}
```
