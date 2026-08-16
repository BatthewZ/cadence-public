# Schema

All table definitions live in `src/db/schema/`. The barrel file `src/db/schema/index.ts` re-exports everything:

```ts
export * from "./api-token";
export * from "./audit-log";
export * from "./auth";
export * from "./calendar-feed-token";
export * from "./invitation";
export * from "./label";
export * from "./legal-acceptance";
export * from "./notification";
export * from "./project";
export * from "./saved-view";
export * from "./task";
export * from "./task-attachment";
export * from "./team";
export * from "./uploads";
export * from "./webhook";
export * from "./workspace";
```

### Tables

#### `user`

**File:** `src/db/schema/auth.ts`

| Column          | Type                          | Constraints              | Description                          |
| --------------- | ----------------------------- | ------------------------ | ------------------------------------ |
| `id`            | `text`                        | **Primary key**          | Unique user identifier               |
| `name`          | `text`                        | `NOT NULL`               | Display name                         |
| `email`         | `text`                        | `NOT NULL`, `UNIQUE`     | User email address                   |
| `emailVerified` | `integer` (mode: `boolean`)   | `NOT NULL`               | Whether the email has been verified  |
| `image`         | `text`                        |                          | Profile image URL                    |
| `createdAt`     | `integer` (mode: `timestamp`) | `NOT NULL`               | Account creation timestamp           |
| `updatedAt`     | `integer` (mode: `timestamp`) | `NOT NULL`               | Last update timestamp                |

#### `session`

**File:** `src/db/schema/auth.ts`

| Column      | Type                          | Constraints                                    | Description                          |
| ----------- | ----------------------------- | ---------------------------------------------- | ------------------------------------ |
| `id`        | `text`                        | **Primary key**                                | Unique session identifier            |
| `userId`    | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)      | References the owning user           |
| `token`     | `text`                        | `NOT NULL`, `UNIQUE`                           | Session token                        |
| `expiresAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Session expiration time              |
| `ipAddress` | `text`                        |                                                | Client IP address                    |
| `userAgent` | `text`                        |                                                | Client user agent string             |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Session creation timestamp           |
| `updatedAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Last update timestamp                |

**Indexes:** index on `userId`

#### `account`

**File:** `src/db/schema/auth.ts`

| Column                  | Type                          | Constraints                               | Description                               |
| ----------------------- | ----------------------------- | ----------------------------------------- | ----------------------------------------- |
| `id`                    | `text`                        | **Primary key**                           | Unique account identifier                 |
| `userId`                | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade) | References the owning user                |
| `accountId`             | `text`                        | `NOT NULL`                                | External account ID (e.g. OAuth provider) |
| `providerId`            | `text`                        | `NOT NULL`                                | Auth provider name (e.g. `"credential"`)  |
| `accessToken`           | `text`                        |                                           | OAuth access token                        |
| `refreshToken`          | `text`                        |                                           | OAuth refresh token                       |
| `accessTokenExpiresAt`  | `integer` (mode: `timestamp`) |                                           | Access token expiration                   |
| `refreshTokenExpiresAt` | `integer` (mode: `timestamp`) |                                           | Refresh token expiration                  |
| `scope`                 | `text`                        |                                           | OAuth scope                               |
| `password`              | `text`                        |                                           | Hashed password (for email/password auth) |
| `createdAt`             | `integer` (mode: `timestamp`) | `NOT NULL`                                | Account creation timestamp                |
| `updatedAt`             | `integer` (mode: `timestamp`) | `NOT NULL`                                | Last update timestamp                     |

#### `verification`

**File:** `src/db/schema/auth.ts`

| Column       | Type                          | Constraints     | Description                                 |
| ------------ | ----------------------------- | --------------- | ------------------------------------------- |
| `id`         | `text`                        | **Primary key** | Unique verification identifier              |
| `identifier` | `text`                        | `NOT NULL`      | What is being verified (e.g. email address) |
| `value`      | `text`                        | `NOT NULL`      | Verification token/code                     |
| `expiresAt`  | `integer` (mode: `timestamp`) | `NOT NULL`      | Expiration time                             |
| `createdAt`  | `integer` (mode: `timestamp`) | `NOT NULL`      | Creation timestamp                          |
| `updatedAt`  | `integer` (mode: `timestamp`) | `NOT NULL`      | Last update timestamp                       |

#### `upload`

**File:** `src/db/schema/uploads.ts`

| Column     | Type                          | Constraints                               | Description                               |
| ---------- | ----------------------------- | ----------------------------------------- | ----------------------------------------- |
| `id`       | `text`                        | **Primary key**                           | Unique upload identifier                  |
| `userId`   | `text`                        | **FK** -> `user.id` (set null) | References the owning user (nullable; preserved when user is deleted) |
| `key`      | `text`                        | `NOT NULL`                                | R2 object key (`purpose/userId/uuid.ext`) |
| `filename` | `text`                        | `NOT NULL`                                | Original filename                         |
| `mimeType` | `text`                        | `NOT NULL`                                | MIME type of the uploaded file             |
| `size`     | `integer`                     | `NOT NULL`                                | File size in bytes                        |
| `purpose`  | `text`                        | `NOT NULL`                                | Upload purpose (e.g. `"avatar"`)          |
| `createdAt`| `integer` (mode: `timestamp`) | `NOT NULL`                                | Upload timestamp                          |

**Indexes:** index on `userId`

#### `workspace`

**File:** `src/db/schema/workspace.ts`

