# File Storage (R2)

## Overview

The file storage service (`src/api/lib/storage.ts`) provides an abstraction over Cloudflare R2 for storing and retrieving binary objects (images, documents, etc.). Upload endpoints return 503 when the R2 binding is not configured.

## Architecture

```
src/api/lib/storage.ts                    # R2 storage helpers
src/api/routes/uploads/
├── uploads.routes.ts                      # Avatar upload, file serve and delete route definitions
├── uploads.handlers.ts                    # Avatar upload, file serve and delete handler implementations
└── uploads.handlers.test.ts              # Integration tests (Miniflare D1 + R2)
src/api/routes/projects/
├── projects.routes.ts                     # Includes project cover upload/delete routes
└── projects.handlers.ts                   # Includes project cover handler implementations
src/api/routes/tasks/
├── tasks.routes.ts                        # Includes task cover upload/delete routes
├── tasks.handlers.ts                      # Re-export barrel for handlers/
├── handlers/
│   └── cover-image.ts                     # Task cover image upload/delete handler implementations
├── attachments.handlers.ts                # Task file attachment handlers (upload, list, delete)
└── attachments.handlers.test.ts           # Attachment handler tests
src/shared/schemas/upload.ts               # Validation constants and Zod schemas (images)
src/shared/schemas/attachment.ts           # Attachment validation constants (allowed types, size, count limits)
src/db/schema/uploads.ts                   # Upload table schema
src/db/schema/task-attachment.ts           # Task attachment join table schema
```

## Storage Helpers

**Source:** `src/api/lib/storage.ts`

### `generateObjectKey(purpose, userId, filename)`

Generates a unique R2 object key in the format `{purpose}/{userId}/{uuid}{ext}`.

### `putObject(storage, key, body, metadata)`

Stores a binary object in R2 with content type and filename metadata.

### `getObject(storage, key)`

Retrieves an object from R2. Returns `null` if not found.

### `deleteObject(storage, key)`

Deletes an object from R2.

## Upload Endpoints

### `PUT /api/users/me/avatar`

Uploads a user avatar image. Requires authentication. Rate-limited to 10 requests per minute.

**Request:** `multipart/form-data` with a `file` field.

**Constraints:**
- Allowed types: JPEG, PNG, GIF, WebP
- Maximum size: 2 MB

**Behavior:**
1. Validates the file type and size.
2. Looks up the user's previous avatar (if any) but does **not** delete it yet.
3. Uploads the new file to R2 under `avatar/{userId}/{uuid}{ext}`. If the R2 upload fails, returns 500 and the old avatar remains intact.
4. Creates a record in the `upload` table and updates the user's `image` field to the new avatar URL. If either DB write fails, the orphaned R2 object and any partial upload record are cleaned up before returning 500.
5. Deletes the old avatar from R2 and the database only **after** the new one is fully saved. Cleanup errors are swallowed to avoid failing the overall request.

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

**Error responses:**

| Status | Condition |
| --- | --- |
| 400 | No file provided, invalid file type, or file too large |
| 401 | Not authenticated |
| 403 | API-token request missing the `attachment:write` scope |
| 429 | Rate limit exceeded |
| 500 | R2 upload failed or database write failed (with automatic cleanup) |
| 503 | R2 storage binding not configured |

### `PUT /api/projects/:projectId/cover`

Uploads a project cover image. Requires authentication and project admin role. Rate-limited to 10 requests per minute.

**Request:** `multipart/form-data` with a `file` field.

**Constraints:**
- Allowed types: JPEG, PNG, GIF, WebP
- Maximum size: 5 MB

**Behavior:**
1. Validates the file type and size.
2. Looks up the project's previous cover image (if any) but does **not** delete it yet.
3. Uploads the new file to R2 under `project-cover/{userId}/{uuid}{ext}`. If the R2 upload fails, returns 500 and the old cover remains intact.
4. Creates a record in the `upload` table and atomically writes `coverImageKey = <new key>` AND `coverUnsplash = null` on the project, preserving the XOR invariant between the two cover sources. If either DB write fails, the orphaned R2 object and any partial upload record are cleaned up before returning 500.
5. Deletes the old R2 cover from R2 and the database only **after** the new one is fully saved (no-op when the prior source was an Unsplash payload). Cleanup errors are swallowed to avoid failing the overall request.

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

