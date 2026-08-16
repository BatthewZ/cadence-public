# API Tokens

## Overview

Personal Access Tokens (PATs) let trusted machine clients — Slackbots, GitHub Actions, custom internal tools, AI agents — call Cadence's `/api/*` endpoints without impersonating a real user via a session cookie. Each token is bound to one user and one workspace, carries an explicit set of scopes, and can be optionally restricted to a subset of projects.

PATs exist because cookie-based session auth is the wrong fit for unattended, long-running automation:

- **Sessions are short-lived and CSRF-sensitive.** They are designed for a browser carrying ambient credentials, not for a server that needs a stable secret it can store and reuse.
- **Sessions cannot be scoped.** A stolen session cookie has every permission the user has. PATs can be narrowed to read-only, to a single project, or to a single resource family.
- **Sessions cannot be revoked granularly.** Killing one Slackbot integration should not log every browser tab out. PAT revocation is per-token and instant.

Cadence uses **opaque** PATs (random strings looked up in the database) rather than self-signed JWTs. Opaque tokens give instant revocation, allow scope changes without reissuing the secret, and produce a centralized audit trail. JWT-style tokens require a denylist to support revocation, which is just an opaque-token lookup with extra cryptographic steps.

The stored hash is **HMAC-SHA256 keyed by a server-side pepper** (`TOKEN_HASH_PEPPER`, configured in env). Plain SHA-256 would let an attacker who exfiltrates the database verify guessed plaintexts offline; HMAC-keyed hashing makes the stored row useless without the server secret, so offline verification requires both the database AND the pepper. We do **not** use bcrypt/argon2 — the threat model is DB exfiltration, not online guessing against a low-entropy password, and Workers' free-tier 10 ms CPU budget per invocation cannot accommodate a useful KDF cost factor anyway. Rotating the pepper invalidates every minted token (treat it as a forced re-mint event for every integration).

PATs are intended for **machine clients only**. Inside a browser context, continue to use cookie auth — it's safer there (HttpOnly cookies are not readable by JS, PATs in localStorage are).

See also: [integrations.md](./integrations.md), [webhooks.md](./webhooks.md), [middleware.md](./middleware.md).

---

## Token Format

Tokens are issued in the form:

```
cdn_pat_<43 base64url characters>
```

| Component | Purpose |
| --- | --- |
| `cdn_pat_` prefix | Identifies the secret as a Cadence PAT. Allows cheap pre-hash rejection of malformed strings and enables secret-scanning tools (GitHub, Gitleaks, etc.) to detect leaks. |
| 43-char body | 32 bytes of CSPRNG output (`crypto.getRandomValues`, `TOKEN_RANDOM_BYTES`) encoded as unpadded base64url — 43 characters carrying the full **256 bits** of entropy, well above any brute-force concern. Calendar feed tokens (`cdn_cal_`) are minted by the same function with the same entropy and a different prefix, so a leaked feed URL can never authenticate an API call. |
| `tokenPrefix` (UI only) | The first 12 characters of the plaintext (e.g. `cdn_pat_a4kZ`). Stored alongside the hash and shown in the UI so users can identify a token without seeing the secret. |
| `tokenHash` (DB) | `HMAC-SHA256(TOKEN_HASH_PEPPER, plaintext)` stored as hex. The plaintext is **never** persisted, and the pepper lives only in the server's env binding, so a database exfil yields neither plaintext nor a verifiable-offline hash. |

The plaintext is shown to the user exactly once — at creation — and never again. If they lose it, an owner or admin rotates it (same user only) or revokes it and mints a replacement.

---

## Minting a Token

> Requires the workspace **owner** or **admin** role. A member opening this tab sees their own tokens and a note explaining that only owners and admins can issue new ones.