| Column        | Type                          | Constraints                               | Description                    |
| ------------- | ----------------------------- | ----------------------------------------- | ------------------------------ |
| `id`          | `text`                        | **Primary key**                           | Unique workspace identifier    |
| `name`        | `text`                        | `NOT NULL`                                | Workspace display name         |
| `slug`        | `text`                        | `NOT NULL`                                | URL-friendly workspace slug    |
| `description` | `text`                        |                                           | Workspace description          |
| `ownerId`     | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade) | References the workspace owner |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                | Creation timestamp             |
| `updatedAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                | Last update timestamp          |
| `theme`       | `text`                        |                                           | Workspace theme                |
| `policy`      | `text`                        |                                           | Governance toggles, JSON object |

**Indexes:** unique on (`ownerId`, `slug`) — slugs are unique per owner, not globally

**`policy` — why one JSON column instead of a column per toggle.** The pressure a
governance setting creates is not "we need one boolean", it is "we will need the
next eight". A column per toggle answers that with a migration, a schema edit and
a new plumbing path each time, plus a backfill decision for existing rows on every
addition. One JSON object with the defaults resolved in code makes the next toggle
a field on an interface.

The column is nullable with **no** database default, and nothing is ever
backfilled — that is the point, not an omission. `NULL` means "this workspace has
never expressed a preference" and resolves to every code default, so a toggle
added later takes effect correctly for workspaces that predate it.

Never read this column directly. `resolveWorkspacePolicy`
(`src/shared/types/workspace-policy.ts`) is the single source of truth for the
defaults, and it is total over malformed input: a corrupt or hand-edited value
degrades to the defaults rather than throwing, because this resolves inside
`getWorkspace` — the query every workspace route blocks on, where a throw would
take a whole tenant's UI down over one bad row. That trade is only acceptable
because the toggles here are governance preferences rather than access controls;
a flag that gated data access must not be added to this object.

Writes go through `json_patch` (see `updateWorkspace`), so a `PATCH` carrying one
toggle merges rather than replacing — two admins saving different toggles cannot
clobber each other.

Current toggles:

| Key                          | Default | Effect                                                                                                                       |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `allowMemberProjectCreation` | `true`  | When `false`, workspace `member`s cannot create projects or duplicate ones they administer. Owners and admins are unaffected. |

#### `workspaceMember`

**File:** `src/db/schema/workspace.ts`

| Column        | Type                          | Constraints                                        | Description                                       |
| ------------- | ----------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| `id`          | `text`                        | **Primary key**                                    | Unique membership identifier                      |
| `workspaceId` | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade)     | References the workspace                          |
| `userId`      | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)          | References the member user                        |
| `role`        | `text`                        | `NOT NULL`, default `"member"`                     | Member role (e.g. `"owner"`, `"admin"`, `"member"`) |
| `invitedBy`   | `text`                        | **FK** -> `user.id` (set null)                     | References the user who sent the invite           |
| `joinedAt`    | `integer` (mode: `timestamp`) | `NOT NULL`                                         | Timestamp when the user joined                    |

**Indexes:** unique on (`workspaceId`, `userId`), index on `userId`

#### `team`

**File:** `src/db/schema/team.ts`

| Column        | Type                          | Constraints                                    | Description                 |
| ------------- | ----------------------------- | ---------------------------------------------- | --------------------------- |
| `id`          | `text`                        | **Primary key**                                | Unique team identifier      |
| `workspaceId` | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade) | References the workspace    |
| `name`        | `text`                        | `NOT NULL`                                     | Team display name           |
| `description` | `text`                        |                                                | Team description            |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Creation timestamp          |
| `updatedAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Last update timestamp       |

**Indexes:** index on `workspaceId`

#### `teamMember`

**File:** `src/db/schema/team.ts`

| Column     | Type                          | Constraints                             | Description                                       |
| ---------- | ----------------------------- | --------------------------------------- | ------------------------------------------------- |
| `id`       | `text`                        | **Primary key**                         | Unique membership identifier                      |
| `teamId`   | `text`                        | `NOT NULL`, **FK** -> `team.id` (cascade) | References the team                              |
| `userId`   | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade) | References the member user                       |
| `role`     | `text`                        | `NOT NULL`, default `"member"`          | Member role (e.g. `"lead"`, `"member"`)           |
| `joinedAt` | `integer` (mode: `timestamp`) | `NOT NULL`                              | Timestamp when the user joined                    |

**Indexes:** unique on (`teamId`, `userId`), index on `userId`

#### `project`

**File:** `src/db/schema/project.ts`

| Column        | Type                          | Constraints                                    | Description                              |
| ------------- | ----------------------------- | ---------------------------------------------- | ---------------------------------------- |
| `id`          | `text`                        | **Primary key**                                | Unique project identifier                |
| `workspaceId` | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade) | References the workspace                 |
| `name`        | `text`                        | `NOT NULL`                                     | Project display name                     |
| `description` | `text`                        |                                                | Project description                      |
| `status`      | `text`                        | `NOT NULL`, default `"active"`                 | Project status (e.g. `"active"`, `"archived"`) |
| `icon`          | `text`                        |                                                | Project icon (e.g. emoji or icon identifier)   |
| `coverImageKey` | `text`                        |                                                | R2 object key for the project cover image (mutually exclusive with `coverUnsplash`) |
| `coverImagePosition` | `integer`               |                                                | Vertical position of the cover image (0–100)   |
| `coverUnsplash` | `text` (mode: `json`)         |                                                | JSON-encoded Unsplash cover payload (`UnsplashCoverPayload` from `src/shared/schemas/unsplash.ts`); mutually exclusive with `coverImageKey` |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Creation timestamp                       |
| `updatedAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Last update timestamp                    |
| `theme`       | `text`                        |                                                | Project theme name                       |
| `budget`      | `integer`                     |                                                | Project budget in cents (nullable)       |
| `autoAssignCreator` | `integer` (mode: `boolean`) | `NOT NULL`, default `false`              | Auto-assign new tasks to their creator   |
| `position`    | `text`                        |                                                | Fractional index for sidebar ordering (nullable; lazy-backfilled on first list) |

**Indexes:** index on `workspaceId`, composite index on (`workspaceId`, `updatedAt`)

#### `projectMember`

**File:** `src/db/schema/project.ts`

| Column      | Type                          | Constraints                                      | Description                                |
| ----------- | ----------------------------- | ------------------------------------------------ | ------------------------------------------ |
| `id`        | `text`                        | **Primary key**                                  | Unique membership identifier               |
| `projectId` | `text`                        | `NOT NULL`, **FK** -> `project.id` (cascade)     | References the project                     |
| `userId`    | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)        | References the member user                 |
| `role`      | `text`                        | `NOT NULL`, default `"member"`                   | Member role (e.g. `"owner"`, `"member"`)   |
| `addedAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                       | Timestamp when the user was added          |