Removes a project's cover image (R2 or Unsplash). Idempotent -- returns success even if no cover exists. Clears both `coverImageKey` and `coverUnsplash` atomically; when an R2 cover existed, also deletes the R2 object and removes the upload record. The R2 storage binding is only required when an R2 cover actually exists (pure Unsplash covers delete without `STORAGE`). See also [`PUT /api/projects/:projectId/cover/unsplash`](./endpoints.md#put-apiprojectsprojectidcoverunsplash) in the endpoints reference.

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project admin |
| 404 | Project not found |
| 503 | R2 storage binding not configured |

### `PUT /api/tasks/:taskId/cover`

Uploads a task cover image. Requires authentication and project membership. Rate-limited to 10 requests per minute. Follows the same upload-then-swap pattern as avatar and project cover uploads.

**Request:** `multipart/form-data` with a `file` field.

**Constraints:**
- Allowed types: JPEG, PNG, GIF, WebP
- Maximum size: 5 MB

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

Removes a task's cover image (R2 or Unsplash). Idempotent -- returns success even if no cover exists. Clears both `coverImageKey` and `coverUnsplash` atomically; when an R2 cover existed, also deletes the R2 object and removes the upload record. The R2 storage binding is only required when an R2 cover actually exists (pure Unsplash covers delete without `STORAGE`). See also [`PUT /api/tasks/:taskId/cover/unsplash`](./endpoints.md#put-apitaskstaskidcoverunsplash) in the endpoints reference.

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project member |
| 404 | Task not found |
| 503 | R2 storage binding not configured |

### `GET /api/uploads/:purpose/:userId/:filename`

Serves a stored file. Requires authentication, and — for every purpose except `avatar` — authorization against the resource that owns the object, using the same permission rules as the rest of the API. Knowing the URL is never sufficient on its own. Rate-limited to 100 requests per minute.

| Purpose | Who may read it | How it is resolved |
| --- | --- | --- |
| `task-attachment` | Anyone with access to the owning task's project (`admin`, `member` or `viewer`, including workspace owners/admins by elevation) | `upload.key` → `task_attachment` → `task` → `resolveTaskAccess` |
| `task-cover` | Same as above | `task.cover_image_key` → `resolveTaskAccess` |
| `project-cover` | Anyone with access to the project | `project.cover_image_key` → `resolveProjectAccess` |
| `avatar` | Any signed-in user | Not object-authorized by design — see below |
| anything else | Nobody | Unenumerated purposes fail closed |

Cover ownership is resolved from the row that references the key, which only works as authorization because **no client can choose what its own row claims**. Covers are set exclusively through the dedicated cover endpoints (`PUT /api/projects/:projectId/cover`, `PUT /api/tasks/:taskId/cover`, and their Unsplash counterparts), which write a key the server has just generated for the caller's own upload.

`coverImageKey` is therefore **not accepted** by `PATCH /api/projects/:projectId` or `PATCH /api/tasks/:taskId`. It is absent from `updateProjectSchema` / `updateTaskSchema` (`src/shared/schemas/project.ts`, `src/shared/schemas/task.ts`) and from both handlers' update objects. Both schemas are non-strict, so a payload that still sends the field gets **200 with the field ignored** — it is not rejected with a 400, and the stored cover is unchanged. Clients that need to change a cover must call the cover endpoints. (Every other path that touches the column — project/task duplicate, workspace import, recurring-instance spawn, and cover delete — writes `null`. `coverImagePosition`, a 0–100 framing offset with no authorization meaning, remains PATCHable.)

The uploader tie-break stands behind that invariant as its enforcement: if two rows ever claim the same object, the tie is broken by the object's uploader (`upload.userId`, which no API can rewrite) — the owner is the claiming row the uploader can actually reach, since they uploaded the cover to it. A single uncontested claim is honoured without consulting the uploader, so a cover keeps working after its uploader leaves the workspace. If the uploader can reach several claims, or none, the key is ambiguous and nobody is served.

