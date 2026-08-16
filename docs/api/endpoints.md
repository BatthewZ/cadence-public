# Endpoints

## Authentication and scopes

Every endpoint below accepts either a **cookie session** (a human in a browser) or a **Personal Access Token** (a machine client), unless its entry says otherwise. The per-endpoint **Auth**, **PAT scope**, and **Authorization** lines describe three different questions, answered by three different pieces of the request path:

1. **Auth** — is there a valid credential at all?
2. **PAT scope** — was *this credential* granted the capability being used? Cookie sessions are never scope-checked; a session simply carries everything its user can do. Scopes only ever narrow, never widen: they are AND-ed with the user's real role, so a `write:*` token held by a viewer still cannot write. See [API Tokens § Scopes Reference](./api-tokens.md#scopes-reference).
3. **Authorization** — may the *person* behind the credential act on this resource? Workspace membership, workspace role, and project role.

A token additionally carries a **workspace binding** (exactly one workspace) and a **project scope** (`all`, or a selected list). Both are checked independently of scopes — the answer is "no" even when the scopes would allow it. See [API Tokens § Project Scoping](./api-tokens.md#project-scoping) and [§ Workspace Scoping](./api-tokens.md#workspace-scoping).

**Three denial shapes**, which are not interchangeable — read them as they appear per endpoint:

| Situation | Response |
|-----------|----------|
| The token lacks a required capability scope | `403 {"error": "Insufficient scope: requires <scope>"}` — the scope is named, because the caller has already proved it holds the token |
| The token's binding excludes a resource the URL names | `403 {"error": "Forbidden"}` — deliberately identical to a role or membership failure, so the response never distinguishes the two |
| The token's binding excludes rows on a list or cross-project read | **No error.** The result set is narrowed. For single-row notification and file-download lookups this surfaces as `404`, identical to a row that does not exist |

Two further rules catch people out often enough to state up front:

- **`write:*` never grants a delete scope.** Where an endpoint below lists `project:delete` or `task:delete`, that scope must be ticked individually when minting the token; neither aggregate implies it.
- **A handful of endpoints refuse token auth outright**, at any scope: the API-token management surface, the calendar-feed management surface, `GET /api/workspaces/:workspaceId/invitations/:id/link`, `GET /api/invitations/pending`, and `POST /api/invitations/accept`. A machine credential must not be able to mint or harvest another credential, and joining a workspace is a human act. Each returns `403` with a message naming the credential at stake.

## Available Endpoints

### `GET /api/health`

Health check endpoint. No authentication required.

**Response**:

```json
{ "ok": true }
```

### `GET /api/config`

Public runtime feature-flag endpoint. No authentication required — the values are non-sensitive (presence of server-side configuration) and must be readable before login so the UI can render correctly for unauthenticated visitors. Response is sent with `Cache-Control: private, max-age=300` so clients do not hammer the endpoint on SPA navigation while shared caches (e.g. Cloudflare edge) never store it.

**Response** (200):

```json
{
  "features": {
    "unsplash": true
  }
}
```

| Flag | Type | Meaning |
|------|------|---------|
| `features.unsplash` | `boolean` | `true` when `UNSPLASH_ACCESS_KEY` is configured server-side. When `false`, the web client hides the Unsplash tab in the cover picker and the `/api/unsplash/*` routes return 503. |

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

Uploads a user avatar image. Requires authentication (cookie session, or a PAT with `attachment:write` / `write:*`). Rate-limited to 10 requests per minute.

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

Serves a stored file from R2. Requires authentication. Every purpose except `avatar` is additionally authorized against the task or project that owns the file, using the same access rules as the rest of the API, and is served with `Cache-Control: private, max-age=31536000, immutable`. Avatars are readable by any signed-in user and keep `Cache-Control: public, max-age=31536000, immutable`. See [File Storage](./storage.md) for the per-purpose rules.

**PAT scope:** `attachment:read` (or `read:*` / `write:*`). Authorization and capability are separate questions: the per-purpose access check above says *whose* files the caller may see, and the scope says whether this credential was granted file access at all. The scope applies to `avatar` too — cookie sessions are unaffected (the scope middleware no-ops without a token), but a machine credential asking for file bytes has to hold a file scope whichever bucket the bytes sit in, rather than the capability layer carrying a per-purpose exception the authorization layer already owns.

**PAT project binding:** for the `task-attachment`, `task-cover`, and `project-cover` purposes the owning project is resolved from the file and checked against the token's workspace binding and selected-project list. A file outside that binding answers `404 File not found` — byte-identical to a file that does not exist, so the response never confirms which keys are real. `avatar` carries no project and is not project-bound. Rate-limited to 100 requests/minute per caller.

### `DELETE /api/uploads/:id`

Deletes an upload. Requires authentication. Only the file owner can delete. **PAT scope:** `attachment:write` — there is no `attachment:delete` in the v1 scope grammar, so deletes sit under the write scope (the same treatment `workspace` gets).

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
**PAT scope:** `workspace:read` (or `read:*` / `write:*`).
**Authorization:** Any authenticated user. For a PAT caller the list is filtered to the **token's bound workspace**, so it returns at most one entry regardless of how many workspaces the owning user belongs to. This applies to every token, `projectScope: "all"` included — it is the workspace binding, not project scope. Cookie sessions see every workspace they belong to.

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

### `GET /api/workspaces/:workspaceId/freshness`

Returns lightweight timestamps indicating when workspace-level data was last modified. Clients poll this at a moderate interval (3s, jittered ±20% per tick — see [Project Freshness](#get-apiprojectsprojectidfreshness) for why) to detect changes made by other users and selectively invalidate stale caches. Polling is only active for multi-user workspaces — single-member workspaces skip polling entirely since no other user can modify data. Responses are edge-cached (Cloudflare Cache API, 2s TTL) since freshness data is identical for all workspace members.

A `tasks` change also invalidates the per-task cache prefix, so a task detail dialog opened from the dashboard or My Tasks keeps updating while it is open.

**Auth:** Required.
**Authorization:** Workspace member.

**Response** (200):

```json
{
  "freshness": {
    "workspace": 1711900000000,
    "projects": 1711900000000,
    "tasks": 1711900000000
  }
}
```

Each value is a Unix timestamp in milliseconds (`updatedAt` epoch) or `null` if no data exists. `workspace` tracks workspace-level changes (name, settings, members). `projects` is `MAX(project.updatedAt)` across all workspace projects. `tasks` is `MAX(task.updatedAt)` across all tasks in all workspace projects.

**Headers:** `Cache-Control: public, s-maxage=2`

---

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
| `policy` | `object` | Governance toggles — see below |

**`policy`** is **merged**, not replaced. Send only the toggles you mean to
change; the rest keep their stored values. The merge happens in SQL
(`json_patch`), so two admins saving different toggles concurrently cannot
clobber each other. Unknown keys are rejected with `400` rather than ignored —
a typo that returned `200` would leave an admin certain they had changed a
setting that is still on.

| Toggle | Type | Default | Effect |
|--------|------|---------|--------|
| `allowMemberProjectCreation` | `boolean` | `true` | When `false`, workspace `member`s cannot create projects or duplicate ones they administer. Owners and admins are unaffected. |

```json
{ "policy": { "allowMemberProjectCreation": false } }
```

**Response** (200):

```json
{ "workspace": { "id": "...", "name": "...", "slug": "...", "policy": { "allowMemberProjectCreation": true }, "..." } }
```

`policy` always comes back **fully resolved** — every toggle present, defaults
already applied — so a client never needs its own copy of the defaults to
interpret the response, and never has to distinguish "unset" from "off".

**Errors:** 409 (slug already exists for this owner), 400 (unknown `policy` key).

### `DELETE /api/workspaces/:workspaceId`

Deletes a workspace and all associated data.

**Auth:** Required.
**PAT scope:** `workspace:write` (or `write:*`) — there is no `workspace:delete` in the v1 scope grammar.
**Authorization:** Workspace owner only. A PAT with `projectScope: "selected"` is **refused with `403 Forbidden`** whatever scopes it holds, and nothing is deleted. A selected-projects token is a request for a *smaller* blast radius, and this operation has no smaller version of itself — it destroys every project in the workspace, including the ones the token was never given. The guard runs before any data is read or written. Cookie sessions and `projectScope: "all"` tokens are unaffected.

**Response** (200):

```json
{ "ok": true }
```

**Errors:** 403 (not the owner, or a `projectScope: "selected"` token — the body is the same `{"error": "Forbidden"}` either way).

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
**PAT scope:** `workspace:write` (or `write:*`).
**Authorization:** Workspace owner or admin, **and** the caller must outrank the target — an admin may change plain members' roles, but only the **owner** may touch an admin's row. Granting the `admin` role is owner-only as well, matching the same rule on `POST /api/workspaces/:workspaceId/invitations`: an admin who can mint peer admins can manufacture people immune to every admin in the workspace.

**Request body** (validated via `updateMemberRoleSchema` from `src/shared/schemas/workspace.ts`):

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `role` | `string` | `z.enum(["admin", "member"])` | Yes |

**Response** (200):

```json
{ "member": { "id": "...", "workspaceId": "...", "userId": "...", "role": "admin", "..." } }
```

**Errors:** 403 (caller is not a member, target is the owner, an admin targeting another admin, or `role: "admin"` requested by a non-owner — `Only the workspace owner can grant the admin role`), 404 (member not found), 409 (`This member's role changed while you were editing. Please retry.` — the write is pinned to the role the permission check was made against, so a concurrent change is reported rather than silently applied).

### `DELETE /api/workspaces/:workspaceId/members/:userId`

Removes a member from the workspace. Cannot remove the workspace owner.

**Auth:** Required.
**PAT scope:** `workspace:write` (or `write:*`).
**Authorization:** Workspace owner or admin, **and** the caller must outrank the target: an admin may remove plain members, but only the **owner** may remove an admin. Nobody may remove themselves here. As with `DELETE /api/workspaces/:workspaceId`, a PAT with `projectScope: "selected"` is **refused with `403 Forbidden`** and nothing is written: removing someone from the workspace revokes their access to every project in it, including projects outside the token's list, so there is no narrowed version of the operation to perform. The guard runs before the membership is read, so it does not reveal whether the named user is a member.

**Behaviour:** removal revokes every grant that workspace membership was the premise for — the `workspace_member` row, all `project_member` rows for projects in this workspace, and all `team_member` rows for teams in this workspace — in one atomic batch, so a partial revocation is not reachable. Memberships in *other* workspaces are untouched.

**Response** (200):

```json
{ "ok": true }
```

**Errors:** 400 (`Cannot remove yourself from the workspace`), 403 (caller is not a member of the workspace, target is the workspace owner, an admin targeting another admin — `Only the workspace owner can remove an admin` — or a `projectScope: "selected"` token), 404 (`Member not found`).

### `GET /api/workspaces/:workspaceId/export`

Downloads a canonical, versioned JSON archive of the entire workspace (`Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>-export-<YYYY-MM-DD>.json"`). The document is defined by `workspaceExportSchema` (`src/shared/schemas/workspace-export.ts`) — the single source of truth — and contains the workspace, members, teams, webhooks, invitations, and every project with its task groups, labels, tasks, subtasks, comments, and attachment manifests. A top-level `users` ref directory resolves every referenced user id — including **ex-members** who are no longer in the workspace but who created or were assigned work — to `{ ref, email, name }`, so the archive never loses the answer to "who did this work?".

**Auth:** Required. Reachable by a `workspace:read` PAT, but only when the owning user is an owner/admin (PAT scopes are AND-ed with the user's role). A PAT with `projectScope: "selected"` is **refused with `403 Forbidden`** before any data is read — the archive is whole-workspace by definition, and a partial archive that still called itself a workspace export would be worse than none. Use the per-project [CSV export](#get-apiprojectsprojectidexportcsv) for a narrowed token.
**Authorization:** Workspace **owner or admin** only — the most privileged read in the API (full data egress).
**Rate limit:** 5 requests/hour per caller, keyed PAT > user > IP (`defaultRateLimitKey`).

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `includeActivity` | `"true"` / `"1"` | Include each task's activity history. Omitted by default — `task_activity` routinely outnumbers tasks 10–20×, so the default export stays small. When omitted, a task's `activity` field is **absent** (not `[]`), so consumers distinguish "exported without history" from "no history". |

**Secrets never serialize.** Webhook `secret` and invitation `token` are structurally excluded — every builder projects rows down to the strict (`z.strictObject`) contract fields, so a future bug that spreads a raw DB row fails the contract test loudly instead of leaking quietly. Attachments export as **manifests** (`key` + authenticated relative `url`), never binaries.

**Auditing.** Every successful export writes a row to `audit_log` via `recordWorkspaceDataEvent` (action `export`) — for cookie sessions **and** PATs alike — answering "who pulled a full copy of this workspace, and when". See [API Tokens § audit ledger](./api-tokens.md#2-data-egress--cross-resource-audit-ledger-audit_log).

The body is streamed one project at a time as a single valid JSON document, so a large workspace never materializes the full object graph and the full serialized string in the 128 MB Worker isolate simultaneously.

**Response** (200) — shape (abridged):

```json
{
  "format": "cadence.workspace",
  "formatVersion": 1,
  "exportedAt": "2026-06-12T12:00:00.000Z",
  "exportedBy": "owner@example.com",
  "workspace": { "name": "...", "slug": "...", "description": null, "theme": null },
  "users": [{ "ref": "userId", "email": "...", "name": "..." }],
  "members": [{ "userRef": "userId", "role": "owner", "joinedAt": "..." }],
  "teams": [],
  "webhooks": [],
  "invitations": [],
  "projects": [
    { "id": "...", "name": "...", "taskGroups": [], "labels": [], "tasks": [] }
  ]
}
```

### `POST /api/workspaces/:workspaceId/import`

Creates **new** projects in the workspace from an uploaded export file — the write-side counterpart of [`GET …/export`](#get-apiworkspacesworkspaceidexport). The request is `multipart/form-data` with a single `file` field containing either a **Cadence workspace export** (recognized by its `format: "cadence.workspace"` field) or a **Trello single-board JSON export** (sniffed — Trello files carry no such field). The file is converted to one canonical document and its `projects` subtree is created fresh; existing workspace content is never read for merge and never mutated. Every imported entity gets a new UUID, so an import can never collide with or overwrite anything already present. Contracts are `importPreviewSchema` / `importResultSchema` (`src/shared/schemas/workspace-import.ts`), a discriminated union over the `dryRun` literal the client sent.

**Auth:** Required. Reachable by a `workspace:write` PAT, but only when the owning user is an owner/admin (PAT scopes are AND-ed with the user's role).
**Authorization:** Workspace **owner or admin** only — a workspace-wide data ingress, gated like export's egress.
**Rate limit:** 10 requests/hour per caller, keyed PAT > user > IP (`defaultRateLimitKey`) — one notch looser than export's 5 because the stateless preview→confirm flow legitimately costs two requests per real import.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `dryRun` | `"true"` / `"1"` | Run the identical parse → validate → convert → user-match → repair pipeline with **zero writes** and return an `importPreviewSchema` body (detected format, would-create counts, unmatched users, skipped sections, warnings). The preview is **stateless** — nothing is persisted between the preview and the commit, so confirming re-uploads the same file. Omitted/false commits the import and returns `importResultSchema`. |

**User matching is email-only and member-scoped.** A file `ref` resolves through the document's `users` directory to an email, then to a member **of the target workspace** (case-insensitive). Unmatched users are not an error — their task references fall back to unassigned and each is reported with the count of references it loses. Matching never reaches platform-wide accounts, so an import cannot probe whether an email has an account. The importing user is added as admin of every created project.

**All-or-nothing per project.** Each project's graph is written in FK-ordered batches; a mid-project failure rolls the partial graph back (compensating delete) and lists that project in `failedProjects` while the remaining projects still import.

**Skipped by design** (counted, never silent): workspace metadata, members, teams, webhooks, invitations, attachment binaries, and activity history — secrets such as webhook signing keys and invitation tokens never travel at all (the export schema is strict). See the [Export & Import guide](../guides/export-import.md#what-round-trips--and-what-doesnt) for the full round-trip table and the Trello field mapping.

**Auditing.** A successful **commit** writes one `audit_log` row via `recordWorkspaceDataEvent` (action `import`, with the created counts and rolled-back-project count); dry runs write nothing, because a preview is not an ingress event. See [API Tokens § audit ledger](./api-tokens.md#2-data-egress--cross-resource-audit-ledger-audit_log).

**Errors:** `413` when the file exceeds **20 MB** (checked on byte length *before* any decode/parse); `400` for a non-multipart body, a missing `file` field, malformed JSON, an unrecognized format, or a document that fails schema/referential-integrity validation — the response carries an `errors[]` array of human-readable lines (e.g. `projects[0].tasks[2].title: …`) locating the offending value.

**Response** (200) — commit, shape (abridged):

```json
{
  "dryRun": false,
  "sourceFormat": "cadence",
  "counts": { "projects": 3, "taskGroups": 9, "tasks": 142, "labels": 7, "subtasks": 38, "comments": 21 },
  "unmatchedUsers": [{ "email": "ex@example.com", "name": "Ex Teammate", "taskCount": 12 }],
  "skipped": { "webhooks": 2, "teams": 1, "invitations": 0, "attachments": 5, "activity": 0, "closedItems": 0 },
  "warnings": ["…"],
  "failedProjects": [{ "name": "Roadmap", "error": "…" }]
}
```

A dry-run response (`?dryRun=true`) is identical minus `failedProjects` — nothing executed, so nothing can have failed — and with `"dryRun": true`.

### Personal Access Token management

Five further endpoints live under `/api/workspaces/:workspaceId/api-tokens` — list, mint, get, rotate, and revoke. They are documented in full in [API Tokens](./api-tokens.md), including the token format, the scope reference, project scoping, expiry, and the 7-day rotation grace period.

All five are **cookie-session only**: a PAT calling any of them gets `403 API tokens cannot manage other tokens`, whatever scopes it holds. A machine credential that could mint or read its siblings could quietly widen its own reach or outlive its own revocation, so the boundary is drawn at the credential class rather than at a scope. They are also rate-limited to 20 requests/minute per caller and sent `Cache-Control: no-store`.

**Authorization** splits the five: list, get and revoke require workspace membership, while **mint and rotate require the workspace `owner` or `admin` role** — issuing a credential is an administrative act, and gating rotate alongside mint is what stops a demoted member from renewing a token indefinitely. Rotate additionally requires the caller to be the token's own owner. A plain member therefore keeps read and revoke over their own tokens and gets `403` on the other two.

---

## Projects

### `POST /api/workspaces/:workspaceId/projects`

Creates a new project within a workspace. The creator is automatically added as a project admin. Three default task groups ("To Do", "In Progress", "Done") are created, with "Done" marked as the completion group (`isCompletionGroup: true`).

**Auth:** Required.
**Authorization:** Workspace member, **subject to the workspace's `allowMemberProjectCreation` policy**. Owners and admins may always create. A `member` may create only while that toggle is on (its default); when an admin turns it off, a member's request answers **403** `{"error": "Only workspace owners and admins can create projects in this workspace"}`.

> The 403 here deliberately explains itself, unlike the deliberately-generic 403s from the membership and PAT-scope guards. There is nothing to conceal: the caller has already proved workspace membership, and the policy is their own workspace's configuration, visible to their admins in **Workspace Settings > Member Permissions**. A bare "Forbidden" would send an integrator hunting for a scope or membership bug instead of reading the setting.

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
**PAT scope:** `project:read` (or `read:*` / `write:*`).
**Authorization:** Workspace member. A PAT with `projectScope: "selected"` sees only its selected projects — the list is narrowed rather than refused, so a correctly-narrowed integration gets its own projects and a mis-scoped one gets an obviously short list instead of what looks like a permissions outage.

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

### `GET /api/projects/:projectId/freshness`

Returns lightweight timestamps indicating when each entity type in a project was last modified. Clients poll this at short intervals (1.5s, jittered ±20% per tick) and selectively refetch only the data that changed. Polling is only active for multi-user workspaces — single-member workspaces skip polling entirely since no other user can modify data. Responses are edge-cached (Cloudflare Cache API, 2s TTL) since freshness data is identical for all project viewers.

**Why the interval is jittered.** This endpoint is cheap, but what it triggers is not: every viewer of a project detects the same mutation inside the same poll window and then fires the same follow-up refetches (tasks, members, labels) within milliseconds of each other, and those reads miss the edge cache. Randomizing the interval spreads detection, which spreads the stampede. The delay is re-rolled on every tick rather than fixed per client, because a fixed offset leaves N clients on N perfectly periodic timers and any alignment they drift into would persist. See `src/web/lib/poll-interval.ts`.

Because the payload is a single `MAX(updatedAt)` per entity type, it cannot say *which* task changed. A `tasks` change therefore invalidates both the project's task list and the per-task cache prefix (`["tasks"]`), which is what keeps an open task detail panel live. Invalidation defaults to refetching only *active* queries, so this costs one refetch for the open panel and merely marks the rest stale.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Response** (200):

```json
{
  "freshness": {
    "project": 1711900000000,
    "tasks": 1711900000000,
    "taskGroups": 1711900000000
  }
}
```

Each value is a Unix timestamp in milliseconds (`updatedAt` epoch) or `null` if no data exists. `project` tracks project-level changes (name, labels, members). `tasks` is `MAX(task.updatedAt)` across all tasks in the project. `taskGroups` is `MAX(taskGroup.updatedAt)` across all task groups.

**Headers:** `Cache-Control: public, s-maxage=2`

---

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
| `coverImagePosition` | `number \| null` | 0–100, vertical position of cover image (applies to either cover source) |
| `theme` | `string \| null` | One of the supported theme names |
| `budget` | `number \| null` | Project budget in cents (integer, >= 0) |
| `autoAssignCreator` | `boolean` | Auto-assign new tasks to their creator |

`coverImageKey` and `coverUnsplash` are **not** accepted here — use the dedicated cover endpoints below, which enforce the XOR invariant between the two cover sources. This matters most for `coverImageKey`: because [`GET /api/uploads/...`](./storage.md#get-apiuploadspurposeuseridfilename) authorizes a `project-cover` download by matching the requested key against `project.cover_image_key`, a client-writable key would be a forgeable read capability. Nothing in the API writes a non-null `coverImageKey` except the cover upload endpoint, using a key the server just minted for the caller's own upload. (Workspace import also restores a `coverUnsplash` payload from an uploaded export; that column holds absolute Unsplash URLs rather than a key into storage, and import nulls `coverImageKey` alongside it.) Unknown fields are stripped, so sending one is ignored rather than rejected.

**Response** (200):

```json
{ "project": { "id": "...", "name": "...", "status": "...", "icon": "...", "coverImageKey": "...", "budget": 50000, "..." } }
```

### `DELETE /api/projects/:projectId`

Deletes a project and all associated data.

**Auth:** Required (cookie session or PAT with `project:delete` — neither `project:write` nor `write:*` grants it; the scope must be ticked individually when the token is minted).
**Authorization:** Project admin (or workspace owner/admin).

**Response** (200):

```json
{ "ok": true }
```

### `PATCH /api/projects/:projectId/reorder`

Updates a project's sidebar position using a fractional index key. Used by the drag-and-drop reorder in the workspace sidebar.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin.

**Request body** (JSON, validated via `reorderProjectSchema`):

| Field | Type | Description | Required |
| --- | --- | --- | --- |
| `position` | `string` | Fractional index key (generated client-side between adjacent items) | Yes |

**Response** (200):

```json
{
  "project": {
    "id": "...",
    "position": "a1",
    "..."
  }
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project member or workspace owner/admin |
| 404 | Project not found |

### `POST /api/projects/:projectId/duplicate`

Duplicates a project, creating a new copy with the name `"{original name} (copy)"`. Copies the project's settings (description, icon, budget, theme, autoAssignCreator), task groups (with positions and colors), and labels. Optionally includes members and their roles. Tasks, comments, attachments, and cover images are not copied. The duplicating user is always added as an admin on the new project.

**Auth:** Required.
**Authorization:** Project **admin** (the route mounts `requireProjectRole("admin")`; a project `member` is refused), **and** the workspace's `allowMemberProjectCreation` policy.

> **Why a creation policy applies to a "duplicate" route.** This is a project-creating path, and skipping it would make the whole toggle decorative. `POST /workspaces/:id/projects` adds its caller as project **admin**, so any member who created a project while the toggle was on still satisfies the project-admin check on that project forever — they could go on minting projects by duplicating it after an admin turned member creation off. A policy about who may bring projects into existence has to be enforced on every path that brings one into existence.
>
> Workspace import (`POST /api/workspaces/:workspaceId/import`) also creates projects and is deliberately *not* subject to this policy — it is already owner/admin-only, so the toggle could neither widen nor narrow it.

**Request body** (JSON, validated via `duplicateProjectSchema`):

| Field | Type | Description | Required |
| --- | --- | --- | --- |
| `includeMembers` | `boolean` | Whether to copy project members and their roles | No (defaults to `false`) |

**Behavior:**
1. Batch-reads the source project, task groups, labels, and members in one round-trip.
2. Creates a new project with copied settings and status set to `"active"`.
3. Copies all task groups with their positions, colors, and completion-group flags.
4. Copies all labels with their names and colors.
5. If `includeMembers` is `true`, copies members with their roles — but **only those still in the workspace**. A `project_member` row whose user has since been removed from the workspace is orphaned: it confers no access on its own, and copying it forward would mint a fresh stale row on a new project. The same rule `POST /api/projects/:projectId/members` enforces up front (`"User is not a member of the workspace"`, 400) is therefore applied here. Duplication *skips* rather than refuses, because a departed teammate is routine and invisible to whoever clicks Duplicate — a 400 would permanently brick duplication of any project someone ever left. The skipped user ids are returned in `skippedMemberIds` so the omission can be surfaced. The duplicating user is always admin regardless.
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
  },
  "skippedMemberIds": []
}
```

`skippedMemberIds` is always present. It lists source project members that were **not** copied because they are no longer members of the workspace (see behaviour step 5). It is `[]` when nothing was skipped, and always `[]` when `includeMembers` is `false`.

**Error responses:**

| Status | Condition |
| --- | --- |
| 401 | Not authenticated |
| 403 | Not a project admin or member |
| 404 | Source project not found |

### `PUT /api/projects/:projectId/cover`

Uploads a cover image for a project. Replaces any existing cover (R2 or Unsplash). Rate-limited to 10 requests per minute.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Request:** `multipart/form-data` with a `file` field (JPEG, PNG, GIF, or WebP, max 5 MB).

**Behavior:**
1. Validates the file type and size.
2. Looks up the project's previous cover image (if any) but does not delete it yet.
3. Uploads the new file to R2 under `project-cover/{userId}/{uuid}{ext}`. If the R2 upload fails, the old cover remains intact.
4. Creates a record in the `upload` table and atomically writes `coverImageKey = <new key>` AND `coverUnsplash = null` on the project, preserving the XOR invariant between the two cover sources. If either DB write fails, the orphaned R2 object and any partial upload record are cleaned up before returning 500.
5. Deletes the old R2 cover object and its upload row only after the new one is fully saved. (If the previous cover was an Unsplash payload there is no R2 artifact to delete.)

**Response** (200):

```json
{
  "upload": {
    "id": "abc123",
    "url": "/api/uploads/project-cover/userId/uuid.jpg",
    "filename": "cover.jpg",
    "mimeType": "image/jpeg",
    "size": 204800
  },
  "coverImageKey": "project-cover/userId/uuid.jpg",
  "coverUnsplash": null
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

### `PUT /api/projects/:projectId/cover/unsplash`

Applies an Unsplash-hosted photo as the project's cover image. Replaces any existing cover (R2 or Unsplash). Rate-limited to 10 requests per minute. Returns 503 when `UNSPLASH_ACCESS_KEY` is not configured.

**Auth:** Required.
**Authorization:** Project admin (or workspace owner/admin).

**Request body:** JSON payload matching `UnsplashCoverPayload` from [`src/shared/schemas/unsplash.ts`](../../src/shared/schemas/unsplash.ts) (typically the exact `result` object returned by `/api/unsplash/search` or `/api/unsplash/curated`). Includes `id`, `rawUrl`, `url`, `thumbUrl`, `width`, `height`, `color`, `blurHash`, `description`, `photoUrl`, `downloadLocation`, and `user`.

**Behavior:**
1. Validates the payload against `unsplashCoverPayloadSchema`.
2. Atomically writes `coverUnsplash = <payload>` AND `coverImageKey = null` on the project, preserving the XOR invariant between the two cover sources.
3. If the project previously had an R2 cover, deletes the old R2 object and its `upload` row AFTER the DB write succeeds. Failures here are logged but non-fatal (the entity already points at the new Unsplash payload).
4. Fires a GET against `payload.downloadLocation` via `deferWork` (outside the request lifecycle in prod, inline in tests) to comply with the Unsplash API download-tracking guideline. All tracking errors are swallowed.

**Response** (200):

```json
{
  "coverImageKey": null,
  "coverUnsplash": {
    "id": "abc123",
    "rawUrl": "https://images.unsplash.com/raw",
    "url": "https://images.unsplash.com/regular",
    "thumbUrl": "https://images.unsplash.com/thumb",
    "width": 4000,
    "height": 3000,
    "color": "#aabbcc",
    "blurHash": "...",
    "description": "A scenic landscape",
    "photoUrl": "https://unsplash.com/photos/abc123?utm_source=cadence&utm_medium=referral",
    "downloadLocation": "https://api.unsplash.com/photos/abc123/download?ixid=XXX",
    "user": { "name": "Jane Smith", "username": "janesmith", "profileUrl": "..." }
  }
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| 400 | Payload failed schema validation |
| 401 | Not authenticated |
| 403 | Not a project admin |
| 404 | Project not found |
| 429 | Rate limit exceeded |
| 500 | Database write failed |
| 503 | `UNSPLASH_ACCESS_KEY` not configured, or R2 storage missing while an R2 cover is queued for cleanup |

### `DELETE /api/projects/:projectId/cover`

Removes the cover image (R2 or Unsplash) from a project. Clears both `coverImageKey` and `coverUnsplash` atomically. Idempotent -- returns success even if no cover exists.

**Auth:** Required (cookie session or PAT with `project:delete` — the delete scope is required by HTTP method, so it applies here even though nothing but the cover is removed).
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
| 503 | R2 storage binding not configured (only required when an R2 cover exists; pure Unsplash covers delete without STORAGE) |

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

### `PATCH /api/projects/:projectId/members/:userId`

Changes an existing project member's role.

**Auth:** Required (cookie session or PAT with `project:write`).
**Authorization:** Project admin (or workspace owner/admin). Unlike the workspace equivalent there is no rank hierarchy — projects have no owner tier, so any project admin may re-role any project member. The one refusal is **your own row**: an admin cannot change their own project role, because a self-demotion is the one change the person making it cannot undo.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `role` | `string` | `z.enum(["admin", "member", "viewer"])` via `updateProjectMemberRoleSchema` | Yes |

**Response** (200):

```json
{ "member": { "id": "...", "projectId": "...", "userId": "...", "role": "admin", "addedAt": "..." } }
```

Submitting the role the member already holds is accepted as a no-op: the row is returned unchanged, the project's `updatedAt` is untouched, and **no `project.member_role_changed` webhook fires** — a change event whose `from` equals its `to` would be a lie every consumer had to filter out.

| Status | Meaning |
| --- | --- |
| 400 | `role` missing or outside `PROJECT_ROLES` |
| 403 | Not a project admin, or the target is the caller |
| 404 | No membership row for that user in this project. A workspace owner/admin who has never been added to the project has an *effective* role but no row to edit — their access is changed from the workspace members list |
| 409 | The member's role changed between the page loading and this request. The write is pinned to the role it was authorized against, so a stale choice is refused rather than applied — reload and retry |

Fires [`project.member_role_changed`](./webhooks.md#project-events-7) with a `changes` object of `{ "role": { "from": …, "to": … } }`.

### `DELETE /api/projects/:projectId/members/:userId`

Removes a member from the project.

**Auth:** Required (cookie session or PAT with `project:delete`).
**Authorization:** Project admin (or workspace owner/admin).

**Response** (200):

```json
{ "ok": true }
```

### `GET /api/projects/:projectId/export/csv`

Downloads every task in the project as a CSV spreadsheet (`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<project>.csv"`). One row per task in **board reading order** (group position, then task position). Columns: `title`, `group`, `assignee_email`, `due_date` (`YYYY-MM-DD`), `priority`, `labels` (`;`-joined, name-sorted), `completed` (`true`/`false`), and `cost` (fixed-decimal currency units, e.g. `10.50`). Unassigned tasks emit an empty `assignee_email`; tasks with no due date / cost emit empty cells.

**Auth:** Required. A `project:read` PAT may export — the CSV contains nothing a project member cannot already page through one task at a time via [`GET /api/projects/:projectId/tasks`](#get-apiprojectsprojectidtasks), so a tighter scope here would be theatre, not a control.
**Authorization:** Any project member, **including viewers**.
**Rate limit:** 30 requests/hour per caller (each export is a full project table scan).

User-controlled string cells (`title`, `group`, `labels`) are hardened against **CSV formula injection** (OWASP): a cell beginning `=`, `+`, `-`, `@`, tab, or CR is prefixed with `'` so a spreadsheet renders it as text instead of executing it. Numeric (`cost`) and boolean (`completed`) cells are typed and exempt. Hardening lives in the shared serializer — see [`toCsv`](../../src/api/lib/csv.ts).

**Response** (200) — example body:

```csv
title,group,assignee_email,due_date,priority,labels,completed,cost
"Fix login bug",In Progress,jane@example.com,2026-06-20,high,backend;urgent,false,
"Ship release",Done,,2026-06-12,medium,,true,150.00
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

### `GET /api/workspaces/:workspaceId/labels`

Lists labels across **every active project the caller can see** in the workspace, deduplicated by case-insensitive name. Intended for workspace-level filter UIs (e.g. the My Tasks label filter) where a user narrows tasks by label without caring which project a label row physically lives in. Read-only — only the label read scope is mounted on this route.

Labels are project-scoped rows and name uniqueness is only enforced case-insensitively *within* a project, so the same conceptual label (`"Bug"` in one project, `"bug"` in another) exists as distinct rows with distinct ids. For cross-project filtering the **name** is the label's identity, so rows are collapsed on `LOWER(name)` and each group reports `MIN(name)` / `MIN(color)` as a deterministic representative (stable across requests regardless of insert order). Results are ordered case-insensitively by name. Because the entries represent multiple underlying rows, the response carries **no `id`, `projectId`, `createdAt`, or `taskCount`** — only `name` and `color`.

Archived projects are excluded: their tasks no longer appear in workspace task views, so offering their labels as filter options would only produce dead filters.

**Auth:** Required.
**PAT scope:** `label:read` (or `read:*` / `write:*`).
**Authorization:** Workspace member. Owners/admins see labels from all workspace projects; non-elevated members only from projects they are a direct member of (mirrors `GET /api/workspaces/:workspaceId/task-groups` visibility), so a plain member can never enumerate label names from projects they cannot open. A PAT with `projectScope: "selected"` is narrowed to its selected projects on top of that, including when its owning user is an owner or admin.

**Response** (200):

```json
{
  "labels": [
    { "name": "Bug", "color": "#ef4444" },
    { "name": "Frontend", "color": "#3b82f6" }
  ]
}
```

When the caller can see no active projects, `labels` is `[]`.

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

## Saved Views

Private, per-user-per-project bookmarks of the task board's URL view state (active tab + filter/grouping params). The URL is the runtime source of truth; a saved view is a named snapshot a user can re-apply. Backed by `src/api/routes/projects/saved-views.handlers.ts`; the stored `state` shape and bounds live in `src/shared/schemas/saved-view.ts`.

Two authorization properties are load-bearing and pinned by the handler tests:

- **Creator scoping is the cross-user guard.** Every query filters by BOTH `projectId` AND the caller's `creatorId`. Route-level access is the lenient `requireProjectAccess()` (any project member, *including viewers* — a saved view only bookmarks read-only board state), so the real isolation is the handler's creator filter: another member's view id must be indistinguishable from a missing one. Update/delete on a teammate's (or non-existent) view therefore return **404, never 403** — a member can neither read, modify, nor even *confirm the existence of* another user's private views by guessing ids.
- **No project-freshness bump.** Unlike label mutations (which touch `project.updatedAt` so the team's freshness poller notices shared data changed), saved-view writes never touch the `project` table. Bumping it would invalidate freshness polling for the *whole team* every time one user saved a private bookmark. See [Project Freshness](#get-apiprojectsprojectidfreshness).

The `state` snapshot is `{ tab, params }`: `tab` is a bounded string (not an enum — a future client may save `"calendar"`), and `params` is a bounded **open** string-record (≤16 entries, keys 1–40 chars, values ≤500 chars). Unknown param keys are stored verbatim so a view authored by a newer client round-trips through an older server without corruption — the forward-compatibility contract.

### `GET /api/projects/:projectId/views`

Lists the **caller's** saved views for the project, ordered by fractional `position` (creation order in v1 — there is no reorder endpoint yet; position-ordering makes adding one later a pure insert-between).

**Auth:** Required.
**Authorization:** Project member (any role, including viewers).

**Response** (200):

```json
{
  "views": [
    {
      "id": "uuid",
      "projectId": "projectId",
      "creatorId": "userId",
      "name": "My urgent",
      "state": {
        "tab": "board",
        "params": { "priority": "high,urgent", "assignee": "me" }
      },
      "position": "a0",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

Returns only the authenticated user's views — never another member's, even for project admins.

### `POST /api/projects/:projectId/views`

Creates a saved view for the caller. Maximum **20 views per (project, user)**. Names must be unique per (project, creator), case-insensitively — the DB unique index is case-sensitive, so this handler-level `LOWER(name)` check is the real guard (the index is only a race backstop). Cap, duplicate-name, and last-position lookups run in a single `db.batch` round-trip.

**Auth:** Required.
**Authorization:** Project member (any role, including viewers).

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--50 characters, trimmed (whitespace-only rejected) | Yes |
| `state` | `object` | `{ tab, params }` — see above | Yes |
| `state.tab` | `string` | 1--20 characters | Yes |
| `state.params` | `object` | Open string-record, ≤16 entries, keys 1--40 chars, values ≤500 chars | Yes |

**Response** (201): `{ "view": { ...as above } }`

**Errors:** 400 (max views reached / invalid body), 409 (duplicate name).

### `PATCH /api/projects/:projectId/views/:viewId`

Renames a view and/or overwrites its `state` snapshot. Last-write-wins — the data is single-owner, so there is no concurrent editor to protect against. The duplicate-name 409 only fires when the name actually changes case-insensitively, so a case-correction (`"urgent"` → `"Urgent"`) and a no-op rename never false-positive against the row's own name. An empty PATCH (no changed fields) echoes the row without bumping `updatedAt`.

**Auth:** Required.
**Authorization:** Project member (any role); the view must belong to the caller, else 404.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `name` | `string` | 1--50 characters, trimmed | No |
| `state` | `object` | `{ tab, params }` — see above | No |

**Response** (200): `{ "view": { ...as above } }`

**Errors:** 404 (not found, or belongs to another user), 409 (duplicate name).

### `DELETE /api/projects/:projectId/views/:viewId`

Deletes one of the caller's saved views. The creator-scoped `WHERE` plus `.returning()` means another user's (or a non-existent) view id deletes nothing and yields the same 404.

**Auth:** Required (cookie session or PAT with `project:delete` — saved views ride the `project:*` scope family; there is no `view:*` scope).
**Authorization:** Project member (any role); the view must belong to the caller, else 404.

**Response** (200):

```json
{ "ok": true, "deletedId": "viewId" }
```

**Errors:** 404 (not found, or belongs to another user).

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
    "isCompletionGroup": false,
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
      "isCompletionGroup": false,
      "position": "a0",
      "createdAt": "...",
      "updatedAt": "...",
      "taskCount": 5
    }
  ]
}
```

### `GET /api/workspaces/:workspaceId/task-groups`

Lists task groups belonging to a given set of projects in the workspace. Used by workspace-level views (e.g. My Tasks filter bar) where the user narrows to specific columns across one or more projects. Requested project IDs that the caller cannot see are silently dropped (mirrors `listProjects` partial-visibility behavior). Query parameters are validated via `workspaceTaskGroupsQuerySchema`.

**Auth:** Required.
**PAT scope:** `task:read` (or `read:*` / `write:*`).
**Authorization:** Workspace member. Elevated members (owner/admin) see all requested projects; non-elevated members see only projects they are a direct member of. A PAT with `projectScope: "selected"` is narrowed to its selected projects as well — a requested project outside its list is dropped from the result, the same silent treatment an unseeable project gets, rather than raising an error.

**Query parameters:**

| Param | Type | Constraints | Required |
|-------|------|-------------|----------|
| `projectIds` | `string` | Comma-separated list of project UUIDs (1–100) | Yes |

**Response** (200):

```json
{
  "taskGroups": [
    {
      "id": "uuid",
      "name": "To Do",
      "color": null,
      "isCompletionGroup": false,
      "position": "a0",
      "projectId": "project-uuid",
      "projectName": "My Project"
    }
  ]
}
```

Task groups are ordered by `projectId` then `position` ascending.

### `PATCH /api/task-groups/:taskGroupId`

Updates a task group's name, color, or completion-group flag. Access is checked inline by resolving the parent project.

**Auth:** Required (cookie session or PAT with `task:write` / `write:*`). There is no `task-group:*` scope; task groups are task-internal.
**Authorization:** Project admin or member (via inline check).

> **PAT note:** the URL names neither a project nor a task, so this route resolves the owning project itself and applies the token's workspace binding and selected-project list to it — `403 Forbidden` when the token may not reach that project, even though its owning user can. The same applies to `DELETE /api/task-groups/:taskGroupId` and `PATCH /api/task-groups/:taskGroupId/reorder` below.

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

**Auth:** Required (cookie session or PAT with `task:delete` — `write:*` does **not** grant it).
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

**Auth:** Required (cookie session or PAT with `task:write` / `write:*`).
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
| `assigneeId` | `string \| null` | UUID of a user who can access this project (see [Assignee rule](#assignee-rule)); anyone else is rejected with 400. `null` creates the task unassigned | No |
| `priority` | `string` | `"urgent"`, `"high"`, `"medium"`, `"low"`, or `"none"` (default: `"none"`) | No |
| `startDate` | `string \| null` | Task start date, same format/validation as `dueDate`. Independently optional; when a `dueDate` is also present it must be on or before it (see range note below) | No |
| `dueDate` | `string \| null` | A `YYYY-MM-DD` calendar date (what the web date picker sends) or a full ISO 8601 datetime. Validated calendar-aware: shape-correct-but-impossible dates (e.g. `2030-02-30`) are rejected with 400 | No |
| `cost` | `integer \| null` | Non-negative integer (cents) | No |
| `icon` | `string \| null` | max 50 characters | No |
| `recurrenceRule` | `object \| null` | See [Recurrence Rule](#recurrence-rule-object) below | No |

> **Note:** When `recurrenceRule` is provided but `dueDate` is omitted, `dueDate` defaults to the current date. A `recurrenceSeriesId` (UUID) is automatically generated for new recurring tasks.

> **Start/due ordering invariant:** `startDate` and `dueDate` are each independently optional — a task may carry a start date alone (work that begins on a day with no deadline), a due date alone, both (a start → due range), or neither. The only cross-field rule is ordering: when **both** are present, `startDate` must not fall after `dueDate` (`"Start date must be on or before the due date"`, 400). On create the full state is in the payload, so the rule is checked by the schema. Comparison is on the `YYYY-MM-DD` prefix (lexicographic, no timezone parse).

<a id="assignee-rule"></a>

> **Assignee rule:** a task can only be assigned to someone who can actually open its project — a direct project member, or a workspace owner/admin (who hold project-admin access by elevation and need no `project_member` row). A plain workspace member who is not on the project, an unknown user id, and a user outside the workspace are all rejected with **400** `{"error": "Assignee must have access to this project"}`; nothing is written and no notification is sent. `null` (unassign) is always accepted, and re-sending a task's **current** `assigneeId` unchanged is a no-op that is never re-validated, so whole-object PATCHes keep working after a membership change. The rule is enforced identically on `POST /projects/:projectId/tasks` and `PATCH /tasks/:taskId`. Where an assignee is *inherited* rather than supplied — `POST /tasks/:taskId/duplicate` and the instance spawned when a recurring task is completed — the operation still succeeds, but an assignee who has since lost access is dropped, so the new task comes back unassigned and no assignment notification is sent. The same check gates the completion notification, so a task assigned before its assignee was offboarded stops notifying them.

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
    "startDate": null,
    "dueDate": null,
    "cost": null,
    "icon": null,
    "coverImageKey": null,
    "recurrenceRule": null,
    "recurrenceSeriesId": null,
    "recurrenceParentId": null,
    "sourceUid": null,
    "position": "a0",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

> **`sourceUid`** is always present on a task object. It is `null` for tasks created any way other than calendar import; it carries the ICS `UID` of the source event only for tasks created via `POST /projects/:projectId/tasks/import`. It is set once at import and is immutable — `PATCH /tasks/:taskId` ignores it, and `duplicate`/`move`/recurrence-spawn never copy it.

### `POST /api/projects/:projectId/tasks/import`

Bulk-creates up to **500 tasks** in one request from a **client-parsed** `.ics` calendar. The server never receives the raw `.ics` file — the browser (or a machine client) parses it and sends only validated JSON. Imported tasks are appended to the end of the target task group in payload order.

**Auth:** Required (cookie session or PAT with `task:write` / `write:*`).
**Authorization:** Project admin or member.
**Rate limit:** 10 requests/minute per caller (`429` over the cap). One request can write 500 task rows plus 500 activity entries, so unlike single-task create this endpoint *is* rate-limited.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `taskGroupId` | `string` | UUID, must belong to the project in the URL | Yes |
| `tasks` | `array` | 1--500 items (see item shape below) | Yes |

**`tasks[]` item shape** — deliberately the same validation contract as `POST /tasks` (an import can never carry values a hand-created task couldn't):

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `title` | `string` | 1--200 characters | Yes |
| `description` | `string \| null` | max 5000 characters | No |
| `startDate` | `string \| null` | Same format/validation as `dueDate`; independently optional and must be on or before `dueDate` when both are present (a `DTSTART` without a resolvable end imports as a start-only task, exactly like a create payload with a start and no due date) | No |
| `dueDate` | `string \| null` | A `YYYY-MM-DD` calendar date or a full ISO 8601 datetime; validated calendar-aware (impossible dates such as `2030-02-30` rejected with 400) | No |
| `sourceUid` | `string` | The source event's ICS `UID`, 1--512 characters | No |

> **Always unassigned:** the item shape has no `assigneeId` and the handler never writes the column, so every imported task is created unassigned. A calendar event carries no notion of "who on this project owns the work", and inventing one would route the [assignee rule](#assignee-rule) through a 500-row batch where a single ineligible id would have to either fail the whole import or be silently dropped. Assign after import via `PATCH /tasks/:taskId`, which validates one id at a time and can report exactly which one was rejected.

> **Re-import dedupe:** events that carry a `sourceUid` are imported **at most once per project** — a partial unique index on (`projectId`, `source_uid`) is the ground truth, and the handler pre-reads existing UIDs so re-importing the same file reports those events as `skipped` rather than failing the batch. A UID repeated within a single payload is also collapsed to one insert. Events **without** a `sourceUid` cannot be recognised on re-import and are created again every time — documented behavior.

> **Atomicity:** all inserts run in a single D1 batch (one transaction). A mid-batch failure (e.g. a position race, or a concurrent import of the same file) rolls back every row and retries after re-reading both the existing-UID set and the group's boundary position, so the losing side of a same-file race converges to "all skipped" rather than erroring. There is never a partial import.

> **No webhooks:** bulk import deliberately dispatches **no** `task.created` webhooks — a 500-event import would fan out 500 deliveries per subscriber for what is, to the user, one action. Imported tasks appear on the next read and carry `sourceUid` in every later task webhook payload.

**Response** (201):

```json
{ "created": 480, "skipped": 20, "total": 500 }
```

`total` always equals `created + skipped` and echoes the request item count, so an integrator can detect a client-side truncation bug. Importing into a completion group marks the imported tasks completed (same rule as single-task create).

**Errors:** `400` validation failed · `401` unauthorized · `403` forbidden · `404` task group not found in this project · `429` rate limit exceeded.

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
{ "tasks": [ { "id": "...", "title": "...", "status": "...", "recurrenceRule": null, "labels": [], "..." } ] }
```

Each task object includes `recurrenceRule` (parsed object or `null`) and `labels` (array of label objects).

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
    "recurrenceRule": null,
    "position": "...",
    "subtasks": [
      { "id": "...", "title": "...", "completed": false, "position": "...", "createdAt": "..." }
    ],
    "commentCount": 2,
    "labels": []
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
| `assigneeId` | `string \| null` | UUID of a user who can access this task's project (see [Assignee rule](#assignee-rule)); anyone else is rejected with 400. `null` unassigns |
| `priority` | `string` | `"urgent"`, `"high"`, `"medium"`, `"low"`, or `"none"` |
| `status` | `string` | `"open"`, `"in_progress"`, `"completed"`, or `"cancelled"` |
| `startDate` | `string \| null` | Task start date, same format/validation as `dueDate`. Independently optional; subject only to the start/due ordering invariant (see below) |
| `dueDate` | `string \| null` | A `YYYY-MM-DD` calendar date or a full ISO 8601 datetime. Validated calendar-aware: impossible dates (e.g. `2030-02-30`) are rejected with 400 |
| `cost` | `integer \| null` | Non-negative integer (cents) |
| `icon` | `string \| null` | max 50 characters |
| `coverImagePosition` | `integer \| null` | 0--100, vertical position of cover image (applies to either cover source) |
| `recurrenceRule` | `object \| null` | See [Recurrence Rule](#recurrence-rule-object) below |

`coverImageKey` and `coverUnsplash` are **not** accepted here — use the dedicated cover endpoints below, which enforce the XOR invariant between the two cover sources. This matters most for `coverImageKey`: because [`GET /api/uploads/...`](./storage.md#get-apiuploadspurposeuseridfilename) authorizes a `task-cover` download by matching the requested key against `task.cover_image_key`, a client-writable key would be a forgeable read capability. Nothing in the API writes a non-null `coverImageKey` except the cover upload endpoint, using a key the server just minted for the caller's own upload. (Workspace import also restores a `coverUnsplash` payload from an uploaded export; that column holds absolute Unsplash URLs rather than a key into storage, and import nulls `coverImageKey` alongside it.) Unknown fields are stripped, so sending one is ignored rather than rejected.

**Response** (200):

```json
{ "task": { "id": "...", "title": "...", "status": "...", "cost": 0, "icon": "...", "recurrenceRule": null, "..." } }
```

**Behavior notes:**
- When `recurrenceRule` is set on a task that has no `recurrenceSeriesId`, a new series ID is generated automatically.
- Changing `recurrenceRule` logs a `recurrence_changed` activity; removing it (setting to `null`) logs a `recurrence_removed` activity.
- The `recurrenceRule` field is included in webhook change detection for `task.updated` events.
- **Start/due ordering invariant on partial updates:** `startDate` and `dueDate` are independently optional; the only cross-field rule is that `startDate` must not fall after `dueDate` when both are present. A PATCH that touches only one of them is validated against the *stored* value of the other by a merged-state backstop in the handler (the schema can only check the rule when both fields are present in the payload). The same `dateRangeError` predicate and 400 wording are used in both places, so they can never drift. Setting `dueDate` to `null` does **not** touch a surviving `startDate` — a start date can stand on its own, so there is nothing to auto-clear.
- Changing `startDate` logs a `start_date_changed` activity; clearing it logs a `start_date_removed` activity. `startDate` is included in webhook change detection for `task.updated` events.

### `DELETE /api/tasks/:taskId`

Deletes a task and its subtasks/comments.

**Auth:** Required (cookie session or PAT with `task:delete` — neither `task:write` nor `write:*` grants it).
**Authorization:** Project **admin or member** (a project viewer cannot delete), or workspace owner/admin by elevation.

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

**Recurring task behavior:** If the target group is a completion group and the task was not already completed and has a `recurrenceRule`, a new task instance is spawned (same logic as the `/complete` endpoint). A `task.created` webhook is dispatched for the spawned instance.

**Response** (200):

```json
{
  "task": { "id": "...", "taskGroupId": "...", "position": "...", "..." },
  "nextRecurringTask": { "id": "...", "projectId": "...", "title": "...", "dueDate": "...", "..." } | null
}
```

`nextRecurringTask` is present when the move auto-completes a recurring task. It is `null` otherwise.

### `POST /api/tasks/:taskId/duplicate`

Duplicates a task including its subtasks and labels. The new task is placed at the end of the same task group with `" (copy)"` appended to the title. Subtask completion state is reset. Cover image, comments, and recurrence settings are not copied.

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
1. Fetches the source task.
2. Creates a new task copying title (with `" (copy)"` suffix), description, assignee, priority, due date, cost, and icon. Cover image and recurrence settings are not copied.
3. Copies subtasks (with completion reset to `false`) and labels from the source task.
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

Uploads a cover image for a task. Replaces any existing cover (R2 or Unsplash). Rate-limited to 10 requests per minute.

**Auth:** Required.
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`).

**Request:** `multipart/form-data` with a `file` field (JPEG, PNG, GIF, or WebP, max 5 MB).

**Behavior:**
1. Validates the file type and size.
2. Looks up the task's previous cover image (if any) but does not delete it yet.
3. Uploads the new file to R2 under `task-cover/{userId}/{uuid}{ext}`. If the R2 upload fails, the old cover remains intact.
4. Creates a record in the `upload` table and atomically writes `coverImageKey = <new key>` AND `coverUnsplash = null` on the task, preserving the XOR invariant between the two cover sources. If either DB write fails, the orphaned R2 object and any partial upload record are cleaned up before returning 500.
5. Deletes the old R2 cover object and its upload row only after the new one is fully saved. (If the previous cover was an Unsplash payload there is no R2 artifact to delete.)

**Response** (200):

```json
{
  "upload": {
    "id": "abc123",
    "url": "/api/uploads/task-cover/userId/uuid.jpg",
    "filename": "cover.jpg",
    "mimeType": "image/jpeg",
    "size": 204800
  },
  "coverImageKey": "task-cover/userId/uuid.jpg",
  "coverUnsplash": null
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

### `PUT /api/tasks/:taskId/cover/unsplash`

Applies an Unsplash-hosted photo as the task's cover image. Replaces any existing cover (R2 or Unsplash). Rate-limited to 10 requests per minute. Returns 503 when `UNSPLASH_ACCESS_KEY` is not configured.

**Auth:** Required.
**Authorization:** Project member (admin or member), or workspace owner/admin (resolved via `requireTaskRole("admin", "member")`).

**Request body:** JSON payload matching `UnsplashCoverPayload` from [`src/shared/schemas/unsplash.ts`](../../src/shared/schemas/unsplash.ts) (typically the exact `result` object returned by `/api/unsplash/search` or `/api/unsplash/curated`).

**Behavior:**
1. Validates the payload against `unsplashCoverPayloadSchema`.
2. Atomically writes `coverUnsplash = <payload>` AND `coverImageKey = null` on the task, preserving the XOR invariant between the two cover sources.
3. If the task previously had an R2 cover, deletes the old R2 object and its `upload` row AFTER the DB write succeeds. Failures here are logged but non-fatal.
4. Fires a GET against `payload.downloadLocation` via `deferWork` (outside the request lifecycle in prod, inline in tests) to comply with the Unsplash API download-tracking guideline. All tracking errors are swallowed.

**Response** (200): same shape as [`PUT /api/projects/:projectId/cover/unsplash`](#put-apiprojectsprojectidcoverunsplash) -- `{ "coverImageKey": null, "coverUnsplash": {...} }`.

**Error responses:**

| Status | Condition |
| --- | --- |
| 400 | Payload failed schema validation |
| 401 | Not authenticated |
| 403 | Not a project member |
| 404 | Task not found |
| 429 | Rate limit exceeded |
| 500 | Database write failed |
| 503 | `UNSPLASH_ACCESS_KEY` not configured, or R2 storage missing while an R2 cover is queued for cleanup |

### `DELETE /api/tasks/:taskId/cover`

Removes the cover image (R2 or Unsplash) from a task. Clears both `coverImageKey` and `coverUnsplash` atomically. Idempotent -- returns success even if no cover exists.

**Auth:** Required (cookie session or PAT with `task:delete`).
**Authorization:** Project **admin or member**, or workspace owner/admin by elevation.

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
| 503 | R2 storage binding not configured (only required when an R2 cover exists; pure Unsplash covers delete without STORAGE) |

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

**Auth:** Required (cookie session or PAT with `task:write` / `write:*`).
**Authorization:** Project member (via inline check).

> **PAT note:** the URL names neither a project nor a task, so the route resolves the owning project itself and applies the token's workspace binding and selected-project list to it — `403 Forbidden` when the token may not reach that project, even though its owning user can. There is no `subtask:*` scope in the v1 grammar; subtasks are task-internal and sit under `task:*`.

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

**Auth:** Required (cookie session or PAT with `task:delete`).
**Authorization:** Project member (via inline check). The same PAT project-binding note as `PATCH /api/subtasks/:subtaskId` applies.

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

**Recurring task behavior:** If the completed task has a `recurrenceRule`, a new task instance is automatically spawned, advancing the task's primary date by the rule. The new instance inherits the title, description, assignee, priority, cost, icon, labels, and subtasks (with completion reset) from the completed task. The recurrence anchors on the **due date** when present: a task with only a due date spawns with a null `startDate`, and a task with **both** a start and due date preserves the same whole-day start→due span (its `startDate` is the new due date minus that span, computed in UTC day math so DST transitions inside the span never shift it). A **start-only** task (a `startDate` with no `dueDate`) anchors the recurrence on its **start date** instead — the spawned instance advances the `startDate` and stays due-less, so a start-only series never silently grows a due date. A fully date-less recurring task anchors on the completion date and materialises a due date with a null `startDate`. A unique partial index on `recurrenceParentId` prevents duplicate spawns from concurrent requests. A `task.created` webhook is dispatched for the spawned instance.

**Auth:** Required.
**Authorization:** Project admin or member (resolved via `requireTaskRole`).

**Response** (200):

```json
{
  "task": { "id": "...", "completed": true, "completedAt": "...", "completedBy": "userId", "..." },
  "nextRecurringTask": { "id": "...", "projectId": "...", "title": "...", "dueDate": "...", "..." } | null
}
```

`nextRecurringTask` is present when the completed task had a `recurrenceRule` and the next due date falls within the rule's bounds. It is `null` otherwise.

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

**Auth:** Required (cookie session or PAT with `task:write` / `write:*`).
**Authorization:** The comment author, **and** that author must still have access to the task's project. Authorship records who wrote the row; it is not a standing permission. Access is resolved on every request, so someone removed from the project can no longer edit comments they wrote while they were on it.

> **PAT note:** the URL names neither a project nor a task, so this route resolves the owning project itself and applies the token's workspace binding and selected-project list to it. A token that may not reach the owning project gets `403 Forbidden` even when its owning user is the author.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `body` | `string` | 1--5000 characters | Yes |

**Response** (200):

```json
{ "comment": { "id": "...", "body": "...", "authorName": "...", "updatedAt": "...", "..." } }
```

### `DELETE /api/comments/:commentId`

Deletes a comment. Creates a `comment_deleted` activity log entry.

**Auth:** Required (cookie session or PAT with `task:delete`).
**Authorization:** Project access is resolved first, for every caller. Given access, the **author** may delete their own comment at any access level; a **non-author** must be project admin (or a workspace owner/admin, who hold project-admin access by elevation). A caller with no current access to the project is refused regardless of who wrote the comment — the author check narrows an access the caller already has, it does not stand in for one. This matches `PATCH /api/comments/:commentId` above.

> **PAT note:** as with `PATCH`, the owning project is resolved from the comment and the token's workspace binding and selected-project list are applied to it (`403 Forbidden` when the token may not reach that project).

**Response** (200):

```json
{ "ok": true }
```

**Errors:** 403 (no current project access; or a non-author who is not a project admin; or a token that may not reach the project), 404 (no such comment, or its parent task no longer exists).

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

**Auth:** Required (cookie session or PAT with `team:write` / `write:*`).
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

**Auth:** Required (cookie session or PAT with `team:read` / `read:*` / `write:*`).
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

### `GET /api/workspaces/:workspaceId/teams/:teamId`

Returns a single team with its full member roster (each member's `id`, `userId`, `role`, `joinedAt`, and nested `user` profile).

**Auth:** Required (cookie session or PAT with `team:read` / `read:*` / `write:*`).
**Authorization:** Workspace member. Teams are workspace-owned, so a token's workspace binding is the applicable control and project scope has nothing to narrow.

**Response** (200):

```json
{
  "id": "uuid",
  "workspaceId": "workspaceId",
  "name": "Engineering",
  "description": null,
  "createdAt": "...",
  "updatedAt": "...",
  "members": [
    {
      "id": "teamMemberId",
      "userId": "userId",
      "role": "member",
      "joinedAt": "...",
      "user": { "id": "userId", "name": "John Doe", "email": "john@example.com", "image": null }
    }
  ]
}
```

The team fields are at the top level here rather than under a `team` key — unlike the list endpoint above, which wraps its rows in `{ "teams": [...] }`.

**Errors:** 404 (`Team not found` — no such team **in this workspace**).

### `PATCH /api/workspaces/:workspaceId/teams/:teamId`

Updates a team's name or description.

**Auth:** Required (cookie session or PAT with `team:write` / `write:*`).
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

**Auth:** Required (cookie session or PAT with `team:write` — there is no `team:delete` in the v1 scope grammar).
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{ "ok": true }
```

### `POST /api/workspaces/:workspaceId/teams/:teamId/members`

Adds a workspace member to a team. The target user must already be a member of the workspace.

**Auth:** Required (cookie session or PAT with `team:write` / `write:*`).
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

**Auth:** Required (cookie session or PAT with `team:write`).
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{ "ok": true }
```

---

## Unsplash

Proxy endpoints in front of the [Unsplash REST API](https://unsplash.com/documentation). They exist as a proxy (rather than calling Unsplash from the browser) so the `UNSPLASH_ACCESS_KEY` is never exposed to the client, so we can apply our own per-user rate limit against our shared Unsplash quota, and so the raw payload is normalised into the `UnsplashCoverPayload` shape stored in `project.coverUnsplash` / `task.coverUnsplash` — including mandatory UTM attribution parameters on every user-visible outbound link.

Both endpoints share a single rate limit (30 requests per minute per user, combined across search and curated). When `UNSPLASH_ACCESS_KEY` is not configured server-side, both endpoints return `503`. Upstream Unsplash errors are remapped: `429` is surfaced verbatim so clients can back off; all other upstream failures return `502` with `{ "upstreamStatus": <code> }` — upstream response bodies are logged server-side but never echoed to clients.

### `GET /api/unsplash/search`

Searches Unsplash photos and returns a normalised, paginated result. Requires auth.

**Query parameters:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `query` | `string` | 1--100 characters, trimmed | Yes |
| `page` | `integer` | 1--50, defaults to `1` | No |
| `perPage` | `integer` | 1--30, defaults to `24` | No |
| `orientation` | `string` | one of `"landscape"`, `"portrait"`, `"squarish"` | No |

**Response** (200): See [Unsplash Search Response](#unsplash-search-response) below.

**Errors:** `401` unauthenticated, `429` rate-limited (local) or upstream rate-limited (Unsplash), `502` upstream failure, `503` Unsplash not configured.

### `GET /api/unsplash/curated`

Returns the latest curated Unsplash photos in the same normalised shape as search. Used as the default picker view before the user types a query. Requires auth.

**Query parameters:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `page` | `integer` | 1--50, defaults to `1` | No |
| `perPage` | `integer` | 1--30, defaults to `24` | No |

**Response** (200): See [Unsplash Search Response](#unsplash-search-response) below. The Unsplash `/photos` endpoint does not report a total, so `totalPages` is a bounded default (50) and `total = totalPages × perPage`.

**Errors:** same as `/api/unsplash/search`.

---

## Legal

### `GET /api/legal/tos-status`

Returns whether the authenticated user has accepted the current Terms of Service version.

**Auth:** Required.

**Response** (200):

```json
{
  "accepted": true,
  "currentVersion": "1.0"
}
```

### `POST /api/legal/accept-tos`

Records the authenticated user's acceptance of the current Terms of Service version. Idempotent — re-accepting an already-accepted version is a no-op success. Returns 400 if the submitted version does not match the current version.

**Auth:** Required.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `tosVersion` | `string` | min 1 character, must match current version | Yes |

**Response** (200):

```json
{ "accepted": true }
```

**Response** (400, version mismatch):

```json
{ "error": "Version mismatch: please accept the current Terms of Service" }
```

---

## Invitations

### `POST /api/workspaces/:workspaceId/invitations`

Creates a workspace invitation and emails the invitee a link to `/invite/:token`. The email is dispatched after the response is sent, so a mail-provider outage logs an error but never fails the request — recover with the copy-link endpoint below. A unique token is generated and the invitation expires after 7 days.

Rate-limited to 20 per hour, keyed on the caller (API token id, else user id, else client IP) and applied *after* the role check, so a rejected non-admin cannot spend an admin's allowance. Creating an invitation now sends mail to a caller-chosen address carrying caller-influenced content, which makes an unmetered endpoint a mail-bomb and a way to burn this deployment's sending-domain reputation — damage that outlives the session that caused it. The duplicate-pending guard below already blocks repeat sends to one address, so reaching the ceiling means 20 *distinct* new addresses in an hour.

**Auth:** Required (cookie session or PAT with `invitation:write` / `write:*`).
**Authorization:** Workspace owner or admin — but inviting someone as an `admin` requires the **owner**, and an admin who tries gets a 403 (`Only the workspace owner can invite someone as an admin`). Role *promotion* is already owner-only, because an admin who can mint peer admins can manufacture people immune to every admin in the workspace, including their creator. A rule enforced on only one of two routes to the same end state is not a rule; it just tells an attacker which door to use. Admins keep the whole of their member-management authority — what they lose is the ability to enlarge the tier that outranks their own peers.

**Request body:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `email` | `string` | Valid email address. Trimmed and lower-cased before it is stored or compared, so `Alice@Example.com` and `alice@example.com` are the same invitee. Previously a stray capital was stored verbatim and silently stranded the invitee: no `invitation_received` notification and an empty pending list, with the emailed link their only remaining way in. | Yes |
| `role` | `string` | `"admin"` or `"member"` (cannot be `"owner"`; defaults to `"member"`). `"admin"` is owner-only — see Authorization above. | No |

**Response** (201):

```json
{
  "invitation": {
    "id": "uuid",
    "workspaceId": "workspaceId",
    "email": "invitee@example.com",
    "role": "member",
    "invitedBy": "userId",
    "status": "pending",
    "expiresAt": "...",
    "acceptedAt": null,
    "createdAt": "..."
  }
}
```

> The raw `token` is deliberately absent. It is a bearer credential: whoever holds it can join the workspace after signing in with the invited address. It leaves the server through exactly two doors — the invitation email, and `GET .../invitations/:id/link` below.

> The echoed `email` is the **canonical** address actually stored, so it may differ from what was submitted (`  Alice@Example.com ` comes back as `alice@example.com`). Clients that display the invitee should render this value rather than the string they sent, or the members list will disagree with the row the server will match on.

**Errors:** 400 (invalid email, `role: "owner"`, the invitee is already a member, or a pending invitation already exists for this address), 403 (not an owner/admin, or an admin attempting `role: "admin"` — `Only the workspace owner can invite someone as an admin`), 429 (more than 20 invitations in an hour from this caller).

### `GET /api/workspaces/:workspaceId/invitations`

Lists all pending invitations for a workspace.

**Auth:** Required.
**PAT scope:** none. There is no `invitation:read` in the v1 scope grammar — `invitation:write` covers creating and revoking only — so a PAT reaching this route is gated by its workspace binding and the owner/admin requirement below rather than by a scope. The response carries no `token`, so it hands out no credential.
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
      "status": "pending",
      "expiresAt": "...",
      "acceptedAt": null,
      "createdAt": "..."
    }
  ]
}
```

> No `token` field — see the note above.

### `GET /api/workspaces/:workspaceId/invitations/:id/link`

Returns the shareable `/invite/:token` URL for one **pending** invitation. This is the copy-link control on the workspace members page: the fallback for when invitation email bounces, lands in spam, or was never sent because the deployment has no mail provider configured.

The link is fetched on demand rather than carried in the list response above, so the token comes to rest in as few places as possible.

**Auth:** Required. **Cookie sessions only — API tokens are refused with 403**, because a machine credential must never be able to harvest another credential (the same rule the API-token management and calendar-feed surfaces follow).
**Authorization:** Workspace owner or admin.

**Response** (200):

```json
{
  "url": "https://your-app.example.com/invite/uuid-token",
  "expiresAt": "..."
}
```

**Errors:** 400 (invitation revoked, already accepted, or expired — a dead link is never handed out), 403 (not an owner/admin, or the caller used an API token — `API tokens cannot retrieve invitation links`), 404 (no such invitation in this workspace).

### `GET /api/invitations/pending`

Lists the caller's own pending, unexpired invitations — the in-app "Pending Invitations" list on the workspaces page and the Accept action on invitation notifications. Matched on the session's account email, with both sides folded to canonical form (trimmed, lower-cased). The previous byte-for-byte comparison returned an **empty list** to anyone whose invitation was addressed with a capital letter — silently, and with no signal on either side that the admin's pending list and the invitee's disagreed.

**Auth:** Required. **Cookie sessions only — API tokens are refused with `403` (`API tokens cannot list invitations`) whatever scopes they hold.** The list is a queue of pending credential grants addressed to a human's mailbox, and the actions it exists to enable — accepting them — are themselves closed to tokens, so exposing the queue to one would only tell a machine credential which workspaces its owner could be joined to. There is no `invitation:read` scope to narrow it with either.
**Authorization:** Any authenticated user; the result is always scoped to their own address.

**Response** (200):

```json
{
  "invitations": [
    {
      "id": "uuid",
      "role": "member",
      "expiresAt": "...",
      "createdAt": "...",
      "workspace": { "id": "workspaceId", "name": "My Workspace" },
      "invitedBy": { "id": "userId", "name": "John Doe", "email": "john@example.com" }
    }
  ]
}
```

> No `token` field. Signed-in users accept from this list with `{ "invitationId": "<id>" }` — the server authorizes against the session's verified email, so the client never needs the secret.

### `DELETE /api/workspaces/:workspaceId/invitations/:id`

Revokes a pending invitation (sets its status to `"revoked"`).

**Auth:** Required (cookie session or PAT with `invitation:write` / `write:*`).
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

**Auth:** Required. **Cookie sessions only — API tokens are refused with 403 whatever scopes they hold.** PAT auth bridges its owning user into the request context as an ordinary user, so without this a token minted with nothing but `task:read` satisfied the auth check and reached the handler, where it could insert a workspace membership, flip an invitation to accepted, and fire `invitation.accepted` / `workspace.member_joined`. Scoping was not the fix: accepting an invitation converts a bearer credential into durable membership — a second, longer-lived credential of a different class — so the correct answer is "no token may do this at all", the same rule the copy-link, API-token management and calendar-feed surfaces enforce. Joining a workspace is a human act taken from a browser after clicking a link in a mailbox that human controls.
**Authorization:** The session's account email must match the invited address, compared in canonical (trimmed, lower-cased) form on both sides so this check cannot drift from the write-side rule or from the pending list. Since email verification is mandatory (`requireEmailVerification`), that match is evidence of mailbox control rather than merely of what someone typed into a signup form.

**Request body — exactly one selector:**

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `token` | `string` | non-empty | Exactly one of the two |
| `invitationId` | `string` | non-empty | Exactly one of the two |

Use `token` when arriving from the emailed `/invite/:token` link; use `invitationId` when accepting from the in-app pending list, which no longer receives the token. Both selectors run the identical checks — the id is an identifier, never a capability. Supplying both, or neither, is a 400.

**Response** (200):

```json
{ "ok": true, "workspaceId": "workspaceId" }
```

**Errors:** 400 (invitation expired, already a member, or a malformed selector pair), 403 (the caller authenticated with an API token — `API tokens cannot accept invitations` — or the invitation was sent to a different email address), 404 (no such invitation), 409 (`Invitation is accepted` / `Invitation is revoked`, **including losing a race** to a concurrent accept), 429 (rate limit exceeded).

The 409 body is byte-identical whether the caller arrived late or lost a race, because those are the same fact from the client's side; branching on a distinction that is pure timing would be a bug waiting to happen.

Membership and consumption are written by a **single `db.batch()`**, which D1 runs as one implicit transaction: a guarded `INSERT ... SELECT ... WHERE status = 'pending'` followed by the matching guarded `UPDATE`. So there are exactly three outcomes and no partial state — both writes land (200), the invitation was not pending so *nothing at all* was written (409), or the unique index on `(workspaceId, userId)` aborts and rolls back the whole batch (400, and the invitation is left **pending** rather than burned, so the invitee can still use it). Two separate statements could not achieve this in either order: insert-then-update leaves a member with access and a still-pending invitation, and update-then-insert consumes the invitation with no membership behind it — locking the invitee out permanently, silently, with no retry available.

---

## Dashboard

### `GET /api/workspaces/:workspaceId/dashboard`

Returns a workspace-level dashboard scoped to **active projects only**. Includes task count breakdowns by status, aggregate task counts, priority breakdown, per-member workload, overdue tasks, cost aggregation, and a summary of non-active (completed/archived) projects across the workspace.

**Auth:** Required.
**PAT scope:** `task:read` **and** `project:read` (or `read:*` / `write:*`). Two scopes because the body genuinely carries two resources — a task rollup *and* a project collection equivalent to [`GET /api/workspaces/:workspaceId/projects`](#get-apiworkspacesworkspaceidprojects). See [API Tokens § Aggregate and cross-resource endpoints](./api-tokens.md#aggregate-and-cross-resource-endpoints).
**Authorization:** Workspace member. Non-elevated members only see projects they belong to. A PAT with `projectScope: "selected"` is narrowed the same way — the rollup and the project list are computed over its selected projects only, so it gets a smaller dashboard rather than an error.

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
**PAT scope:** `task:read` (or `read:*` / `write:*`).
**Authorization:** Workspace member. A PAT with `projectScope: "selected"` sees only tasks in its selected projects. That narrowing is **intersected** with the `projectIds` query filter below rather than replacing it, so asking for a project outside the token's list returns nothing for that project instead of widening the token. It is applied in the query, not after it, so `nextCursor` stays correct.

**Query parameters (all optional):**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | `string` | — | Filter by due date window: `"week"`, `"fortnight"`, or `"month"` |
| `projectIds` | `string` | — | Comma-separated project UUIDs (max 100). When provided, only tasks from these projects are returned |
| `taskGroupIds` | `string` | — | Comma-separated task-group UUIDs (max 100). When provided, only tasks in these task groups are returned |
| `priority` | `string` | — | Comma-separated `TaskPriority` values (`urgent`, `high`, `medium`, `low`, `none`). Invalid entries are rejected with 400 |
| `dueDateFrom` | `string` | — | Inclusive lower bound on due date, strict `YYYY-MM-DD` calendar date (mapped to `T00:00:00.000Z`). Impossible dates (e.g. `2030-02-30`) are rejected with 400 |
| `dueDateTo` | `string` | — | Inclusive upper bound on due date, strict `YYYY-MM-DD` calendar date (mapped to `T23:59:59.999Z`) |
| `noDueDate` | `string` | — | `"true"` to include tasks with no due date. OR-combined with any `dueDateFrom`/`dueDateTo` range (in range **or** no due date) |
| `labelNames` | `string` | — | Comma-separated label **names** (not ids), each 1–30 chars, max 50. Matched case-insensitively across projects (a label's name is its cross-project identity) |
| `noLabel` | `string` | — | `"true"` to include tasks with no labels. OR-combined with `labelNames` when both are present |
| `limit` | `number` | 50 | Number of tasks per page (1–200) |
| `cursor` | `string` | — | Compound cursor in `"isoDate\|id"` format for pagination (paginates by `createdAt` + `id` tiebreaker) |

All filters are applied **server-side** (the endpoint is cursor-paginated, so client-side filtering of a single page would show 0 results for narrow filters until repeated "Load more" and would make counts lie). Filters combine with AND across dimensions; the due-date and label dimensions each combine with OR over their absence flag (`noDueDate`, `noLabel`). The response shape is unchanged — no labels column is returned.

Date boundaries are UTC days, matching how task creation stores due dates (`new Date("YYYY-MM-DD")` is UTC midnight), so server filtering agrees with the client's day comparison regardless of viewer timezone. Note: `period` filters with `lte(dueDate, cutoff)`, which excludes NULL due dates, so combining `period` with `noDueDate=true` intentionally returns no rows.

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
**PAT scope:** `task:read` (or `read:*` / `write:*`).
**Authorization:** Workspace member — an owner/admin sees the whole workspace, a plain member sees only projects they belong to. A PAT with `projectScope: "selected"` is narrowed to its selected projects on top of that, including when its owning user is an owner or admin.

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
**PAT scope:** `task:read` (or `read:*` / `write:*`).
**Authorization:** Project member, or workspace owner/admin (resolved via `requireTaskAccess`). A PAT is additionally checked against its workspace binding and selected-project list.

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
**PAT scope:** `task:read` (or `read:*` / `write:*`) — a change feed is a task read whether it is asked for per-task, per-project, or per-workspace.
**Authorization:** Project member, or workspace owner/admin. A PAT is additionally checked against its workspace binding and selected-project list.

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

### `GET /api/workspaces/:workspaceId/activity`

Lists activity log entries across **every project in the workspace the caller can see**, with the same compound cursor pagination (`createdAt|id`) and descending order as the two feeds above. Each entry additionally carries `projectId` and `projectName`, so a client can render one workspace-wide feed without a second lookup. Query parameters are validated via `workspaceActivityQuerySchema`.

**Auth:** Required.
**PAT scope:** `task:read` (or `read:*` / `write:*`).
**Authorization:** Workspace member. An owner/admin sees every project in the workspace; a plain member sees only projects they belong to. A PAT with `projectScope: "selected"` is narrowed to its selected projects **in addition** to that, including when its owning user is an owner or admin. The narrowing is deliberate rather than incidental: entries carry `oldValue` / `newValue`, so a row is the literal before-and-after text of a task field, not just metadata about it.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | 15 | Number of activities per page (1–50) |
| `cursor` | `string` | — | Compound cursor in `"isoDate\|id"` format (paginates by `createdAt` + `id` tiebreaker) |

**Response** (200):

```json
{
  "activities": [
    {
      "id": "uuid",
      "taskId": "taskId",
      "taskTitle": "Implement login flow",
      "projectId": "projectId",
      "projectName": "Website Redesign",
      "actorId": "userId",
      "actorName": "John Doe",
      "actorImage": "https://...",
      "action": "completed",
      "field": null,
      "oldValue": null,
      "newValue": null,
      "createdAt": "...",
      "apiTokenId": null,
      "tokenName": null
    }
  ],
  "nextCursor": "2025-01-15T10:30:00.000Z|def456-uuid"
}
```

`nextCursor` is `null` when there are no more pages. `actorName` and `actorImage` are `null` when the actor has been deleted. `apiTokenId` and `tokenName` are non-null only for changes made through a Personal Access Token, which lets a client render "via *TokenName*" attribution; `tokenName` is `null` once the token has been deleted, even though `apiTokenId` survives.

### `GET /api/projects/:projectId/dashboard`

Returns a project-level dashboard with task breakdowns by status, by task group, per member, upcoming tasks for the next 30 days, overdue tasks (past-due incomplete tasks with assignee details), priority breakdown (count of active tasks by priority level), cost aggregation across the project's tasks, project budget, and cost per assigned member.

**Auth:** Required.
**PAT scope:** `task:read` **and** `project:read` (or `read:*` / `write:*`). The second scope is required because the body carries a project-entity field (`budget`) rather than only task data — see [API Tokens § Aggregate and cross-resource endpoints](./api-tokens.md#aggregate-and-cross-resource-endpoints).
**Authorization:** Project member, or workspace owner/admin. A PAT is additionally checked against its workspace binding and selected-project list.

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

## Search

### `GET /api/workspaces/:workspaceId/search`

Free-text search over projects and tasks in one workspace. Matches project name/description and task title/description with a case-insensitive substring match; `%`, `_` and `\` in the query are matched literally rather than as wildcards. `limit` applies to each collection independently, so a request can return up to `limit` projects **and** `limit` tasks.

**Auth:** Required.
**PAT scope:** `task:read` **and** `project:read` (or `read:*` / `write:*`). Both are required because the response is two first-class resources: gating on one would leave the other searchable by a token that may not read it. See [API Tokens § Aggregate and cross-resource endpoints](./api-tokens.md#aggregate-and-cross-resource-endpoints).
**Authorization:** Workspace member. An owner/admin searches every project in the workspace; a plain member searches only projects they belong to. A PAT with `projectScope: "selected"` is narrowed to its selected projects on top of that — it gets its own results rather than an error, which keeps a mis-scoped token obvious (fewer hits) instead of looking like an outage.
**Rate limit:** 60 requests/minute per caller, keyed PAT > user > IP.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | `string` | — | Search term, 1--200 characters. Required |
| `limit` | `number` | 20 | Max results **per collection** (1--50) |

**Response** (200):

```json
{
  "projects": [
    { "id": "uuid", "name": "Website Redesign", "description": null, "status": "active", "icon": null }
  ],
  "tasks": [
    {
      "id": "uuid",
      "title": "Implement login flow",
      "priority": "high",
      "completed": false,
      "projectId": "projectId",
      "projectName": "Website Redesign",
      "projectIcon": null
    }
  ]
}
```

**Errors:** 400 (missing or over-long `q`, or `limit` outside 1--50), 403 (not a member of this workspace, or a PAT bound to a different workspace / lacking a required scope), 429 (rate limit exceeded).

---

## Notifications

The notification feed is the one tenant-data surface in the API keyed by **user** rather than by workspace: there is no `:workspaceId` in these URLs, and a row always belongs to exactly one person. Every endpoint below is therefore filtered by the caller's own user id first.

There is no `notification:*` scope. The inbox takes the scope of the data it exposes — its `title`/`body` are copied from task and comment content — so reads require `task:read` and mutations require `task:write`. `task:delete` is deliberately **not** required for `DELETE /api/notifications/:id`: removing a notification is not removing a task. See [API Tokens § Aggregate and cross-resource endpoints](./api-tokens.md#aggregate-and-cross-resource-endpoints).

**PAT visibility rule.** For a token caller the feed is additionally narrowed by row shape, and the same predicate governs the list, the count, and every mutation, so the badge can never disagree with the list it labels:

| Row shape | Visible to a PAT when |
|-----------|-----------------------|
| `projectId` set (task assigned, task completed, comment mention) | The owning project is in the token's workspace **and** on its selected-project list |
| `projectId` null, `workspaceId` set (today only `invitation_received`) | The workspace is the token's own. Project scope narrows project-owned data; for workspace-owned data the workspace binding is the applicable control |
| Both null | Always — there is nothing to narrow |

An out-of-scope notification id is **not** distinguished from one that does not exist: both answer `404 Notification not found`. Cookie sessions see their whole inbox and are unaffected by any of this.

### `GET /api/notifications`

Lists the caller's notifications, newest first, with cursor pagination on `createdAt`.

**Auth:** Required.
**PAT scope:** `task:read` (or `read:*` / `write:*`).

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `unreadOnly` | `"true" \| "false"` | `false` | Return only unread notifications |
| `limit` | `number` | 30 | Notifications per page (1--100) |
| `cursor` | `string` | — | ISO date cursor; returns rows strictly older than it |

**Response** (200):

```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "task_assigned",
      "title": "You were assigned a task",
      "body": "Implement login flow",
      "read": false,
      "workspaceId": null,
      "projectId": "projectId",
      "taskId": "taskId",
      "commentId": null,
      "invitationId": null,
      "actorId": "userId",
      "actorName": "John Doe",
      "actorImage": "https://...",
      "createdAt": "...",
      "readAt": null
    }
  ],
  "nextCursor": "2025-01-15T10:30:00.000Z"
}
```

`nextCursor` is `null` when there are no more pages. `actorName` and `actorImage` are `null` when the actor has been deleted.

### `GET /api/notifications/unread-count`

Returns the caller's unread count — scoped identically to the feed above.

**Auth:** Required.
**PAT scope:** `task:read` (or `read:*` / `write:*`).

**Response** (200):

```json
{ "count": 3 }
```

### `PATCH /api/notifications/:id/read`

Marks one notification read.

**Auth:** Required.
**PAT scope:** `task:write` (or `write:*`).

**Response** (200):

```json
{ "ok": true }
```

**Errors:** 404 (`Notification not found` — no such id, someone else's row, or outside the token's visibility).

### `POST /api/notifications/mark-all-read`

Marks all of the caller's unread notifications read. For a token caller, "all" means all it can see — the sweep never touches rows outside its visibility.

**Auth:** Required.
**PAT scope:** `task:write` (or `write:*`).

**Response** (200):

```json
{ "ok": true }
```

### `DELETE /api/notifications/:id`

Deletes one notification.

**Auth:** Required.
**PAT scope:** `task:write` (or `write:*`) — **not** `task:delete`.

**Response** (200):

```json
{ "ok": true }
```

**Errors:** 404 (`Notification not found` — same three cases as `PATCH .../read`).

---

## Webhooks

Workspace-scoped webhooks are documented below. **Project-scoped webhooks** live under `/api/projects/:projectId/webhooks` (create, list, get, update, delete, test) and are covered in [Webhooks § Project-Scoped Webhooks](./webhooks.md#project-scoped-webhooks) along with event types, payload format, signature verification, and retry behaviour.

Every endpoint in this section requires the workspace `owner` or `admin` role, and a PAT needs `webhook:read` for the two reads and `webhook:write` for create, update, delete, and test (there is no `webhook:delete`).

**PAT project binding applies to the webhook's *target*, not just to the workspace in the URL.** A webhook is a standing egress pipe: once registered it streams event payloads — task titles, descriptions, assignees, comment bodies — to a URL for as long as it exists, so which projects it may point at is checked separately from who may manage webhooks. A webhook's target has two shapes and each gets its own rule:

| Webhook target | A `projectScope: "selected"` token |
|----------------|------------------------------------|
| `projectId` set — a project-scoped subscription | Allowed only when that project is on the token's list; otherwise `403 Forbidden`. Same predicate as every project route |
| `projectId` null — workspace-wide, receiving `task.*` from **every** project | Refused with `403 Forbidden`. There is no partial version of a workspace-wide subscription, and allowing one would route around the project list rather than honour it |

The rule applies to reads as well as writes — a webhook row carries the target URL, event list, and failure state, all of which describe how a project outside the token's list is wired up. `GET /api/workspaces/:workspaceId/webhooks` therefore **filters**: a narrowed token sees its own projects' webhooks and no workspace-wide ones. `PATCH` checks the binding **twice**, against the webhook's current target and against the target it would have afterwards, so a token can neither widen its own project's webhook to a sibling project (or to workspace-wide) nor claim a sibling's webhook by repointing it onto its own list. Both checks run before the target project's existence is verified, so a refusal never doubles as a way to probe which project ids exist. Cookie sessions and `projectScope: "all"` tokens are unaffected throughout.

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

## Calendar Feed

A **calendar feed** is a personal, per-workspace ICS subscription URL. A user mints one feed per workspace; the URL contains a secret `cdn_cal_…` token and exposes the **titles and dates** of tasks assigned to that user in that workspace, ready to subscribe to from Google Calendar, Apple Calendar, or Outlook. The token is a separate, read-only credential class from PATs — see [Database schema](../database/schema.md#calendarfeedtoken).

The **management surface** below is **cookie-session only**: PAT callers are rejected with `403` (`rejectPatAuth()` — a leaked API token must never be able to mint a *different* credential class for its user). All three management responses are sent `Cache-Control: no-store`.

### `GET /api/workspaces/:workspaceId/calendar-feed`

Reports whether the calling user has a live feed for this workspace, with mint and last-fetch timestamps. The feed URL itself is **never** returned here — it is shown exactly once at mint time.

**Auth:** Required (cookie session only — PAT → `403`).
**Authorization:** Workspace member.
**Rate limit:** 20 requests/minute per user.

**Response** (200):

```json
{
  "exists": true,
  "createdAt": "2026-06-01T12:00:00.000Z",
  "lastUsedAt": "2026-06-11T08:30:00.000Z"
}
```

`createdAt` / `lastUsedAt` are `null` when no feed exists (and `lastUsedAt` is `null` until a calendar client first fetches the feed).

### `POST /api/workspaces/:workspaceId/calendar-feed`

Mints (or regenerates) the calling user's feed for this workspace — one feed per user per workspace. If a feed already exists it is **replaced atomically**: the old URL stops working the instant this returns (only the new token's hash is persisted). The returned `url` contains the secret token and is shown **only in this response** — the server stores only an HMAC-SHA256 hash, so a lost URL can only be recovered by regenerating.

**Auth:** Required (cookie session only — PAT → `403`).
**Authorization:** Workspace member.
**Rate limit:** 20 requests/minute per user.

**Response** (201):

```json
{ "url": "https://cadence.example.com/api/calendar/feed/cdn_cal_xxxxxxxx…" }
```

### `DELETE /api/workspaces/:workspaceId/calendar-feed`

Revokes the calling user's feed for this workspace by deleting the token row. Any calendar client subscribed to the old URL starts receiving `404`s on its next refresh. **Idempotent** — revoking an already-revoked (or never-minted) feed still returns `{ "ok": true }`.

**Auth:** Required (cookie session only — PAT → `403`).
**Authorization:** Workspace member.
**Rate limit:** 20 requests/minute per user.

**Response** (200): `{ "ok": true }`

### `GET /api/calendar/feed/:token` (public ICS feed)

Serves the `text/calendar` feed for the token in the path. The `:token` segment **is** the credential (a capability URL), so this route carries **no `requireAuth`** — calendar providers cannot send `Authorization` headers — and is **deliberately excluded from the OpenAPI spec / Scalar docs** so live feed tokens are never pasted into a "Try it" box. Calendar clients discover the URL from the mint response above, never from API docs.

- An optional trailing `.ics` suffix is accepted (`…/feed/<token>.ics`).
- Verification is constant-shape: a cheap `cdn_cal_` prefix reject (so a PAT can never open the feed), then a peppered HMAC lookup, then a **live workspace-membership re-check** (removing the user from the workspace kills the feed on the next fetch, no sweep job). **Every** failure mode — bad prefix, unknown token, revoked membership — returns an **identical `404`**, so the URL leaks exactly one bit: "works" or "does not".
- Contents: tasks assigned to the token's owner in the token's workspace that have **at least one date** (a due date or a start date) and are open, plus tasks completed within the last **30 days** (marked `STATUS:COMPLETED`, so a checked-off task does not vanish from the calendar). Capped at **500 events**, ordered by the day each event sits on (due date, or the start date when there is no due date). Each event carries the task **title** and a link back into the app — **never the task description** (third-party calendar storage must not receive task bodies). Start–due spans render as multi-day all-day events (RFC 5545 exclusive `DTEND`); a due-only task sits on its due date, and a start-only task sits on its start date.
- **Rate limit:** 30 requests/minute, keyed by token (not IP — calendar providers fetch from large rotating egress fleets).
- Response headers: `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`.

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

## Shared Types

### Unsplash Search Response

Returned by both `/api/unsplash/search` and `/api/unsplash/curated`.

```json
{
  "page": 1,
  "perPage": 24,
  "total": 1200,
  "totalPages": 50,
  "results": [
    {
      "id": "abc123",
      "rawUrl": "https://images.unsplash.com/raw",
      "url": "https://images.unsplash.com/regular",
      "thumbUrl": "https://images.unsplash.com/thumb",
      "blurHash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      "color": "#abcdef",
      "description": "A mountain",
      "width": 4000,
      "height": 3000,
      "photoUrl": "https://unsplash.com/photos/abc123?utm_source=cadence&utm_medium=referral",
      "downloadLocation": "https://api.unsplash.com/photos/abc123/download?ixid=XXX",
      "user": {
        "name": "Jane Smith",
        "username": "janesmith",
        "profileUrl": "https://unsplash.com/@janesmith?utm_source=cadence&utm_medium=referral"
      }
    }
  ]
}
```

Each `result` entry matches the `UnsplashCoverPayload` shape in [`src/shared/schemas/unsplash.ts`](../../src/shared/schemas/unsplash.ts) and is the exact shape persisted to `project.coverUnsplash` / `task.coverUnsplash`. `photoUrl` and `user.profileUrl` always carry `utm_source=<UNSPLASH_APP_NAME>&utm_medium=referral` (defaults to `cadence`) to comply with Unsplash attribution guidelines. `downloadLocation` is passed verbatim to `service.trackDownload()` when a user applies a photo as a cover. `rawUrl` is the imgix-backed source URL used by the web client (via `buildUnsplashDisplayUrl` in `src/shared/lib/unsplash-display.ts`) to compose context-appropriate renditions — e.g. a 1600px-wide `cover` preset for banners and a 500px-wide `card` preset for picker thumbnails — instead of hotlinking the fixed 1080px `url` (now kept only as a legacy fallback).

### Recurrence Rule Object

Used in task create/update endpoints to define a recurring schedule. Stored as JSON in the `recurrenceRule` column.

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `frequency` | `string` | `"daily"`, `"weekly"`, `"monthly"`, or `"yearly"` | Yes |
| `interval` | `integer` | 1--365 | Yes |
| `daysOfWeek` | `integer[]` | 0 (Sun) -- 6 (Sat), min 1 element | No |
| `dayOfMonth` | `integer` | 1--31 | No |
| `nthWeekday` | `object` | `{ n: 1-5, day: 0-6 }` (e.g. 2nd Tuesday) | No |
| `endDate` | `string` | Strict `YYYY-MM-DD` calendar date (not a datetime), optional end condition. Validated calendar-aware: impossible dates are rejected with 400, since an unparseable end bound would make the recurrence series never terminate | No |

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