**Indexes:** unique on (`projectId`, `userId`), index on `userId`

#### `taskGroup`

**File:** `src/db/schema/task.ts`

| Column      | Type                          | Constraints                                  | Description                                    |
| ----------- | ----------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `id`        | `text`                        | **Primary key**                              | Unique task group identifier                   |
| `projectId` | `text`                        | `NOT NULL`, **FK** -> `project.id` (cascade) | References the project                         |
| `name`      | `text`                        | `NOT NULL`                                   | Group display name (e.g. `"To Do"`, `"Done"`)  |
| `color`     | `text`                        |                                              | Display color for the group                    |
| `isCompletionGroup` | `integer` (mode: `boolean`) |                                      | When true, tasks moved into this group are automatically marked as completed |
| `position`  | `text`                        | `NOT NULL`                                   | Fractional index for ordering                  |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                   | Creation timestamp                             |
| `updatedAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                   | Last update timestamp                          |

**Indexes:** index on `projectId`, composite index on (`projectId`, `updatedAt`), unique index on (`projectId`, `position`) — prevents duplicate positions from races in the read-last/write-new sequence (see migration 0026)

#### `task`

**File:** `src/db/schema/task.ts`

| Column        | Type                          | Constraints                                       | Description                                      |
| ------------- | ----------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `id`          | `text`                        | **Primary key**                                   | Unique task identifier                           |
| `projectId`   | `text`                        | `NOT NULL`, **FK** -> `project.id` (cascade)      | References the project                           |
| `taskGroupId` | `text`                        | `NOT NULL`, **FK** -> `taskGroup.id` (restrict)   | References the task group (deletion restricted)  |
| `title`       | `text`                        | `NOT NULL`                                        | Task title                                       |
| `description` | `text`                        |                                                   | Task description                                 |
| `assigneeId`  | `text`                        | **FK** -> `user.id` (set null)                    | References the assigned user                     |
| `priority`    | `text`                        | `NOT NULL`, default `"none"`                      | Priority level (e.g. `"none"`, `"low"`, `"high"`) |
| `completed`   | `integer` (mode: `boolean`)   | `NOT NULL`, default `false`                       | Whether the task is complete                     |
| `completedAt` | `integer` (mode: `timestamp`) |                                                   | Timestamp when the task was completed            |
| `completedBy` | `text`                        | **FK** -> `user.id` (set null)                    | References the user who completed the task       |
| `startDate`   | `integer` (mode: `timestamp`) |                                                   | Optional start date, independently optional from `dueDate` (a task may carry a start date alone, a due date alone, both, or neither). The only cross-field rule is ordering: `startDate` must be on or before `dueDate` when both are present — enforced in the shared Zod schemas + the `updateTask` merged-state backstop, **not** at the DB layer. UTC-midnight timestamp, matching the `dueDate` convention. No dedicated index (calendar reads are client-side; the ICS feed query is largely covered by the `(assigneeId, completed, dueDate)` index, though start-only feed rows fall outside it) |
| `dueDate`     | `integer` (mode: `timestamp`) |                                                   | Task due date                                    |
| `cost`          | `integer`                     |                                                   | Task cost in cents (nullable, optional)            |
| `icon`          | `text`                        |                                                   | Task icon (e.g. emoji or icon identifier)          |
| `coverImageKey` | `text`                        |                                                   | R2 object key for the task cover image (mutually exclusive with `coverUnsplash`) |
| `coverImagePosition` | `integer`               |                                                   | Vertical position of the cover image               |
| `coverUnsplash` | `text` (mode: `json`)         |                                                   | JSON-encoded Unsplash cover payload (`UnsplashCoverPayload` from `src/shared/schemas/unsplash.ts`); mutually exclusive with `coverImageKey` |
| `recurrenceRule` | `text`                     |                                                   | JSON-encoded recurrence rule (frequency, interval, etc.) |
| `recurrenceParentId` | `text`                  | **FK** -> `task.id` (set null), unique (non-null) | References the parent task in a recurrence chain |
| `recurrenceSeriesId` | `text`                  |                                                   | Groups all tasks belonging to the same recurrence series |
| `sourceUid`   | `text` (column `source_uid`)  | unique per (`projectId`, value) where non-null    | Provenance UID for tasks created via calendar import — the ICS `UID` of the source VEVENT. Set **only** by `POST /projects/:projectId/tasks/import` and never editable via PATCH, so a stored value is a trustworthy provenance claim, not user input. `NULL` for tasks created any other way (and not copied by duplicate/move/recurrence-spawn). Backs re-import dedupe directly on the task row (no separate import-ledger table) — see migration `0034_far_mystique` |
| `position`    | `text`                        | `NOT NULL`                                        | Fractional index for ordering within group       |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                        | Creation timestamp                               |
| `updatedAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                        | Last update timestamp                            |

**Indexes:** index on (`assigneeId`, `completed`, `dueDate`) — also serves the per-assignee ICS calendar feed query, index on (`taskGroupId`, `position`), index on (`projectId`, `completed`), composite index on (`projectId`, `assigneeId`), composite index on (`projectId`, `dueDate`, `completed`), composite index on (`projectId`, `updatedAt`), index on (`recurrenceParentId`), unique index on (`recurrenceParentId`) where non-null, index on (`recurrenceSeriesId`), unique index on (`taskGroupId`, `position`) — guards against duplicate positions under concurrent create/duplicate/complete (see migration 0026), **partial** unique index on (`projectId`, `sourceUid`) `WHERE source_uid IS NOT NULL` — one task per project per imported event UID; partial so the overwhelming majority of (non-imported, `NULL`-UID) tasks never collide (see migration 0034)

#### `subtask`

**File:** `src/db/schema/task.ts`

| Column      | Type                          | Constraints                                 | Description                     |
| ----------- | ----------------------------- | ------------------------------------------- | ------------------------------- |
| `id`        | `text`                        | **Primary key**                             | Unique subtask identifier       |
| `taskId`    | `text`                        | `NOT NULL`, **FK** -> `task.id` (cascade)   | References the parent task      |
| `title`     | `text`                        | `NOT NULL`                                  | Subtask title                   |
| `completed` | `integer` (mode: `boolean`)   | `NOT NULL`, default `false`                 | Whether the subtask is complete |
| `position`  | `text`                        | `NOT NULL`                                  | Fractional index for ordering   |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                  | Creation timestamp              |