Avatars are deliberately different: an avatar is written to `user.image` and already embedded in every payload that names a person (member rosters, comment authors, assignees, activity actors), so the URL is disclosed to anyone entitled to see that person and re-checking it per `<img>` would buy nothing. They remain behind authentication, so they are visible to signed-in users only.

**API-token callers.** Requests authenticated with a Personal Access Token need the `attachment:read` scope to download a file, and `attachment:write` to upload or delete one — including for `purpose = "avatar"`, since a machine credential asking for file bytes should have to say it wants file access whichever bucket they sit in. (There is no `attachment:delete` in the v1 scope grammar, so `DELETE` falls under `attachment:write`.) Human, cookie-authenticated requests are unaffected: the scope middleware no-ops without a token, so avatars stay readable by any signed-in user.

On top of the scope check, a PAT gets the same object-level check as a human plus the token's own narrowing: a token bound to another workspace, or restricted to a `selected` project list that does not include the owning project, is refused even when its human owner has access. See [API Tokens](./api-tokens.md) for the scope grammar and project scoping.

Cache directives follow the same split. Private purposes are served with `Cache-Control: private, max-age=31536000, immutable` — the browser still caches the object for a year (keys are UUID-based and never rewritten) but shared caches and proxies must not store a per-user-authorized response. Avatars keep `Cache-Control: public, max-age=31536000, immutable`.

For `task-attachment` uploads with non-image content types, sets `Content-Disposition: attachment` to force download and prevent browser execution of potentially unsafe files.

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | API-token request missing the `attachment:read` scope (`Insufficient scope: requires attachment:read`) |
| 404 | File not found in R2, **or** the caller is not authorized to read it |
| 429 | Rate limit exceeded |
| 503 | R2 storage binding not configured |

The 404-not-403 on the unauthorized case is deliberate. These URLs are unguessable capabilities rather than addressable ids, so a 403 would confirm "this object exists and belongs to someone else" to anyone holding a URL that leaked through a browser history, referrer header or log line. The uniform 404 gives back exactly one bit — "this URL works" or "it does not" — matching the [calendar feed](./endpoints.md) handler's treatment of its token URLs.

### `DELETE /api/uploads/:id`

Deletes an upload. Requires authentication. Only the file owner can delete. API-token requests need the `attachment:write` scope (there is no `attachment:delete` in the v1 grammar).

**Response** (200):

```json
{ "ok": true }
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not the file owner, or an API-token request missing the `attachment:write` scope |
| 404 | Upload record not found |
| 503 | R2 storage binding not configured |

## Validation Schemas

**Source:** `src/shared/schemas/upload.ts`

| Export | Description |
| --- | --- |
| `ALLOWED_IMAGE_TYPES` | `["image/jpeg", "image/png", "image/gif", "image/webp"]` |
| `MAX_AVATAR_SIZE` | `2 * 1024 * 1024` (2 MB) |
| `MAX_UPLOAD_SIZE` | `5 * 1024 * 1024` (5 MB) |
| `avatarUploadSchema` | Zod schema validating a `File` against `ALLOWED_IMAGE_TYPES` and `MAX_AVATAR_SIZE` |
| `uploadSchema` | Zod schema validating a `File` against `MAX_UPLOAD_SIZE` |

**Source:** `src/shared/schemas/attachment.ts`

| Export | Description |
| --- | --- |
| `ALLOWED_ATTACHMENT_TYPES` | Images (JPEG, PNG, GIF, WebP), documents (PDF, Word, Excel, PowerPoint), text (plain, CSV, Markdown), archives (ZIP) |
| `MAX_ATTACHMENT_SIZE` | `10 * 1024 * 1024` (10 MB) |
| `MAX_ATTACHMENTS_PER_TASK` | `20` |

## Environment

The R2 bucket binding must be configured in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "your-bucket-name"
```

The `STORAGE` binding is typed as `R2Bucket` in `src/api/env.ts` (`AppBindings.STORAGE`). When the binding is absent, all upload endpoints return 503.