1. Navigate to **Settings → API Tokens**.
2. Click **New Token**.
3. Fill in:
   - **Name** — a human label (e.g. "Slackbot prod", "GitHub Actions CI"). Helps you identify the token later in the list and in activity attribution.
   - **Scopes** — checkboxes grouped by resource. See [Scopes Reference](#scopes-reference) below.
   - **Project Scope** — "All projects" or "Selected projects" (up to 50).
   - **Expiry** — the dropdown offers 30 days, 90 days and 365 days (1 year), and defaults to 1 year. The dialog also lists a "Never (not recommended)" entry, which the API rejects: v1 has no never-expires value, so that selection returns `400 Validation failed` rather than minting an unbounded token (see [Expiry](#expiry)). API callers may pass any `expiresInDays` from 1 to 3650 — the custom range is not exposed in the UI.
4. Submit. The plaintext token is displayed on the next screen with a prominent copy button.

> **You will not see this token again.** Cadence stores only the hash. If you close the reveal panel without copying, you must rotate the token to get a new plaintext.

---

## Scopes Reference

Every endpoint that reads or writes **workspace data** requires one or more scopes — including the aggregate surfaces (dashboards, search, activity, the notification inbox) and the file-serving routes that carry attachment bytes. Scopes are AND-ed with the user's actual role (see [Effective Permissions](#effective-permissions)).

Two families sit outside the grammar, in opposite directions:

- **Account-level endpoints carry no scope**, because they carry no workspace data: `GET /api/me` (your own profile), `GET /api/legal/tos-status` and `POST /api/legal/accept-tos`, and the `/api/unsplash/*` image-search proxy. A token of any shape reaches these as its owning human.
- **A small set rejects PAT auth outright**, no scope combination permitted — see [PATs cannot manage other tokens](#pats-cannot-manage-other-tokens) for the list and the rule behind it.

| Scope | Grants |
| --- | --- |
| `workspace:read` | Read workspace metadata, list members, poll `GET /workspaces/{id}/freshness`, and run the full workspace export (`GET /workspaces/{id}/export` — also owner/admin only, rate-limited to 5/hour, and audited) |
| `workspace:write` | Update workspace settings, delete a workspace (there is no `workspace:delete`), manage members, and run a workspace import |
| `project:read` | List and read projects, export a project to CSV, and read the endpoints whose body carries project-entity fields — `GET /workspaces/{id}/search` (the `projects` half of the result) and both dashboards |
| `project:write` | Create and update projects |
| `project:delete` | Delete projects |
| `task:read` | List and read tasks, plus everything derived from them: both dashboards, `my-tasks`, `upcoming`, every activity feed, the task half of search, and the notification inbox |
| `task:write` | Create and update tasks, and mutate notification state (mark read, mark-all-read, delete a notification) |
| `task:delete` | Delete tasks |
| `label:read` | List labels |
| `label:write` | Create, update, and delete labels |
| `attachment:read` | Download attachments — both the metadata routes under `/tasks/{id}/attachments` and the file-serving route that streams the bytes (`GET /api/uploads/{purpose}/{userId}/{filename}`, which also covers task/project cover images and avatars) |
| `attachment:write` | Upload and delete attachments, upload an avatar, and delete a stored upload |
| `team:read` | List teams |
| `team:write` | Create and update teams |
| `invitation:write` | Create and revoke workspace invitations. There is no `invitation:read` in v1, so `GET /workspaces/{id}/invitations` is gated on the owner/admin role alone. **Not** accepting an invitation, not reading an invite link, and not listing your own pending invitations — all three refuse PATs whatever scopes they hold |
| `webhook:read` | List webhooks |
| `webhook:write` | Manage webhooks |
| `read:*` | Aggregate — grants every `*:read` scope. **Does not include any `*:delete` scope.** |
| `write:*` | Aggregate — grants every `*:write` scope. **It does not grant reads** — pair it with `read:*` (or the individual `*:read` scopes) for a token that both reads and writes. **Does not include any `*:delete` scope.** |

**Delete scopes are never granted by aggregates.** Only two exist in the v1 grammar — `project:delete` and `task:delete` — and neither is implied by `read:*` or `write:*`; each must be ticked individually. This is deliberate: destructive operations on the two resources that carry the most data should never be granted by a wildcard. Every other resource folds deletion into its `:write` scope (deleting a label needs `label:write`, deleting an attachment or an upload needs `attachment:write`, deleting a workspace needs `workspace:write`), because there is no separate `:delete` scope to require.

Unknown scopes encountered on read are preserved for forward compatibility but ignored during authorization checks. The set of known scopes is validated at write time.

### Aggregate and cross-resource endpoints

Most endpoints sit under an obvious resource: `/tasks/...` needs `task:*`, `/teams/...` needs `team:*`. A handful read *across* resources, so which scope they demand is a judgement call rather than a reading of the URL. It is made by asking what the response body actually contains, and the answer is fixed here so integrations can predict it.

| Endpoint | Required scope(s) | Why |
| --- | --- | --- |
| `GET /workspaces/{id}/dashboard` | `task:read` **and** `project:read` | The body is a task rollup (counts, cost totals, per-member workload, overdue task titles/due dates/assignees) *plus* a project collection equivalent to `GET /workspaces/{id}/projects`. Both resources are genuinely present, so both scopes are required |
| `GET /projects/{id}/dashboard` | `task:read` **and** `project:read` | Same task rollup, plus `budget` — a project field. `task:read` alone would read the project's budget through a task endpoint |
| `GET /workspaces/{id}/dashboard/my-tasks` | `task:read` | Task rows only. The `projectName` on each row is a denormalised label on a task the token may already read, not the project resource |
| `GET /workspaces/{id}/dashboard/upcoming` | `task:read` | Same — task rows, bucketed by due date |
| `GET /workspaces/{id}/activity`, `GET /projects/{id}/activity` | `task:read` | A change feed over tasks, carrying the literal `oldValue`/`newValue` text of task fields. Matches `GET /tasks/{id}/activity`, so a change feed is a task read at every level it is offered |
| `GET /workspaces/{id}/search` | `task:read` **and** `project:read` | Returns `{ projects, tasks }` — two first-class resources, each a full entity representation. Gating on one scope would leave the other resource searchable by a token that may not read it |
| `GET /notifications`, `GET /notifications/unread-count` | `task:read` | There is no `notification:*` scope, and inventing one would fork the vocabulary for what is really a view over task activity: the producers copy the assigned task's title, the completed task's title, and a 200-character excerpt of the mentioning comment verbatim into `title`/`body`. So the inbox takes the scope of the data it exposes — the same reasoning that puts saved views under `project:*` |
| `PATCH /notifications/{id}/read`, `POST /notifications/mark-all-read`, `DELETE /notifications/{id}` | `task:write` | Durable mutations of inbox state the human relies on — `mark-all-read` can bury every unread notice they have. `task:delete` is deliberately **not** required for the delete: removing a notification is not removing a task, and the heightened scope stays reserved for real task deletion |
| `GET /uploads/{purpose}/{userId}/{filename}` | `attachment:read` | One path serves four kinds of bytes — task attachments, task covers, project covers and avatars — so the scope follows the bytes rather than the URL. Per-resource authorization (which task/project owns this object) is a separate question from capability, and both are asked: a token that may reach a file still has to say it wants file access. The avatar purpose is included deliberately rather than exempted, so the capability layer holds no per-purpose branch |

`read:*` covers every read above and `write:*` covers the notification mutations, so a broadly-scoped integration needs no special handling. Only narrowly-scoped tokens have to opt in to the second scope where two are listed.

---

## Project Scoping

Each token has a project scope, modeled on GitHub fine-grained PATs:

| Mode | Behavior |
| --- | --- |
| **All projects** | The token can access any project in the workspace that the owning user can access. |
| **Selected projects** | The token can access only the projects whose IDs are in its `projectIds` list. Maximum 50 projects per token. Requests naming another project return `403 Forbidden` (file downloads return a uniform `404` — see [group 1](#what-selected-projects-covers)); workspace-level list endpoints filter instead of refusing. |

Use selected-project scoping to limit blast radius. A Slackbot that only posts updates for one team's project does not need access to the rest of the workspace — give it a token scoped to that single project. If the bot's secret ever leaks, the projects outside its list stay out of reach for **reading project content**: their tasks, labels, activity, attachments, notifications and webhooks are all filtered or refused, and the token cannot register a webhook that would forward their events elsewhere.

That is a precise claim, not a blanket one. Read [What "selected projects" covers](#what-selected-projects-covers) before you rely on it — it lists every endpoint, names the three workspace-level surfaces the boundary deliberately does **not** cover, and names the one where it does not currently hold.

Project scope is checked **after** scope and role checks. A token with `task:write` but no access to project X cannot create tasks in project X, even if the owning user can.

### What "selected projects" covers

Endpoints fall into three groups, and the reasoning for each placement is given below because it is a design decision rather than an accident. A fourth, shorter list follows the three: the surfaces project scope does **not** narrow — three by design, and one [known gap](#known-gap-delete-uploadsid).

**1. Endpoints addressed by project or task — the token is refused (`403`).**

Anything under `/projects/{projectId}`, `/tasks/{taskId}`, `/subtasks/{subtaskId}`, `/comments/{commentId}` or `/task-groups/{taskGroupId}` resolves the owning project and evaluates `tokenAllowsProject`. A project outside the list answers a bare `403 Forbidden` — the same body a non-member gets, so the response never reveals whether the project exists.

`GET /uploads/{purpose}/{userId}/{filename}` belongs to this group even though its URL names no project: it resolves the owning task or project from the stored object and evaluates the same predicate. Its denial is the one deliberate exception to the `403` convention — every authorization failure there answers a uniform `404 File not found`, matching a genuinely missing object. These URLs are unguessable capabilities rather than ids a caller could have obtained from a listing, so `403` would confirm that a named object exists and belongs to someone else.

**2. Workspace-level list and aggregate endpoints — the token sees less.**

These read across every project at once, so they *filter* rather than refuse: a narrowed token gets its own projects' rows and no error. This is the friendlier failure mode and it keeps a mis-scoped token obvious (empty results) rather than looking like a permissions outage.

| Endpoint | What a selected-projects token sees |
| --- | --- |
| `GET /workspaces/{id}/projects` | Only projects on its list |
| `GET /workspaces/{id}/search` | Only matching projects and tasks from projects on its list |
| `GET /workspaces/{id}/dashboard` | Only its projects — **including the rolled-up counts, cost totals and per-member workload** |
| `GET /workspaces/{id}/dashboard/my-tasks` | Only its projects' tasks. Intersects with the caller's own `projectIds` query filter; asking for a project outside the list returns an empty page, not that project |
| `GET /workspaces/{id}/dashboard/upcoming` | Only its projects' tasks, in every time bucket |
| `GET /workspaces/{id}/activity` | Only its projects' activity, including the `oldValue`/`newValue` change text |
| `GET /workspaces/{id}/labels` | Only labels defined in its projects |
| `GET /workspaces/{id}/task-groups?projectIds=` | Only groups from requested ids that are on its list; other ids are silently dropped, exactly as ids the human cannot see already are |
| `GET /workspaces/{id}/webhooks` | Only webhooks targeting a project on its list. Workspace-wide webhooks (`projectId: null`) are excluded — their event stream covers every project |
| `GET /notifications`, `GET /notifications/unread-count` | Only notifications for projects on its list, plus workspace-level notifications (invitations) for its own workspace. See [Notifications](#notifications) below — these routes have no `:workspaceId`, so the token's **workspace** binding is applied here too |
| `PATCH /notifications/{id}/read`, `DELETE /notifications/{id}`, `POST /notifications/mark-all-read` | Same scope. An out-of-scope id answers `404`, identical to a nonexistent one; `mark-all-read` sweeps only what the token can see |

A token whose `projectIds` list is empty, missing or unreadable sees **nothing** from these endpoints. Project scoping fails closed everywhere.

**3. Whole-workspace operations — the token is refused (`403`).**

| Endpoint | Why refusal, not filtering |
| --- | --- |
| `GET /workspaces/{id}/export` | The export is a versioned archive that asserts completeness about itself: its members, teams, invitations and user directory are workspace-level, and [import](../guides/export-import.md) reconstructs a workspace from it. A filtered file would look byte-for-byte like a complete archive while silently missing projects. There is no honest partial form, so a selected-projects token is refused. **An `all`-projects token still exports normally** — backup integrations are unaffected |
| `POST /workspaces/{id}/webhooks` with `projectId: null` | A workspace-wide subscription receives `task.*` events from every project. Allowing it would make the whole boundary bypassable: denied a project directly, a token would just subscribe workspace-wide and receive its events anyway |

Webhook writes are bound on both ends. A selected-projects token may create, edit, test and delete webhooks only for projects on its list; it cannot repoint one of its own webhooks at another project or to workspace-wide, and it cannot repoint *another* project's webhook onto its own list (which would otherwise let it seize that project's subscription, change its URL and rotate its secret).

#### Notifications

`notification` rows are keyed by **user** rather than by workspace — `/notifications` has no `:workspaceId` in its path and mounts `requireAuth` alone. (`upload` is the other user-keyed tenant table; its read path is bound, its delete path is the [known gap](#known-gap-delete-uploadsid) below.) Notifications are nonetheless project data: the row carries `projectId`/`taskId`/`commentId`, and the producers copy project content into the text (the assigned task's title, the completed task's title, and a 200-character excerpt of the comment that mentioned you). So a PAT caller is narrowed here by **both** halves of the policy — the token's workspace binding *and* its project list — while a cookie session sees its whole inbox unchanged.

Rows with no `projectId` are workspace-level (today only "you were invited to workspace X"). Those are shown to a selected-projects token as long as they belong to its own workspace: project scope narrows project-owned data, and for workspace-owned data the token's workspace binding is the applicable control. Rows tied to neither a project nor a workspace are always shown.

#### Not narrowed, by design

Three surfaces sit outside project narrowing deliberately. Each is a decision with a reason, and each has a caveat worth reading before you rely on the boundary.

- **`GET /workspaces/{id}/freshness`** returns three cache-invalidation timestamps (`MAX(updatedAt)` for the workspace, its projects and its tasks). It is a shared edge cache keyed by workspace, so per-token narrowing would defeat the cache for every caller. It carries no names, ids or content — only "something changed at time T" — which is why the timing signal is accepted rather than eliminated. It does require `workspace:read`.
- **`POST /workspaces/{id}/projects`** — a selected-projects token with `project:write` and an owner/admin human behind it can still **create** a project. Nothing is disclosed (the new project is not on the token's list, so the token cannot read it back through any endpoint above), but the workspace does gain a project the operator did not anticipate. If your threat model cares about workspace shape as well as workspace content, do not grant `project:write` to a narrowed token, or route project creation through cookie auth.
- **`POST /workspaces/{id}/import`** creates **new** projects from an uploaded file, and is unfiltered for the same reason and with the same caveat: it reads no existing project, so it cannot disclose one, but a narrowed token with owner/admin role can add projects it will never be able to read back.

`POST /projects/{projectId}/duplicate` belongs to the same family without being an exception to the rule: the *source* project must be on the token's list (it is guarded by `requireProjectRole`, so the full policy applies), but the copy it creates is a new project that is not. Same caveat as project creation — a narrowed token holding `project:write` can grow the workspace, and the grant to withhold is the same one.

#### Known gap: `DELETE /uploads/{id}`

One surface is unnarrowed and should not be. It is listed here rather than left out, because a boundary you believe in is worse than one you know the edges of.

`DELETE /uploads/{id}` is authorized by **uploader identity alone** — the handler deletes only the row whose `upload.userId` matches the caller. Neither half of the token policy is applied: the route carries no `:workspaceId`, so the workspace binding is never evaluated, and it resolves no owning project, so the selected list is never consulted. `attachment:write` gates it as a capability, and **capability is not selection**. Because `task_attachment.uploadId` cascades on upload deletion, the route's reach extends to attachment rows belonging to projects outside a narrowed token's list.

What this means in practice: do not treat a narrowed token holding `attachment:write` as unable to remove its own owner's uploads outside the selected projects. Withhold `attachment:write` from narrowed tokens that must not have it, and remove task attachments through `DELETE /tasks/{taskId}/attachments/{attachmentId}` instead, which resolves the owning project and evaluates the full policy. This bullet describes a defect awaiting a fix, not a design decision — when the fix lands, this section goes away.

The read side of the same resource is already bound: `GET /uploads/{purpose}/{userId}/{filename}` resolves the owning task or project and evaluates `tokenAllowsProject` on every branch.

#### Everything else

Everything else behind a workspace-level guard — workspace settings, members, teams, invitations — is workspace-owned rather than project-owned, so project scope has nothing to narrow, and the token's workspace binding applies to all of it. Team membership in particular writes no project rows: `team`/`team_member` carry no project linkage, so a team change cannot reach into a project.

One consequence of that boundary is worth stating explicitly, because it is about *people* rather than data. `PATCH /workspaces/{id}/members/{userId}` and `POST /workspaces/{id}/invitations` are workspace-owned writes and are not narrowed — but promoting a member to `admin`, or inviting one at that role, gives **that human** elevated access to every project in the workspace. A narrowed token holding `workspace:write` or `invitation:write` therefore has an indirect effect on projects it cannot itself read. Grant those two scopes to narrowed tokens only when the integration genuinely manages membership.

Two workspace-level routes are exceptions to that, because although the *route* is workspace-level the *effect* reaches directly into project rows. Both refuse a `projectScope: "selected"` token outright with `403 Forbidden` rather than narrowing, for the same reason the export does — there is no partial form of either operation:

- **`DELETE /workspaces/{id}`** destroys every project in the workspace, including ones the token was never selected for. A token that may not read a project must not be able to delete it.
- **`DELETE /workspaces/{id}/members/{userId}`** revokes the member's access across *every* project in the workspace in one all-or-nothing batch. Narrowing that cascade would revoke some project rows and leave the workspace membership standing — a half-revoked user, which is the exact state the removal path exists to prevent.

---

## Effective Permissions

The authorization model is:

```
effective_permissions = token.scopes ∩ user.role_permissions ∩ token.project_scope
```

A token **cannot grant more than the human owner has.** Examples:

| User role | Token scopes | Result |
| --- | --- | --- |
| Workspace admin | `task:write` | Can create/update tasks |
| Workspace member (not admin) | `workspace:write` | **Still cannot update workspace settings** — the human can't either |
| Project viewer on project X | `task:write`, project scope = all | Cannot create tasks in project X; can in projects where the user has writer access |
| Workspace admin | `read:*` | Read-only despite being an admin; the token narrows the scope |

This prevents privilege escalation by token issuance. Lowering a user's role downstream automatically tightens every token they own — no reissue or revoke required.

---

## Workspace Scoping

Each token is bound to exactly one workspace at creation time. Requests using the token against any other workspace return `403`. Both this binding and the selected-project narrowing are defined once, in `tokenAllowsProject` in [`src/api/middleware/authorize.ts`](../../src/api/middleware/authorize.ts), and are evaluated independently of scope — so the answer is "no" even if the scopes would otherwise allow the action.

Two guard families evaluate that policy, and the difference between them is the thing to understand before adding a route.

**Routes whose URL names a project or task.** `requireProjectAccess`, `requireProjectRole`, `requireTaskAccess` and `requireTaskRole` resolve the owning project and call `enforceTokenProjectBinding` — both halves of the policy, workspace binding and project selection. Routes that carry neither id (`/subtasks/:subtaskId`, `/comments/:commentId`, `/task-groups/:taskGroupId`) resolve the owning project inline and must call `enforceTokenProjectBinding` themselves; they mount the `task:*` scope middleware too, but **capability scope is not project selection**, so without that call they would honour any token whose owning human could reach the project.

**Routes whose URL names only a workspace.** `requireWorkspaceMember` and `requireWorkspaceRole` can enforce only the *workspace* half — they see a `:workspaceId` and cannot know which projects a response will end up containing. Project selection on these routes is therefore the handler's job, using the same single-sourced policy in one of two forms:

- `tokenProjectScopeFilter(c, <projectIdColumn>)` — a `WHERE` fragment that narrows a query to the token's projects. It returns `undefined` for cookie sessions and `all`-scope tokens, so the generated SQL for a human is unchanged.
- `enforceTokenWorkspaceWideAccess(c)` — a `403` for any selected-projects token, for operations that have no meaningful partial form.

Note that `tokenProjectScopeFilter` is the **project half only** — it never reads `token.workspaceId`. On a route mounted behind `requireWorkspaceMember` / `requireWorkspaceRole` that is fine, because the guard has already matched the token's workspace against the URL. A route with no `:workspaceId` at all must supply the workspace half some other way, or a token bound to workspace A reads workspace B's rows. Two tenant-data route families are in that position today, and they solve it differently because their shapes differ:

- `/notifications*` queries rows directly and pairs the two filters — `tokenWorkspaceScopeFilter(c, <workspaceIdColumn>)` alongside `tokenProjectScopeFilter`. It is the only route family that needs the filter form of the workspace half.
- `GET /uploads/:purpose/:userId/:filename` resolves the owning task or project first, then calls `tokenAllowsProject` on the resolved row — which is *both* halves in one predicate, so no separate workspace filter is needed.

`GET /workspaces` is a third case: it has no `:workspaceId` and no project data at all, so it applies `tokenWorkspaceScopeFilter` alone (see [Workspace binding on the workspace list](#workspace-binding-on-the-workspace-list)).

`DELETE /uploads/:id` is the fourth, and the one that does not yet do either. It is keyed by the uploading user, resolves no project and sits behind no workspace guard, so it currently applies neither half — see [Known gap](#known-gap-delete-uploadsid). Treat it as the worked example of why this section exists.

All of these live beside `tokenAllowsProject` in [`authorize.ts`](../../src/api/middleware/authorize.ts), and the enumeration form is held in agreement with the predicate by an equivalence test, so there is one definition of "selected" in the codebase and not two. [What "selected projects" covers](#what-selected-projects-covers) lists which endpoint uses which. **Any new route that reads or writes project-owned data must apply one of these forms**, whichever guard it sits behind: a workspace-level guard alone is not sufficient, a capability scope alone is not sufficient, and a route with no guard at all but a user-keyed table is the shape that has caught this codebase out twice.

To integrate with multiple workspaces, mint one token per workspace. Do not share tokens across workspaces.

---

## Authentication

Send the token in the `Authorization` header on every request:

```
Authorization: Bearer cdn_pat_<43 chars>
```

- **CORS:** PAT requests do not rely on cookies, so the standard CORS preflight rules apply to the `Authorization` header. Configure your origin allowlist accordingly when calling from a browser-based admin tool.
- **CSRF:** PATs are header-based and carry no ambient credentials. There is no CSRF risk — a browser will never automatically attach a PAT to a cross-origin request.
- **Cookie fallback:** If the `Authorization` header is present but the token is invalid (malformed, expired, revoked, or unknown), the request returns `401 Invalid API token` immediately. The server **does not fall back to cookie authentication** when a Bearer token is present. This prevents a downgrade attack where an attacker presents a stale PAT and silently rides a victim's cookie session.

---

## Expiry

Tokens may be set to expire after **30 days**, **90 days**, **365 days**, or any custom duration up to **3650 days (10 years)**. If `expiresInDays` is omitted at creation, it defaults to **365 days**.

**There is no "never expires" option in v1.** Every token must have an explicit expiry. The reasoning: a token with no expiry creates an indefinite blast radius if the secret is ever exfiltrated and the operator who minted it has moved on. A 10-year maximum keeps the door open for trusted long-running automation while guaranteeing a periodic re-evaluation event.

Expired tokens are not deleted; they are rejected at authentication with `401`. This preserves the audit trail and lets the UI display "Expired" status. An owner or admin rotates or mints a new token to restore access.

The UI surfaces an amber warning when a token has fewer than 7 days remaining so operators have time to roll the secret without downtime.

---

## Rotation

Long-lived secrets should be rotated periodically. The **Rotate** action in the UI streamlines this:

1. Click **Rotate** on an existing token.
2. Cadence mints a **sibling token** with identical scopes, project scope and project list, named `<original name> (rotated)`.
3. The plaintext for the new token is shown in the same one-time reveal panel.
4. The **old token is scheduled for automatic revocation in 7 days** (`revokeAt = now + 7d`).
5. During the 7-day grace window, **both tokens work**. Deploy the new secret, verify, and the old one self-destructs.

The sibling inherits the original's **absolute `expiresAt`**, not a fresh lifetime. Rotation replaces a secret; it does not extend a token's life, which is what stops rotation being used to keep a credential alive indefinitely. Rotating a token that expires next week gives you a new secret that also expires next week — mint a new token instead if you want a new clock.

A token that has already been rotated cannot be rotated again (`409`), and a revoked token cannot be rotated at all (`409`). This pattern lets operators rotate secrets with zero downtime. After deployment, you can revoke the old token manually instead of waiting the full 7 days.

Rotation preserves the audit lineage via `rotatedToId` — activity records and attribution survive rotation. Every rotation triggers an out-of-band security email to the token owner because rotation produces a new plaintext credential (security-equivalent to a fresh mint).

### Automatic revocation sweep

Scheduled auto-revocation is driven by `processScheduledTokenRevocations`, a task that runs inside the **scheduled handler invoked every 5 minutes** (Cloudflare Cron Trigger). The task finds tokens where `revokeAt < now AND revokedAt IS NULL`, sets `revokedAt = now`, and emits telemetry for each revocation. It is error-isolated like the other scheduled cleanup tasks — a failure in this sweep cannot prevent webhook retries or notification cleanup from running.

The 5-minute interval means a rotated token's actual revocation lands somewhere in `[revokeAt, revokeAt + 5min]`. We document the grace window as "7 days" rather than "7 days and up to 5 minutes" because the difference is operationally irrelevant — the integration is expected to be cut over well before the window closes.

---

## Revocation

Tokens can be revoked at any time. Revocation is **instant** — the next request using the token returns `401`.

| Who can revoke | What they can revoke |
| --- | --- |
| Token owner | Their own tokens, at any time |
| Workspace owner / admin | **Any token in their workspace** — for emergency response when a member's machine is compromised |

Revocation is implemented as a soft-delete: `revokedAt` is set to the current timestamp. The row is retained so the audit trail (activity attribution, last-used timestamps) survives. Revoked tokens are hidden from listings by default and reappear when the settings UI's **Show revoked** toggle is on (`?includeRevoked=true` on the list endpoint).

A token cannot be un-revoked. An owner or admin must mint a new one if access is needed again — which is why a member, who can revoke but not mint, should be sure before revoking their last token.

---

## Authorization Policy

The token management endpoints follow a deliberately tight policy along two independent axes. The first is credential class: a leaked PAT must never be able to mint replacements or silently rotate itself out of audit visibility. The second is workspace role: **issuing a credential is an administrative act**, so the two endpoints that put a new secret into someone's hands — mint and rotate — require the workspace `owner` or `admin` role. Both axes must pass.

| Action | Who can perform |
| --- | --- |
| **Mint** (`POST /api-tokens`) | Workspace **owner / admin** only, and always for their **own** tokens — nobody can mint on behalf of another user. A plain member gets `403`. |
| **List own** (`GET /api-tokens`) | Any workspace member sees their own tokens. |
| **List all in workspace** | Workspace owner / admin only. Members see only the tokens they own. |
| **Get detail** (`GET /api-tokens/{id}`) | Token owner; workspace owner / admin can also read any token in the workspace. |
| **Rotate** (`POST /api-tokens/{id}/rotate`) | Workspace **owner / admin**, **and** the token's own owner — both conditions. An admin cannot rotate someone else's token, because rotation produces a new plaintext that only the owning user should ever see; the correct admin remediation is to revoke. The role half is what stops a member who was demoted after minting from renewing that credential indefinitely. |
| **Revoke** (`DELETE /api-tokens/{id}`) | Token owner; workspace owner / admin. Admins need this for emergency response when a member's machine is compromised. The token owner is always emailed when a revocation lands, even when an admin initiates it, so the owner finds out before their integration breaks. |

### What a plain member can still do

A member is not locked out of the tab — they keep the two actions that reduce risk rather than create it:

- **See** the tokens they own, including scopes, project access, last-used and expiry, so they can audit their own footprint.
- **Revoke** any of their own tokens, immediately and without asking anyone.

They cannot mint or rotate. The UI reflects this exactly: the **New Token** button is absent, the per-token **Rotate** action is disabled, **Revoke** stays live, and an info callout explains the restriction. Because revocation is one-way for them, a member who revokes their last token must ask an owner or admin to issue a replacement.

Tokens minted before this policy, or held by someone since demoted to member, keep working until they expire or are revoked — the change gates issuance, it does not retroactively invalidate credentials. Admins see every member's token in the list and can revoke deliberately.

### PATs cannot manage other tokens

Every token management endpoint rejects requests authenticated via a PAT with `403`. Cookie authentication is therefore **necessary** for all five endpoints — and for mint and rotate it is not **sufficient**, since those also require the owner/admin role above. This bypass prevents a compromised PAT from:

- Minting a sibling token with broader scopes and discarding the original (silent privilege escalation).
- Rotating itself to extend its effective lifetime past discovery.
- Enumerating other tokens in the workspace.

If you need automation to *use* tokens, mint them out-of-band via the UI as an owner or admin, then store the plaintext in your secret manager.

#### The same lockout applies beyond token management

The generalised rule is that **a machine credential must never be able to mint or harvest another credential**, so the same `403` guards four further surfaces. The message names the credential at stake rather than repeating the generic token-management wording, because "API tokens cannot manage other tokens" on an invitation route names the wrong resource and sends an integration developer hunting for a scope that does not exist:

| Endpoint | 403 message | Why no PAT, at any scope |
| --- | --- | --- |
| `GET` / `POST` / `DELETE /api/workspaces/:workspaceId/calendar-feed` | `API tokens cannot manage other tokens` | Minting a feed URL is minting a second, independently-revocable credential for the user. |
| `GET /api/workspaces/:workspaceId/invitations/:id/link` | `API tokens cannot retrieve invitation links` | The only endpoint that still returns a raw invitation token. Scopes cannot cover it — write-scope middleware no-ops on `GET`, and there is no `invitation:read` scope in the v1 grammar. |
| `GET /api/invitations/pending` | `API tokens cannot list invitations` | Lists exactly the invitations the caller could accept, so it is the discovery half of the same action `POST /invitations/accept` already refuses; refusing one and allowing the other would be an incoherent rule. Filtering was rejected as the treatment because the handler selects by the caller's **email**, not by workspace — a filter would still leave a machine credential enumerating its owner's invitations, which serves no integration. |
| `POST /api/invitations/accept` | `API tokens cannot accept invitations` | Accepting converts a bearer credential into durable workspace membership. PAT auth bridges its owning user into the request as an ordinary user, so `requireAuth` alone cannot tell a token from a session. Adding a scope would only have asked "does this token hold `invitation:write`?" when the right answer is "no token may do this at all". |

Nothing legitimate is lost: joining a workspace, reviewing your own invitations and copying an invite link are human actions taken from a browser, and an integration has no reason to perform any of them.

### Workspace binding on the workspace list

`GET /api/workspaces` honours the token's workspace binding. It selects by the **user**, so for a cookie session it still returns every workspace the human belongs to — the browser's workspace switcher is unchanged — but a PAT sees only the one workspace it was minted for. The binding is applied through `tokenWorkspaceScopeFilter` in `listWorkspaces` ([`workspaces.handlers.ts`](../../src/api/routes/workspaces/workspaces.handlers.ts)) and restricts **any** token, including `projectScope: "all"` ones: this is the workspace half of the policy, which is a separate control from project scope.

Two consequences worth knowing before you build against it:

- A token cannot be used to discover the names, slugs or ids of sibling workspaces its owning human belongs to. Do not write an integration that expects to enumerate them.
- This is a narrowing of the list only. It is not what stops cross-workspace access — that is the per-request binding evaluated by every workspace-, project- and task-level guard, which answers `403` regardless of what any listing returned.

The practical recommendation is unchanged: **mint one PAT per workspace.** An integration that spans workspaces holds one token per workspace and picks the right one by workspace id.

---

## `lastUsedAt` and Unused-Token Warnings

Every successful authentication updates the token's `lastUsedAt` timestamp via a fire-and-forget deferred write — it never blocks the request.

The UI shows `lastUsedAt` as a relative time ("3 hours ago", "Never used") on each token card in Settings → API Tokens. The card's only automatic warning today is the amber **expiry** indicator that appears when a token has fewer than 7 days of life left; there is no automatic staleness flag, so reviewing "Last used" is a manual operator habit rather than something the UI nags about. Do it anyway — if the integration that minted a token no longer exists, the token should be revoked (see [Security Best Practices](#security-best-practices), which suggests 30 days of disuse as the trigger).

---

## Activity Attribution

Two parallel attribution surfaces work together:

### 1. User-facing task activity feed

Task mutations made via a PAT are attributed in the task activity feed as:

```
Jane Smith (via Slackbot prod) created task "Fix login bug"
```

`task_activity.apiTokenId` is a `set null` FK to the token, so the attribution survives revocation. If the token is later hard-deleted, the activity record still shows `(via deleted token)`. PATs do **not** generate synthetic bot users — the owning human remains the actor on every record, with the token name as a parenthetical. This keeps `assigneeId`, mention notifications, and existing `createdBy` logic working without special cases.

### 2. Data egress & cross-resource audit ledger (`audit_log`)

For every other resource a PAT can touch (workspaces, projects, labels, teams, webhooks, invitations, attachments, the api-tokens management surface itself), a row is appended to `audit_log` on every successful 2xx mutation. This is the source of truth for "what has this token done?" — exactly the question an operator needs answered when deciding whether to revoke a misbehaving integration.

The ledger captures:

- `apiTokenId`, `actorUserId`, `workspaceId` — the principal trio. `apiTokenId` is **nullable**: it is the token id for PAT-attributed events, and `null` for cookie-session events (e.g. a human-initiated workspace export), so human-initiated activity is attributable without a token.
- `resourceType` / `resourceId` — derived from the matched route pattern
- `action` — `create` / `update` / `delete` for collection / item ops, plus verbs like `complete`, `rotate`, `move`, and the data-movement verbs `export` / `import`
- `method`, `path`, `status` — the raw HTTP envelope so an investigator can reconstruct the exact request
- `metadata` — JSON-encoded context (route params for mutations; for an export, the `includeActivity` flag plus project/task counts)

Writes happen through a post-response middleware via `deferWork`, so they never block the response. Failed audit inserts are logged and dropped — the audit signal must never break the API surface. Indexes target the four queries that matter: `(workspaceId, createdAt)`, `(apiTokenId, createdAt)`, `(resourceType, resourceId)`, and `(actorUserId, createdAt)` — "what happened in this workspace", "what has this token done", "who touched this record", and "what has this human done". Both the PAT writer (`recordPatAuditLog`) and the data-egress writer (`recordWorkspaceDataEvent`) delegate to one shared insert path, so there is a single source of truth for how a row is persisted (CLAUDE.md rule 4).

Reads, GETs, and non-2xx responses are deliberately **not** audited: read traffic belongs in the access log; failed requests don't represent state changes and would let an attacker flood the audit table. **The one deliberate exception is workspace data egress** — `GET /api/workspaces/:workspaceId/export` writes an `export` row (via `recordWorkspaceDataEvent`) even though it is a read, because a full-workspace download is precisely the event an operator must be able to reconstruct after a suspected leak. It is recorded whether the caller authenticated with a PAT or a cookie session.

---

## Rate Limits

**A PAT gets its own rate-limit bucket, not a bigger one.** Every mounted limiter passes an explicit `max` that applies to PAT and cookie callers alike, so plan an integration against the per-route limits documented in the interactive API reference at `/api/docs` — not against a token-specific allowance.

`RATE_LIMIT_DEFAULTS` in [`src/api/middleware/rate-limit.ts`](../../src/api/middleware/rate-limit.ts) does define a `PAT_MAX` of 600/min against a `COOKIE_MAX` of 120/min, and `rateLimitPatAware` would apply them — the intuition being that a cookie session is a human clicking at human pace while a PAT is a machine that may legitimately batch-fetch or sync on a schedule. **That helper has no route mounts today**, so those two constants record an intended ceiling rather than live behaviour. They are documented here only so the names are not mistaken for something in force.

What a token *does* get is its own bucket. Limiters that opt into `defaultRateLimitKey` — 28 of the 36 mounted today — key on `pat:<tokenId>`, so two PATs owned by the same user never contend with each other, and a token's traffic never eats into its owner's browser-session allowance (`user:<userId>`). Rotated tokens get a fresh key. The remaining limiters key on client IP, which is also the fallback for unauthenticated requests.

See [rate-limiting.md](./rate-limiting.md) for the broader rate-limit model.

The **token-management surface itself** (`/api/workspaces/:id/api-tokens/*`) sits behind a separate, tighter per-user limiter — 20 requests/minute. These endpoints already reject PAT callers entirely (see [Authorization Policy](#authorization-policy)), and the rate limit ensures even a compromised session cannot spam mint/rotate/revoke to fan out emails or churn the audit ledger.

Token-management responses also carry `Cache-Control: no-store` so a misconfigured CDN or corporate proxy cannot retain token metadata across users.

---

## curl Examples

The general form of any PAT-authenticated request is:

```
curl -H "Authorization: Bearer cdn_pat_..." https://your-cadence-host/api/...
```

### Token management

These endpoints require **cookie authentication** — PATs cannot mint, list, rotate, or revoke other tokens (they receive `403`). This is a deliberate lockout: a compromised PAT must not be able to bootstrap further access. The calendar-feed, invitation copy-link, `GET /api/invitations/pending` and `POST /api/invitations/accept` endpoints are locked out the same way and for the same reason — see [The same lockout applies beyond token management](#the-same-lockout-applies-beyond-token-management).

```bash
# List your tokens in a workspace (active, rotating, and expired — revoked
# tokens are hidden by default; see the `includeRevoked` flag below)
curl -H "Cookie: better-auth.session_token=..." \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens

# Include revoked tokens (used by the workspace settings "Show revoked"
# toggle and incident-response tooling). Revoked tokens are kept in the
# database indefinitely so historical activity attribution survives, but
# are excluded from listings by default to keep the response and UI tidy.
curl -H "Cookie: better-auth.session_token=..." \
  "https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens?includeRevoked=true"

# Mint a token — plaintext is returned EXACTLY ONCE in the response body
curl -X POST \
  -H "Cookie: better-auth.session_token=..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack release bot",
    "scopes": ["task:read", "task:write"],
    "projectScope": "selected",
    "projectIds": ["3f7c1e02-9a5b-4d31-8c6f-2b19d0e4a7c5"],
    "expiresInDays": 90
  }' \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens

# Rotate — mints a sibling with identical scopes, schedules the old token
# for revocation in 7 days, and returns the new plaintext (one-time)
curl -X POST \
  -H "Cookie: better-auth.session_token=..." \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens/{tokenId}/rotate

# Revoke — instant, soft-delete (sets revokedAt = now)
curl -X DELETE \
  -H "Cookie: better-auth.session_token=..." \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens/{tokenId}
```

**Ids are plain UUIDs.** `projectIds`, `{workspaceId}`, `{tokenId}` and every other id in these examples are `crypto.randomUUID()` values with no type prefix. Max 50 entries in `projectIds`, and every id must belong to the token's workspace — an id that does not returns `400 Project ids not found in workspace: …`.

**Default expiry:** `expiresInDays` defaults to **365** when omitted. The accepted range is **1 to 3650** (10 years). A `null` value meaning "never expires" is **not accepted in v1** — the field is an optional integer, so `null` fails validation with `400`. Every token must have an explicit expiry, which forces a periodic operator decision rather than a fire-and-forget secret.

### Using a PAT

```bash
# The token's own workspace (a PAT sees only the workspace it is bound to;
# a cookie session sees every workspace the human belongs to)
curl -H "Authorization: Bearer cdn_pat_..." \
  https://your-cadence-host.com/api/workspaces

# Create a task in a project the token is scoped to. `taskGroupId` is
# REQUIRED — a task always belongs to a column, so fetch the project's
# groups first via GET /api/projects/{projectId}/task-groups. There is no
# `status` field on create; completion is a separate endpoint
# (POST /api/tasks/{taskId}/complete).
curl -X POST \
  -H "Authorization: Bearer cdn_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"title":"From Slack","taskGroupId":"9b2f47a1-0c3d-4e58-9a17-5d8e6f2b0c34","priority":"high"}' \
  https://your-cadence-host.com/api/projects/{projectId}/tasks
```

The interactive reference at `/api/docs` (Scalar UI) accepts a PAT via its **Authorize** button so endpoints can be exercised directly from the browser. See [integrations.md](./integrations.md) for end-to-end Slackbot and GitHub Actions walkthroughs.

---

## Security Best Practices

1. **Store in a secret manager.** Never hard-code a PAT into source. Use AWS Secrets Manager, GCP Secret Manager, GitHub Actions secrets, 1Password, Doppler, etc.
2. **Rotate every 90 days** (or sooner). Use the in-app Rotate action so you get a 7-day grace window — no downtime, no panic. Rotation requires the owner/admin role, so keep long-lived integration tokens owned by an admin rather than by a member who may later lose the ability to renew them.
3. **Use the minimum scope.** A read-only Slackbot doesn't need `write:*`. A token scoped to one project can't be misused to delete others.
4. **Prefer "Selected projects" over "All projects"** whenever possible. Smaller blast radius if the secret leaks.
5. **Monitor `lastUsedAt`.** Revoke tokens unused for over 30 days. Stale credentials are an attack surface, not a convenience.
6. **Revoke immediately on suspected leak.** Don't wait. The action is instant, and any owner or admin can mint a replacement.
7. **Never log the plaintext.** The prefix (`cdn_pat_a4kZ…`) is safe to log for diagnostics; the full token is not.
8. **Don't share tokens between humans.** PATs are per-user, and a shared secret destroys attribution. If a teammate needs API access they mint their own — which requires the owner or admin role, so either promote them or have an admin own the integration token outright.
9. **Don't ship PATs in browser code.** They have no SameSite or HttpOnly protection in a browser. Use cookie auth in browsers and PATs only on servers and trusted CLIs.

---

## Operational Notes

- The token format includes the `cdn_pat_` prefix specifically to enable secret scanners to detect leaks in commits, logs, and shared documents.
- Do **not** commit tokens to git, even in private repositories. Once a secret is in git history, it must be rotated — `git rm` is not a fix.
- If a PAT is committed by accident: revoke immediately via the UI, then have an owner or admin mint a replacement. Rewriting git history is not sufficient — assume the secret is compromised.

### Secret scanning

Cadence Personal Access Tokens use the `cdn_pat_` prefix so they can be detected by automated secret scanners.

The repo's own scanner is configured to flag `cdn_pat_[A-Za-z0-9_-]{32,}` matches in commits. See [.gitleaks.toml](../../.gitleaks.toml) for the active rule.

If you accidentally commit a token, **revoke it immediately** via the Settings → API Tokens UI, then have an owner or admin mint a replacement. Rotation does not help here — the leaked plaintext is already exposed.

If you're hosting Cadence yourself and want GitHub-native secret scanning, you can register the `cdn_pat_` prefix as a custom secret pattern in your GitHub organization settings.