**Indexes:** index on `taskId`, unique index on (`taskId`, `position`) — prevents position ties under concurrent subtask creates (see migration 0026)

#### `comment`

**File:** `src/db/schema/task.ts`

| Column      | Type                          | Constraints                                | Description                   |
| ----------- | ----------------------------- | ------------------------------------------ | ----------------------------- |
| `id`        | `text`                        | **Primary key**                            | Unique comment identifier     |
| `taskId`    | `text`                        | `NOT NULL`, **FK** -> `task.id` (cascade)  | References the parent task    |
| `authorId`  | `text`                        | **FK** -> `user.id` (set null)             | References the comment author |
| `body`      | `text`                        | `NOT NULL`                                 | Comment body text             |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                 | Creation timestamp            |
| `updatedAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                 | Last update timestamp         |

**Indexes:** compound index on (`taskId`, `createdAt`)

#### `taskActivity`

**File:** `src/db/schema/task.ts`

| Column      | Type                          | Constraints                                | Description                                  |
| ----------- | ----------------------------- | ------------------------------------------ | -------------------------------------------- |
| `id`         | `text`                        | **Primary key**                                | Unique activity entry identifier             |
| `taskId`     | `text`                        | `NOT NULL`, **FK** -> `task.id` (cascade)      | References the parent task                   |
| `actorId`    | `text`                        | **FK** -> `user.id` (set null)                 | References the user who performed the action |
| `apiTokenId` | `text`                        | **FK** -> `api_token.id` (set null)            | The PAT used to perform the action (null for cookie-authed mutations). Set null on token delete so historical attribution survives — the UI renders `"(via deleted token)"` |
| `action`     | `text`                        | `NOT NULL`                                     | Action type (e.g. `"completed"`, `"moved"`, `"reopened"`, `"comment_added"`, `"comment_updated"`, `"comment_deleted"`, `"label_added"`, `"label_removed"`, `"attachment_added"`, `"attachment_removed"`, `"recurrence_changed"`, `"recurrence_removed"`) |
| `field`      | `text`                        |                                                | Field that was changed (e.g. `"taskGroupId"`, `"priority"`) |
| `oldValue`   | `text`                        |                                                | Previous value of the changed field          |
| `newValue`   | `text`                        |                                                | New value of the changed field               |
| `createdAt`  | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Activity timestamp                           |

**Indexes:** composite index on (`taskId`, `createdAt`)

#### `taskAttachment`

**File:** `src/db/schema/task-attachment.ts`

| Column     | Type                          | Constraints                                  | Description                          |
| ---------- | ----------------------------- | -------------------------------------------- | ------------------------------------ |
| `id`       | `text`                        | **Primary key**                              | Unique attachment identifier         |
| `taskId`   | `text`                        | `NOT NULL`, **FK** -> `task.id` (cascade)    | References the parent task           |
| `uploadId` | `text`                        | `NOT NULL`, **FK** -> `upload.id` (cascade)  | References the upload record         |
| `createdAt`| `integer` (mode: `timestamp`) | `NOT NULL`                                   | Attachment creation timestamp        |

**Indexes:** composite index on (`taskId`, `createdAt`)

#### `label`

**File:** `src/db/schema/label.ts`

| Column      | Type                          | Constraints                                  | Description                    |
| ----------- | ----------------------------- | -------------------------------------------- | ------------------------------ |
| `id`        | `text`                        | **Primary key**                              | Unique label identifier        |
| `projectId` | `text`                        | `NOT NULL`, **FK** -> `project.id` (cascade) | References the project         |
| `name`      | `text`                        | `NOT NULL`                                   | Label display name (max 30)    |
| `color`     | `text`                        | `NOT NULL`                                   | Hex color code (e.g. `#3b82f6`) |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                   | Creation timestamp             |

**Indexes:** unique on (`projectId`, `name`)

#### `taskLabel`

**File:** `src/db/schema/label.ts`

| Column      | Type                          | Constraints                                  | Description                        |
| ----------- | ----------------------------- | -------------------------------------------- | ---------------------------------- |
| `id`        | `text`                        | **Primary key**                              | Unique assignment identifier       |
| `taskId`    | `text`                        | `NOT NULL`, **FK** -> `task.id` (cascade)    | References the task                |
| `labelId`   | `text`                        | `NOT NULL`, **FK** -> `label.id` (cascade)   | References the label               |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                   | Assignment timestamp               |

**Indexes:** unique on (`taskId`, `labelId`), index on `labelId`

#### `savedView`

**File:** `src/db/schema/saved-view.ts`

Private, per-user-per-project **saved views**: named snapshots of the task board's URL state. The URL stays the runtime source of truth — rows here are bookmarks, never live state. Two different users may each have a `"My urgent"` view on the same project (names are unique per `(projectId, creatorId)`, not globally).

