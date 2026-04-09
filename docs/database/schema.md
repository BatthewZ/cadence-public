# Schema

All table definitions live in `src/db/schema/`. The barrel file `src/db/schema/index.ts` re-exports everything:

```ts
export * from "./auth";
export * from "./invitation";
export * from "./label";
export * from "./legal-acceptance";
export * from "./notification";
export * from "./project";
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

**Indexes:** unique on (`ownerId`, `slug`) — slugs are unique per owner, not globally

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
| `coverImageKey` | `text`                        |                                                | R2 object key for the project cover image      |
| `coverImagePosition` | `integer`               |                                                | Vertical position of the cover image (0–100)   |
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

**Indexes:** index on `projectId`, composite index on (`projectId`, `updatedAt`)

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
| `dueDate`     | `integer` (mode: `timestamp`) |                                                   | Task due date                                    |
| `cost`          | `integer`                     |                                                   | Task cost in cents (nullable, optional)            |
| `icon`          | `text`                        |                                                   | Task icon (e.g. emoji or icon identifier)          |
| `coverImageKey` | `text`                        |                                                   | R2 object key for the task cover image             |
| `coverImagePosition` | `integer`               |                                                   | Vertical position of the cover image               |
| `recurrenceRule` | `text`                     |                                                   | JSON-encoded recurrence rule (frequency, interval, etc.) |
| `recurrenceParentId` | `text`                  | **FK** -> `task.id` (set null), unique (non-null) | References the parent task in a recurrence chain |
| `recurrenceSeriesId` | `text`                  |                                                   | Groups all tasks belonging to the same recurrence series |
| `position`    | `text`                        | `NOT NULL`                                        | Fractional index for ordering within group       |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                        | Creation timestamp                               |
| `updatedAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                        | Last update timestamp                            |

**Indexes:** index on (`assigneeId`, `dueDate`), index on (`taskGroupId`, `position`), index on (`projectId`, `completed`), composite index on (`projectId`, `assigneeId`), composite index on (`projectId`, `dueDate`, `completed`), composite index on (`projectId`, `updatedAt`), index on (`recurrenceParentId`), unique index on (`recurrenceParentId`) where non-null, index on (`recurrenceSeriesId`)

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

**Indexes:** index on `taskId`

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
| `id`        | `text`                        | **Primary key**                            | Unique activity entry identifier             |
| `taskId`    | `text`                        | `NOT NULL`, **FK** -> `task.id` (cascade)  | References the parent task                   |
| `actorId`   | `text`                        | **FK** -> `user.id` (set null)             | References the user who performed the action |
| `action`    | `text`                        | `NOT NULL`                                 | Action type (e.g. `"completed"`, `"moved"`, `"reopened"`, `"comment_added"`, `"comment_updated"`, `"comment_deleted"`, `"label_added"`, `"label_removed"`, `"attachment_added"`, `"attachment_removed"`, `"recurrence_changed"`, `"recurrence_removed"`) |
| `field`     | `text`                        |                                            | Field that was changed (e.g. `"taskGroupId"`, `"priority"`) |
| `oldValue`  | `text`                        |                                            | Previous value of the changed field          |
| `newValue`  | `text`                        |                                            | New value of the changed field               |
| `createdAt` | `integer` (mode: `timestamp`) | `NOT NULL`                                 | Activity timestamp                           |

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
| `email`       | `text`                        | `NOT NULL`                                     | Email address of the invitee                  |
| `role`        | `text`                        | `NOT NULL`, default `"member"`                 | Role granted upon acceptance                  |
| `invitedBy`   | `text`                        | **FK** -> `user.id` (set null)                 | References the user who sent the invite       |
| `token`       | `text`                        | `NOT NULL`, `UNIQUE`                           | Unique invitation token                       |
| `status`      | `text`                        | `NOT NULL`, default `"pending"`                | Invitation status (e.g. `"pending"`, `"accepted"`) |
| `expiresAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Invitation expiration time                    |
| `acceptedAt`  | `integer` (mode: `timestamp`) |                                                | Timestamp when accepted                       |
| `createdAt`   | `integer` (mode: `timestamp`) | `NOT NULL`                                     | Creation timestamp                            |

**Indexes:** unique on `token`, index on `workspaceId`, index on `email`

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

The `user`, `session`, `account`, and `verification` tables are managed by **Better Auth** and follow its expected schema conventions. The `upload` table is application-managed. The `workspace`, `workspaceMember`, `team`, `teamMember`, `project`, `projectMember`, `taskGroup`, `task`, `subtask`, `comment`, `taskActivity`, `taskAttachment`, `label`, `taskLabel`, `notification`, `invitation`, `webhook`, `webhookDelivery`, and `legalAcceptance` tables are application-managed.

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
| `WebhookEventType` | 25 event types across 4 domains: `task.*` (13), `project.*` (6), `workspace.*` (3), `invitation.*` (3) | `webhookDelivery.event`, `webhook.events` (JSON array) |

These types are used in the Hono environment (`src/api/env.ts`), frontend contexts (`ProjectContext`, `WorkspaceContext`), and Zod validation schemas to ensure type safety across the stack. Webhook event types are defined in `src/shared/types/webhook.ts`.
