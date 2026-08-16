# Integrations

## Overview

This guide explains how to build integrations against Cadence. There are two pillars:

| Direction | Primitive | Use for |
| --- | --- | --- |
| **Inbound** — your code calls Cadence | [API Tokens (PATs)](./api-tokens.md) | Triggering Cadence actions from external systems (creating tasks, listing projects, uploading attachments). |
| **Outbound** — Cadence calls your code | [Webhooks](./webhooks.md) | Reacting to events in Cadence (a task was created, a project member was added). |

Most real integrations use **both** primitives: a webhook tells your code something happened, and a PAT lets your code respond by mutating Cadence state.

See also: [api-tokens.md](./api-tokens.md), [webhooks.md](./webhooks.md), [api.md](./api.md).

---

## Choosing the Right Primitive

| Need | Use |
| --- | --- |
| "When task X is created, post to Slack" | Webhook |
| "When a Slack slash command runs, create a Cadence task" | PAT |
| "When a project is archived, write a row to our data warehouse" | Webhook |
| "GitHub Action creates a task on every PR open" | PAT |
| "Bi-directional sync between Cadence and Linear" | Both |
| "Daily digest emailed to all members" | PAT (scheduled cron on your side) |
| "AI agent that summarizes today's task activity" | Webhook (input) + PAT (writeback) |

Rule of thumb: if the trigger is **inside Cadence**, you want a webhook. If the trigger is **outside Cadence**, you want a PAT.

---

## Worked Example: A Slackbot That Creates Tasks

Goal: A user types `/cadence Fix login bug` in Slack, and a task is created in a specific Cadence project. When the task is later completed in Cadence, the bot posts a confirmation back to the Slack channel.

### 1. Register a slash command in Slack

In your Slack app config, add a slash command `/cadence` pointing at `https://your-bot.example.com/slack/cadence`. Slack will POST to that URL whenever a user runs the command.

### 2. Mint a Cadence PAT for the bot

You need the workspace **owner** or **admin** role to mint — the **New Token** button is not shown to members. If you are a member, ask an admin to issue the token and hand you the plaintext, or to own the integration outright.

In Cadence, navigate to **Settings → API Tokens** and create a new token:

- **Name:** `Slackbot prod`
- **Scopes:** `task:write`, `task:read`, `project:read`
- **Project scope:** Selected projects → pick the one project the bot writes to
- **Expiry:** 90 days (set a calendar reminder to rotate)

Only `task:write` is required by the create call in step 4. `task:read` and `project:read` are here because a bot that posts links back to Slack usually grows a "look up the task/project" step next, and adding a scope later means re-minting. If yours never reads, drop them — an unused scope is blast radius you are not using.

Copy the plaintext token and store it in your bot's secret manager as `CADENCE_PAT`.

### 3. Slack POSTs to your bot

When a user runs `/cadence Fix login bug`, Slack sends a `application/x-www-form-urlencoded` POST to your endpoint with fields including `text`, `user_id`, `channel_id`, and a verification signature.

Your bot should:

- Verify the Slack request signature (per Slack's docs).
- Extract `text` as the task title.

### 4. Call Cadence to create the task

```bash
curl -X POST \
  -H "Authorization: Bearer $CADENCE_PAT" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix login bug","status":"todo"}' \
  https://your-cadence-host.com/api/projects/{projectId}/tasks
```

A successful response is `201 Created` with the created task as JSON:

```json
{
  "id": "tsk_01HZX...",
  "projectId": "prj_...",
  "title": "Fix login bug",
  "status": "todo",
  "priority": "none",
  "assigneeId": null,
  "createdBy": "usr_...",
  "createdAt": "2026-06-09T15:42:11.000Z"
}
```

Use the task `id` to build the in-app URL (`https://your-cadence-host.com/projects/{projectId}/tasks/{taskId}`) for the Slack reply.

Failure modes worth handling:

| Status | Cause | Action |
| --- | --- | --- |
| `401` | Token revoked, expired, or malformed | Surface to ops; rotate or re-mint |
| `403` `Insufficient scope: requires task:write` | Token lacks `task:write` | Edit the token, or revoke and re-mint with the right scopes |
| `403` `Forbidden` | Token uses "Selected projects" and this project isn't in the list, the token belongs to a different workspace, or the owning user lacks the role | Check the token's project list and workspace, then the user's role. The message is deliberately identical for all three — see [Troubleshooting](#troubleshooting) |
| `429` | Bot is bursty | Back off and retry with jitter; consider a queue |

### 5. Reply to Slack with the new task link

Slack expects a JSON response within 3 seconds. Reply with a message containing the task title and a link back to it in Cadence.

```json
{
  "response_type": "in_channel",
  "text": "Created task: <https://your-cadence-host/projects/.../tasks/...|Fix login bug>"
}
```

### 6. Configure a webhook for the reverse direction

In Cadence, **Settings → Webhooks → New Webhook**:

- **URL:** `https://your-bot.example.com/cadence/webhook`
- **Events:** `task.completed`
- **Project scope:** the same project the bot writes to

When a task is completed, Cadence POSTs the event to your bot (with HMAC-SHA256 signing — see [webhooks.md](./webhooks.md#signature-verification)). Your bot verifies the signature and posts a "Task completed" message to the Slack channel.

You now have a bi-directional integration: Slack drives Cadence via the PAT, Cadence drives Slack via the webhook. Each side uses the primitive best suited to the direction of the trigger.

---

## Worked Example: GitHub Action That Creates a Task on PR Open

Goal: When a PR is opened in a repository, automatically create a Cadence task in the team's review queue.

1. **Mint a PAT** (as a workspace owner or admin) scoped to `task:write` on the single project that holds the review queue. 1-year expiry, single project — minimum blast radius.
2. **Store the token** in the repo's GitHub Actions secrets as `CADENCE_PAT`.
3. **Add a workflow** triggered on `pull_request: [opened]` that runs a curl step:

   ```yaml
   - name: Create Cadence task
     env:
       CADENCE_PAT: ${{ secrets.CADENCE_PAT }}
     run: |
       curl -X POST https://your-cadence-host.com/api/projects/<projectId>/tasks \
         -H "Authorization: Bearer $CADENCE_PAT" \
         -H "Content-Type: application/json" \
         -d "{\"title\":\"Review PR #${{ github.event.number }}: ${{ github.event.pull_request.title }}\",\"status\":\"todo\"}"
   ```

4. **Optionally**: configure a Cadence webhook on `task.completed` for that project that posts a comment back to the GitHub PR via the GitHub API.

The structure mirrors the Slackbot example: PAT for inbound, webhook for outbound, both narrowly scoped.

---

## Interactive API Reference

The full OpenAPI 3.1 reference is available at `/api/docs` (Scalar UI). Click **Authorize** and paste a PAT into the Bearer field to call any documented endpoint from the browser. The raw spec is served at `/api/openapi.json` for code generators.

---

## Authentication Choice

| Context | Use |
| --- | --- |
| Server-to-server, unattended scripts, CI/CD, bots | **PAT** in `Authorization: Bearer ...` header |
| Inside a browser session for a logged-in human | **Cookie** (the existing Better Auth session) |
| Mobile or desktop client acting on behalf of a logged-in user | **Cookie** (via the standard sign-in flow) |
| AI agent running on a server | **PAT** |

Cookie auth is not a viable choice for unattended automation — sessions are short-lived, SameSite-protected, and not designed to be stored as a long-term secret. PAT auth is not a viable choice in a browser — you'd have to store the secret in `localStorage`, where it's readable by any script. Use the primitive that fits the context.

---

## Permission Model Recap

When your bot calls Cadence with a PAT, four independent checks apply. All four must pass:

1. **Token scope** — the action must be covered by the token's `scopes` array.
2. **Workspace binding** — the token must belong to the workspace in the URL.
3. **User role** — the action must be one the owning user is allowed to perform.
4. **Project scope** — if the token uses "Selected projects", the target project must be in the list.

Any failure returns `403` (or `401` for a missing/invalid token). The token cannot grant more than the owning user has — see [api-tokens.md § Effective Permissions](./api-tokens.md#effective-permissions).

### Scope gotchas worth knowing before you mint

- **You must be a workspace owner or admin to mint at all.** This one is not a scope — it is checked before any scope is read, so a member gets a bare `403` from `POST /api-tokens` with no `Insufficient scope` hint. Rotation is gated the same way (and additionally requires you to be the token's own owner), so plan for an admin to own any long-lived integration token; a member who later needs to renew one cannot.
- **Every read endpoint requires a read scope.** Dashboards, the activity feed, workspace search, notifications and file downloads are all scope-checked. In particular: the workspace and project dashboards need **both** `task:read` and `project:read`; workspace search needs both; the activity feed and the notification endpoints need `task:read` (notification mutations need `task:write`); and `GET /api/uploads/...` needs `attachment:read`. A token minted for one narrow job will not quietly read these as a side effect.
- **`write:*` does not include reads.** The two wildcards are independent: `read:*` grants every `*:read`, `write:*` grants every `*:write`. A write-only token calling a `GET` gets `Insufficient scope`. Grant both if your integration reads and writes.
- **Neither wildcard grants a delete.** `task:delete` and `project:delete` must be listed explicitly, and they cover more than they look like they do — `DELETE /api/tasks/:taskId`, `/api/subtasks/:id`, `/api/comments/:id`, `/api/task-groups/:id` and `DELETE /api/tasks/:taskId/cover` all need `task:delete`; `DELETE /api/projects/:projectId`, `/api/projects/:id/cover`, `/api/projects/:id/members/:userId` and `/api/projects/:id/views/:viewId` all need `project:delete`. Resources with no `:delete` in the grammar (label, attachment, team, webhook, workspace, invitation) accept `:write` for deletes instead.
- **Some endpoints refuse tokens outright, at any scope.** Accepting an invitation, listing your pending invitations, copying an invitation link, managing API tokens, and managing calendar feeds are human-only actions taken from a browser: a machine credential must not be able to mint or harvest another credential. They answer `403` with a message starting `API tokens cannot ...`.
- **A "Selected projects" token cannot perform workspace-wide actions**, even when every project it names is involved. The whole-workspace export, deleting the workspace, removing a workspace member, and creating or managing workspace-wide (`projectId: null`) webhooks all answer `403`. Workspace-wide listing endpoints instead return results narrowed to the token's projects. Use an "All projects" token for those jobs.

---

## Webhook Security Recap

When Cadence calls your bot with a webhook delivery:

- Every payload is signed with HMAC-SHA256 using the secret shown when the webhook was created. Verify the signature on every request — see [webhooks.md § Signature Verification](./webhooks.md#signature-verification).
- Use the `X-Webhook-Delivery-Id` header as an **idempotency key**. Cadence retries failed deliveries up to 5 times with exponential backoff, so the same event may arrive more than once.
- Cadence treats 2xx as success and retries everything else, except `401`, `403`, `404`, `405`, `410` (non-retryable) — see [webhooks.md § Retry & Delivery](./webhooks.md#retry--delivery).
- Return 2xx as quickly as possible (within 10 seconds). Do heavy processing asynchronously.

---

## Rate Limits

Rate limits are applied per endpoint, and the quota is the same whether the caller is a PAT or a cookie session. What differs is the **key**: on rate-limited routes a PAT is counted by its own token id, so each integration gets its own budget rather than sharing one with every other caller behind the same IP. Minting a second token for a second job is therefore a real way to separate two workloads' quotas.

The per-endpoint numbers are in [rate-limiting.md § Current Rate Limits](./rate-limiting.md#current-rate-limits). The ones integrations hit first: workspace search 60/min, file downloads 100/min, attachment upload 20/min, whole-workspace export 5/hour, and workspace import 10/hour. Exceeding one returns `429` with a `Retry-After` header and `X-RateLimit-*` headers on every response — read them rather than guessing.

See also [api-tokens.md § Rate Limits](./api-tokens.md#rate-limits).

---

## Troubleshooting

| Status | Body | Meaning | Fix |
| --- | --- | --- | --- |
| `401` | `Invalid API token` | Token is malformed, unknown, or doesn't decode | Verify you copied the full `cdn_pat_...` string with no truncation or whitespace |
| `401` | `Invalid API token` (after working previously) | Token expired or was revoked | Check the UI; rotate or mint a new one |
| `403` | `Insufficient scope: requires task:write` | Token lacks the scope for this endpoint. The message always names the exact scope | Edit the token (or revoke and re-mint with the right scopes) |
| `403` | `Forbidden` | One of: the token belongs to a different workspace; the token uses "Selected projects" and this project isn't in the list; the owning user lacks the role for this action. On `POST /api-tokens` and `.../rotate` specifically, it also means the caller is not a workspace owner/admin | Work through them in that order — see below |
| `403` | `API tokens cannot ...` | The endpoint refuses machine credentials entirely | Perform the action from a browser session. Applies to accepting/listing invitations, copying an invite link, PAT management, and calendar-feed management |
| `404` | `File not found` | `GET /api/uploads/...` where the file is missing **or** the token is not permitted to read it | Check the token holds `attachment:read` and that the owning project is in its project list |
| `429` | `Too many requests` | Quota exhausted | Back off using the `Retry-After` header; consider splitting traffic across multiple tokens, or batch operations |

**Why every binding failure looks the same.** Scope failures name the missing scope, because you already hold the token and knowing which scope to add is exactly what you need. Workspace-binding, project-selection and role failures all return a bare `Forbidden` with no distinguishing detail — a different message per cause would let anyone holding a token learn which projects and workspaces exist beyond its reach. Diagnose it from the token's own configuration in **Settings → API Tokens**, not from the response body.

If you receive a `401` for a token you believe is valid, check (in order): exact string copied including the prefix, no expired-at past, no revoked-at populated, no leading/trailing whitespace, header is `Authorization: Bearer <token>` (not `Token <token>` or `Bearer: <token>`).

---

## What's NOT Supported (Yet)

These are deliberate omissions in the current iteration and may arrive in a future release:

- **Public OAuth app marketplace.** PATs are user-minted secrets, not OAuth credentials. There is no authorization-code flow, no app review process, and no end-user consent screen. If you're building an integration for one workspace or organization, PATs are exactly the right tool. If you're building a public product that lets thousands of independent Cadence users connect their accounts, wait for OAuth or use a per-tenant PAT collection model.
- **Per-endpoint fine-grained scopes** beyond `resource:action`. You cannot, for example, grant "can update task title but not task assignee". Scopes operate at the resource-action level.
- **Per-token outbound webhooks.** Webhooks remain workspace- or project-scoped, not PAT-scoped. You can have many webhooks per workspace.
- **Bot users.** A PAT acts on behalf of its owning human — there is no synthetic identity. Activity records show the human's name with the token name as a parenthetical.

If your integration needs one of these capabilities, open an issue describing the use case so we can prioritize.