| Column      | Type                          | Constraints                                  | Description                                        |
| ----------- | ----------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `id`        | `text`                        | **Primary key**                              | Unique saved-view identifier                       |
| `projectId` | `text`                        | `NOT NULL`, **FK** -> `project.id` (cascade) | References the owning project                      |
| `creatorId` | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)    | References the user who owns the view (views are private) |
| `name`      | `text`                        | `NOT NULL`                                   | User-supplied label (trimmed, 1–50 chars; unique per project + creator) |
| `state`     | `text` (mode: `json`)         | `NOT NULL`                                   | JSON snapshot typed as `SavedViewState` from `src/shared/schemas/saved-view.ts`: `{ tab, params }`. `tab` is a bounded string (not an enum) and `params` is a bounded open string-record (≤16 entries, keys 1–40 chars, values ≤500 chars). Unknown param keys are stored verbatim so views authored by a future client round-trip without corruption |
| `position`  | `text`                        | `NOT NULL`                                   | Fractional index assigned on create (v1 has no reorder endpoint) |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                   | Creation timestamp                                 |
| `updatedAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                   | Last update timestamp                              |

**Indexes:** index on (`projectId`, `creatorId`), unique index on (`projectId`, `creatorId`, `name`)

#### `notification`

**File:** `src/db/schema/notification.ts`

| Column         | Type                          | Constraints                                      | Description                                 |
| -------------- | ----------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `id`           | `text`                        | **Primary key**                                  | Unique notification identifier              |
| `userId`       | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)        | References the recipient user               |
| `type`         | `text`                        | `NOT NULL`                                       | Notification type (e.g. `"task_completed"`) |
| `title`        | `text`                        | `NOT NULL`                                       | Notification title                          |
| `body`         | `text`                        |                                                  | Optional notification body                  |
| `read`         | `integer` (mode: `boolean`)   | `NOT NULL`, default `false`                      | Whether the notification has been read      |
| `workspaceId`  | `text`                        | **FK** -> `workspace.id` (cascade)               | References the workspace context            |
| `projectId`    | `text`                        | **FK** -> `project.id` (cascade)                 | References the project context              |
| `taskId`       | `text`                        | **FK** -> `task.id` (cascade)                    | References the related task                 |
| `commentId`    | `text`                        | **FK** -> `comment.id` (cascade)                 | References the related comment              |
| `invitationId` | `text`                        | **FK** -> `invitation.id` (cascade)              | References the related invitation           |
| `actorId`      | `text`                        | **FK** -> `user.id` (set null)                   | References the user who triggered the notification |
| `createdAt`    | `integer` (mode: `timestamp`) | `NOT NULL`                                       | Creation timestamp                          |
| `readAt`       | `integer` (mode: `timestamp`) |                                                  | Timestamp when marked as read               |

**Indexes:** composite index on (`userId`, `read`, `createdAt`), composite index on (`userId`, `createdAt`)

#### `invitation`

**File:** `src/db/schema/invitation.ts`

| Column        | Type                          | Constraints                                    | Description                                   |
| ------------- | ----------------------------- | ---------------------------------------------- | --------------------------------------------- |
| `id`          | `text`                        | **Primary key**                                | Unique invitation identifier                  |
| `workspaceId` | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade) | References the workspace                      |
| `email`       | `text`                        | `NOT NULL`                                     | Email address of the invitee, stored in canonical form (trimmed, lower-cased). Normalised on write by `createInvitationSchema` and folded in place for pre-existing rows by `migrations/0036_normalize_invitation_email.sql`, so an equality probe against a folded address is exact — the invariant holds for every row, not just recent ones |
| `role`        | `text`                        | `NOT NULL`, default `"member"`                 | Role granted upon acceptance                  |
| `invitedBy`   | `text`                        | **FK** -> `user.id` (set null)                 | References the user who sent the invite       |
| `token`       | `text`                        | `NOT NULL`, `UNIQUE`                           | Unique invitation token. **Stored in plaintext today** — unlike `apiToken` and `calendarFeedToken`, which store a digest. Hashing was considered and deliberately deferred: an invitation token is not sufficient on its own (acceptance also requires a session whose *verified* email matches the invited address), it is single-use, and it expires in 7 days, so the residual risk is materially smaller. See the token-handling policy comment in `invitations.handlers.ts` for the migration plan and its prerequisites |
| `status`      | `text`                        | `NOT NULL`, default `"pending"`                | Invitation status (e.g. `"pending"`, `"accepted"`) |
| `expiresAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Invitation expiration time                    |
| `acceptedAt`  | `integer` (mode: `timestamp`) |                                                | Timestamp when accepted                       |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Creation timestamp                            |

**Indexes:** unique on (`token`), index on (`workspaceId`, `status`) — the admin's pending list — and index on (`email`, `status`, `expiresAt`) — the invitee's "what am I invited to?" lookup. The email index is only an exact-equality probe because of the canonicalisation invariant above: addresses are folded on write and every comparison site folds the account address it is matched against, so a lookup never needs a case-insensitive scan.

> **Invariant — invited addresses are canonical.** `invitation.email` is always stored trimmed and lower-cased. There is no schema-level constraint expressing this (the column is plain `text`); it is upheld by `createInvitationSchema` on write and was applied to every pre-existing row by the data-only migration `0036_normalize_invitation_email.sql`. See [Migration Workflow](./migrations.md#hand-written-migrations) for what that migration did to rows that only differed by case. `user.email` is deliberately **not** rewritten by that migration — Better Auth owns that column and already stores it folded.

#### `legalAcceptance`

**File:** `src/db/schema/legal-acceptance.ts`

| Column       | Type                          | Constraints                               | Description                               |
| ------------ | ----------------------------- | ----------------------------------------- | ----------------------------------------- |
| `id`         | `text`                        | **Primary key**                           | Unique acceptance record identifier       |
| `userId`     | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade) | References the user who accepted          |
| `tosVersion` | `text`                        | `NOT NULL`                                | ToS version string (e.g. `"1.0"`)        |
| `acceptedAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                | Timestamp of acceptance                   |

**Indexes:** index on `userId`

#### `webhook`

**File:** `src/db/schema/webhook.ts`

| Column                | Type                          | Constraints                                    | Description                                        |
| --------------------- | ----------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `id`                  | `text`                        | **Primary key**                                | Unique webhook identifier                          |
| `workspaceId`         | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade) | References the workspace                           |
| `projectId`           | `text`                        | **FK** -> `project.id` (cascade)               | Optional project scope — when set, webhook only fires for events from this project |
| `name`                | `text`                        | `NOT NULL`                                     | Human-readable webhook name                        |
| `url`                 | `text`                        | `NOT NULL`                                     | HTTPS endpoint URL for delivery                    |
| `secret`              | `text`                        | `NOT NULL`                                     | 256-bit hex secret for HMAC-SHA256 signing         |
| `events`              | `text`                        | `NOT NULL`                                     | JSON array of subscribed event types               |
| `active`              | `integer` (mode: `boolean`)   | `NOT NULL`, default `true`                     | Whether the webhook is active                      |
| `consecutiveFailures` | `integer`                     | `NOT NULL`, default `0`                        | Consecutive delivery failures (auto-disables at 10)|
| `createdAt`           | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Creation timestamp                                 |
| `updatedAt`           | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Last update timestamp                              |

**Indexes:** index on `workspaceId`, composite index on (`workspaceId`, `active`), index on `projectId`

#### `webhookDelivery`

**File:** `src/db/schema/webhook.ts`

| Column          | Type                          | Constraints                                   | Description                                    |
| --------------- | ----------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `id`            | `text`                        | **Primary key**                               | Unique delivery identifier                     |
| `webhookId`     | `text`                        | `NOT NULL`, **FK** -> `webhook.id` (cascade)  | References the parent webhook                  |
| `event`         | `text`                        | `NOT NULL`                                    | Event type that triggered this delivery        |
| `payload`       | `text`                        | `NOT NULL`                                    | JSON payload sent to the endpoint              |
| `statusCode`    | `integer`                     |                                               | HTTP status code from the endpoint (null on network error) |
| `response`      | `text`                        |                                               | Response body from the endpoint (truncated to 4 KB) |
| `success`       | `integer` (mode: `boolean`)   | `NOT NULL`                                    | Whether delivery succeeded (2xx response)      |
| `attempts`      | `integer`                     | `NOT NULL`, default `1`                       | Number of delivery attempts so far             |
| `maxAttempts`   | `integer`                     | `NOT NULL`, default `5`                       | Maximum number of delivery attempts            |
| `nextRetryAt`   | `integer` (mode: `timestamp`) |                                               | Scheduled time for the next retry attempt      |
| `createdAt`     | `integer` (mode: `timestamp`) | `NOT NULL`                                    | Creation timestamp                             |
| `lastAttemptAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                    | Timestamp of the most recent delivery attempt  |

**Indexes:** composite index on (`webhookId`, `createdAt`), composite index on (`success`, `nextRetryAt`)

#### `apiToken`

**File:** `src/db/schema/api-token.ts`

| Column          | Type                          | Constraints                                          | Description                                                                                                |
| --------------- | ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | `text`                        | **Primary key**                                      | ULID                                                                                                       |
| `userId`        | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)            | Owning user. PATs are user-scoped — there is no synthetic bot identity                                     |
| `workspaceId`   | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade)       | The token's bound workspace. Requests against any other workspace return `403`                             |
| `name`          | `text`                        | `NOT NULL`                                           | User-supplied label (e.g. `"Slackbot prod"`) — rendered in the UI and in activity attribution              |
| `tokenHash`     | `text`                        | `NOT NULL`, `UNIQUE`                                 | `sha256(plaintext)` as hex. The plaintext is **never** persisted — a DB exfil yields hashes, not tokens    |
| `tokenPrefix`   | `text`                        | `NOT NULL`                                           | First 12 characters of the plaintext (e.g. `cdn_pat_a4kZ`). Safe to log; displayed in the UI for identification |
| `scopes`        | `text`                        | `NOT NULL`                                           | JSON string array of granted scopes (e.g. `["task:read","task:write"]`). Self-describing, evolvable; debuggable in raw DB queries; allows forward-compatible scope reads |
| `projectScope`  | `text`                        | `NOT NULL`                                           | Either `"all"` or `"selected"`                                                                             |
| `projectIds`    | `text`                        |                                                      | JSON array of project IDs when `projectScope = "selected"`; `NULL` when `projectScope = "all"`. Max 50 entries; avoids a join on the hot path |
| `lastUsedAt`    | `integer` (mode: `timestamp`) |                                                      | Updated via fire-and-forget `deferWork()` on every successful auth. Powers stale-token warnings in the UI  |
| `expiresAt`     | `integer` (mode: `timestamp`) |                                                      | Hard expiry. Required in v1 (UI defaults to 365 days; max 3650 days). Rejected at auth with `401` once past |
| `revokeAt`      | `integer` (mode: `timestamp`) |                                                      | Scheduled future revocation. Set by the **rotate** action to `now + 7d`. The scheduled handler sweeps tokens where `revokeAt < now AND revokedAt IS NULL` |
| `revokedAt`     | `integer` (mode: `timestamp`) |                                                      | Soft-delete timestamp. Once set, the token is rejected at auth with `401`; the row is retained for audit   |
| `rotatedToId`   | `text`                        | **FK** -> `api_token.id` (self-reference)            | Points from the old token to its rotated sibling, preserving the audit lineage across rotations            |
| `createdAt`     | `integer` (mode: `timestamp`) | `NOT NULL`                                           | Creation timestamp                                                                                         |

**Indexes:** `(userId)`, `(workspaceId)`, `(revokeAt)` (drives the scheduled revocation sweep efficiently)

**Why this shape:**

- **Hash, not plaintext.** Modeled on GitHub, Stripe, and Linear. Plaintext is shown to the user exactly once at creation; thereafter only the SHA-256 hash exists in the DB. Limits the blast radius of any DB exfil.
- **Scope strings in a JSON array, not bitmasks.** Self-describing, evolvable across versions without a migration, debuggable when inspecting raw rows. The bitmask "performance win" is illusory once the row has already been fetched.
- **Opaque tokens looked up in the DB, not signed JWTs.** Allows instant revocation, scope updates without reissuing the secret, and a centralized audit trail. JWT-style tokens require a denylist anyway, which is just an opaque-token lookup with extra cryptographic steps.
- **Soft delete via `revokedAt`.** A hard delete would drop activity attribution and `lastUsedAt` history. The UI filters revoked rows out by default and lets ops view them under a "Revoked" tab.
- **`revokeAt` separate from `revokedAt`.** Lets rotation schedule a future revocation while the old token continues to work during the 7-day grace window. The scheduled handler that runs every 5 minutes closes the gap.

See [API Tokens](../api/api-tokens.md) for the full lifecycle, scope reference, and security best practices.

#### `auditLog`

**File:** `src/db/schema/audit-log.ts`

The cross-resource ledger of mutations made through a Personal Access Token. `taskActivity` is the user-facing changelog for one task; `auditLog` answers the operator's question — "what has this integration done?" — across every resource a PAT can touch (projects, workspaces, labels, teams, webhooks, invitations, attachments, and the token-management endpoints themselves), which is the question that has to be answerable before deciding whether to revoke a token.

| Column         | Type                          | Constraints                                        | Description                                                                                                                              |
| -------------- | ----------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `text`                        | **Primary key**                                    | Unique audit-row identifier                                                                                                              |
| `workspaceId`  | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade)     | Tenant partition — every audit query is scoped to one workspace                                                                          |
| `actorUserId`  | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)          | The human the token was minted under. Not nullable, so attribution survives even if the token row is later deleted                        |
| `apiTokenId`   | `text`                        | **FK** -> `api_token.id` (set null)                | The token used. `set null` rather than cascade so deleting a token cannot erase its own trail — the row becomes "via a deleted token"     |
| `resourceType` | `text`                        | `NOT NULL`                                         | Resource family (e.g. `"project"`, `"task"`), derived from the matched route pattern by the audit middleware                              |
| `resourceId`   | `text`                        |                                                    | The specific resource, when the route names one                                                                                          |
| `action`       | `text`                        | `NOT NULL`                                         | Verb: `create` / `update` / `delete` for collection and item mutations, plus route-specific verbs such as `complete` or `rotate`          |
| `method`       | `text`                        | `NOT NULL`                                         | Raw HTTP method, retained so an investigator can reconstruct the request even if the derivation logic changes later                       |
| `path`         | `text`                        | `NOT NULL`                                         | Raw request path, retained for the same reason                                                                                           |
| `status`       | `integer`                     | `NOT NULL`                                         | Response status, captured **after** the handler runs — only successful requests are persisted, so failures do not pollute the trail       |
| `metadata`     | `text`                        |                                                    | JSON-encoded route params that supplement the resource pointer. `TEXT` keeps the column schema-flexible as new routes are added           |
| `createdAt`    | `integer` (mode: `timestamp`) | `NOT NULL`                                         | When the mutation happened                                                                                                               |

**Indexes:** `(workspaceId, createdAt)`, `(apiTokenId, createdAt)`, `(resourceType, resourceId)`, `(actorUserId, createdAt)` — one per audit question that matters ("this workspace's trail", "everything this token did", "who touched this resource", "everything this person did"). Reverse-chronological reads are the common case, so each composite index leads with the grouping column and trails with `createdAt` for a fast range scan.

**Why one denormalised ledger rather than per-resource activity tables:** the query the table exists to serve is "everything this token touched, regardless of resource type", which is one `SELECT` here and a `UNION` over every resource table otherwise. The audited surface is also open-ended — each new resource is a new thing to audit — and a single ledger absorbs new resource types without a schema migration.

#### `calendarFeedToken`

**File:** `src/db/schema/calendar-feed-token.ts`

The credential behind per-user ICS calendar subscription URLs — a deliberately separate credential class from `apiToken`, **not** a PAT.

| Column        | Type                          | Constraints                                                  | Description                                                                                                                                                            |
| ------------- | ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `text`                        | **Primary key**                                              | Unique token identifier                                                                                                                                               |
| `userId`      | `text`                        | `NOT NULL`, **FK** -> `user.id` (cascade)                    | Owning user. Feed contents are scoped to this user                                                                                                                    |
| `workspaceId` | `text`                        | `NOT NULL`, **FK** -> `workspace.id` (cascade)               | The workspace whose tasks the feed exposes                                                                                                                            |
| `tokenHash`   | `text`                        | `NOT NULL`, `UNIQUE`                                         | HMAC-SHA256 (peppered with `TOKEN_HASH_PEPPER`, same primitive as PATs) of the plaintext feed token. The plaintext is **never** persisted — a DB exfil yields hashes, not usable feed URLs, because verifying a guess offline also needs the server-side pepper |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                                   | Creation timestamp                                                                                                                                                    |
| `lastUsedAt`  | `integer` (mode: `timestamp`) |                                                              | Updated when a calendar client fetches the feed                                                                                                                       |

**Indexes:** unique index on (`tokenHash`), unique index on (`userId`, `workspaceId`) — pins one live feed per user per workspace, so "regenerate" is a replace-the-row that atomically revokes the old URL.

**Why a separate table and credential class (not a PAT):**

- **Capability URL, weak custody.** Calendar clients (Google, Apple, Outlook) subscribe by URL and cannot send `Authorization` headers, so the secret must live in the URL itself. Those URLs are stored in plaintext by the provider's servers and appear in request logs — a far weaker custody story than a header-borne PAT. Reusing a PAT here would put a write-capable, scoped API credential into that weak-custody channel.
- **Single-purpose by construction.** Feed tokens use the distinct `cdn_cal_` prefix and `verifyToken` cheap-rejects anything that is not `cdn_pat_`-prefixed, so a leaked feed URL can only ever unlock the read-only ICS feed endpoint — never a bearer-auth API call.
- **Revocable without collateral damage.** Rotating a feed token never breaks the user's PAT-driven automations, and vice versa. The plaintext is minted via the shared `mintToken(prefix, pepper)` primitive in `src/api/lib/api-tokens.ts` (the single source of truth for token generation across credential classes), so its entropy and storage-hash properties are identical to a PAT's.

### Relationships

- `session.userId` -> `user.id` (foreign key, cascade delete)
- `account.userId` -> `user.id` (foreign key, cascade delete)
- `upload.userId` -> `user.id` (foreign key, set null on delete)
- `workspace.ownerId` -> `user.id` (foreign key, cascade delete)
- `workspaceMember.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `workspaceMember.userId` -> `user.id` (foreign key, cascade delete)
- `workspaceMember.invitedBy` -> `user.id` (foreign key, set null on delete)
- `team.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `teamMember.teamId` -> `team.id` (foreign key, cascade delete)
- `teamMember.userId` -> `user.id` (foreign key, cascade delete)
- `project.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `projectMember.projectId` -> `project.id` (foreign key, cascade delete)
- `projectMember.userId` -> `user.id` (foreign key, cascade delete)
- `taskGroup.projectId` -> `project.id` (foreign key, cascade delete)
- `task.projectId` -> `project.id` (foreign key, cascade delete)
- `task.taskGroupId` -> `taskGroup.id` (foreign key, restrict delete)
- `task.assigneeId` -> `user.id` (foreign key, set null on delete)
- `task.completedBy` -> `user.id` (foreign key, set null on delete)
- `subtask.taskId` -> `task.id` (foreign key, cascade delete)
- `comment.taskId` -> `task.id` (foreign key, cascade delete)
- `comment.authorId` -> `user.id` (foreign key, set null on delete)
- `taskActivity.taskId` -> `task.id` (foreign key, cascade delete)
- `taskActivity.actorId` -> `user.id` (foreign key, set null on delete)
- `label.projectId` -> `project.id` (foreign key, cascade delete)
- `taskAttachment.taskId` -> `task.id` (foreign key, cascade delete)
- `taskAttachment.uploadId` -> `upload.id` (foreign key, cascade delete)
- `taskLabel.taskId` -> `task.id` (foreign key, cascade delete)
- `taskLabel.labelId` -> `label.id` (foreign key, cascade delete)
- `savedView.projectId` -> `project.id` (foreign key, cascade delete)
- `savedView.creatorId` -> `user.id` (foreign key, cascade delete)
- `notification.userId` -> `user.id` (foreign key, cascade delete)
- `notification.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `notification.projectId` -> `project.id` (foreign key, cascade delete)
- `notification.taskId` -> `task.id` (foreign key, cascade delete)
- `notification.commentId` -> `comment.id` (foreign key, cascade delete)
- `notification.invitationId` -> `invitation.id` (foreign key, cascade delete)
- `notification.actorId` -> `user.id` (foreign key, set null on delete)
- `invitation.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `invitation.invitedBy` -> `user.id` (foreign key, set null on delete)
- `webhook.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `webhook.projectId` -> `project.id` (foreign key, cascade delete)
- `webhookDelivery.webhookId` -> `webhook.id` (foreign key, cascade delete)
- `legalAcceptance.userId` -> `user.id` (foreign key, cascade delete)
- `apiToken.userId` -> `user.id` (foreign key, cascade delete)
- `apiToken.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `apiToken.rotatedToId` -> `apiToken.id` (foreign key, self-reference)
- `taskActivity.apiTokenId` -> `apiToken.id` (foreign key, set null on delete — so historical attribution survives token deletion)
- `calendarFeedToken.userId` -> `user.id` (foreign key, cascade delete)
- `calendarFeedToken.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `auditLog.workspaceId` -> `workspace.id` (foreign key, cascade delete)
- `auditLog.actorUserId` -> `user.id` (foreign key, cascade delete)
- `auditLog.apiTokenId` -> `apiToken.id` (foreign key, set null on delete — so a deleted token cannot erase its own audit trail)

The `user`, `session`, `account`, and `verification` tables are managed by **Better Auth** and follow its expected schema conventions. The `upload` table is application-managed. The `workspace`, `workspaceMember`, `team`, `teamMember`, `project`, `projectMember`, `taskGroup`, `task`, `subtask`, `comment`, `taskActivity`, `taskAttachment`, `label`, `taskLabel`, `savedView`, `notification`, `invitation`, `webhook`, `webhookDelivery`, `legalAcceptance`, `apiToken`, and `auditLog` tables are application-managed.

#### What the foreign keys do *not* cover: member removal

Every relationship above is a database-level rule about **row deletion**, and reading them as a model of *access* revocation gets one important case wrong. `projectMember.userId` and `teamMember.userId` cascade when the **`user` row** is deleted. Neither has any relationship to `workspaceMember` at all, so deleting a `workspaceMember` row cascades to nothing: the FK graph has no edge that could express "this person lost their footing in this workspace".

That gap is closed in the handler, not in the schema. `removeMember` in `src/api/routes/workspaces/workspaces.handlers.ts` issues three explicit deletes in a single `db.batch` — which D1 runs as one implicit transaction — so removing a workspace member also revokes:

1. their `projectMember` rows for every project in that workspace,
2. their `teamMember` rows for every team in that workspace,
3. the `workspaceMember` row itself, which is ordered **last** so the first two statements can still test the membership they are predicated on.

Scoping is by subquery (`projectId IN (SELECT id FROM project WHERE workspaceId = ?)`), which both keeps the blast radius to the one workspace — the same user's memberships elsewhere are untouched — and avoids D1's bound-parameter ceiling on workspaces with many projects. Batching all three matters for the same reason the ordering does: a partial revocation that dropped the membership row while leaving project grants alive would look like offboarding in the UI while still granting read, write and export on those projects.

Two consequences worth holding on to when reasoning about this data:

- **A raw `DELETE` against `workspace_member` does not offboard anyone.** Direct SQL, a future handler, or a fixture that removes only that row leaves the project and team grants intact. Route removals through the handler.
- **Deleting the `workspace` row *is* complete**, because `project`, `team`, and `workspaceMember` all cascade from it, and `projectMember` / `teamMember` cascade from `project` / `team` in turn.

For rows that predate this cascade, or that some future path orphans anyway, `resolveProjectAccess` in `src/api/lib/access.ts` re-checks workspace membership at read time rather than trusting a `projectMember` row on its own.

### Role & Status Types

While `role`, `status`, `priority`, and similar columns are stored as `text` in SQLite, the application enforces strict enum types defined in `src/shared/types/roles.ts`:

| Type | Values | Used by |
| --- | --- | --- |
| `WorkspaceRole` | `"owner"`, `"admin"`, `"member"` | `workspaceMember.role` |
| `ProjectRole` | `"admin"`, `"member"`, `"viewer"` | `projectMember.role` |
| `TeamRole` | `"lead"`, `"member"` | `teamMember.role` |
| `TaskPriority` | `"urgent"`, `"high"`, `"medium"`, `"low"`, `"none"` | `task.priority` |
| `ProjectStatus` | `"active"`, `"archived"`, `"completed"` | `project.status` |
| `InvitationStatus` | `"pending"`, `"accepted"`, `"expired"`, `"revoked"` | `invitation.status` |
| `WebhookEventType` | 24 event types across 4 domains: `task.*` (11), `project.*` (7), `workspace.*` (3), `invitation.*` (3) | `webhookDelivery.event`, `webhook.events` (JSON array) |

These types are used in the Hono environment (`src/api/env.ts`), frontend contexts (`ProjectContext`, `WorkspaceContext`), and Zod validation schemas to ensure type safety across the stack. Webhook event types are defined in `src/shared/types/webhook.ts`.
