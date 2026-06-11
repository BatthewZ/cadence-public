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

In Cadence, navigate to **Settings → API Tokens** and create a new token:

- **Name:** `Slackbot prod`
- **Scopes:** `task:write`, `task:read`, `project:read`
- **Project scope:** Selected projects → pick the one project the bot writes to
- **Expiry:** 90 days (set a calendar reminder to rotate)

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
| `403` `Token not scoped to this project` | Token uses "Selected projects" and this project isn't in the list | Edit the token's project list |
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

1. **Mint a PAT** scoped to `task:write` on the single project that holds the review queue. 1-year expiry, single project — minimum blast radius.
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

When your bot calls Cadence with a PAT, three checks apply, in order:

1. **Workspace scope** — the token must belong to the workspace in the URL.
2. **User role** — the action must be one the owning user is allowed to perform.
3. **Token scope** — the action must be covered by the token's `scopes` array.
4. **Project scope** — if the token uses "Selected projects", the target project must be in the list.

Any failure returns `403` (or `401` for missing/invalid token). The token cannot grant more than the owning user has — see [api-tokens.md § Effective Permissions](./api-tokens.md#effective-permissions).

---

## Webhook Security Recap

When Cadence calls your bot with a webhook delivery:

- Every payload is signed with HMAC-SHA256 using the secret shown when the webhook was created. Verify the signature on every request — see [webhooks.md § Signature Verification](./webhooks.md#signature-verification).
- Use the `X-Webhook-Delivery-Id` header as an **idempotency key**. Cadence retries failed deliveries up to 5 times with exponential backoff, so the same event may arrive more than once.
- Cadence treats 2xx as success and retries everything else, except `401`, `403`, `404`, `405`, `410` (non-retryable) — see [webhooks.md § Retry & Delivery](./webhooks.md#retry--delivery).
- Return 2xx as quickly as possible (within 10 seconds). Do heavy processing asynchronously.

---

## Rate Limits

PAT-authenticated requests get a higher per-minute quota than cookie-authenticated requests — typically ~5× — calibrated for machine traffic patterns. Exact limits are documented in the interactive reference at `/api/docs`.

See [api-tokens.md § Rate Limits](./api-tokens.md#rate-limits) and [rate-limiting.md](./rate-limiting.md).

---

## Troubleshooting

| Status | Body | Meaning | Fix |
| --- | --- | --- | --- |
| `401` | `Invalid API token` | Token is malformed, unknown, or doesn't decode | Verify you copied the full `cdn_pat_...` string with no truncation or whitespace |
| `401` | `Invalid API token` (after working previously) | Token expired or was revoked | Check the UI; rotate or mint a new one |
| `403` | `Insufficient scope: requires task:write` | Token lacks the scope for this endpoint | Edit the token (or revoke and re-mint with the right scopes) |
| `403` | `Token not scoped to this workspace` | Token belongs to a different workspace | Use a token minted in the correct workspace; one PAT per workspace |
| `403` | `Token not scoped to this project` | Token uses "Selected projects" and this project isn't in the list | Edit the token's project list or use an "All projects" token |
| `403` | (action-specific message) | The owning user lacks the role for this action | Token can't grant more than the human has — check the user's workspace/project role |
| `429` | `Rate limit exceeded` | Quota exhausted | Back off and retry later; consider splitting traffic across multiple tokens, or batch operations |

If you receive a `401` for a token you believe is valid, check (in order): exact string copied including the prefix, no expired-at past, no revoked-at populated, no leading/trailing whitespace, header is `Authorization: Bearer <token>` (not `Token <token>` or `Bearer: <token>`).

---

## What's NOT Supported (Yet)

These are deliberate omissions in the current iteration and may arrive in a future release:

- **Public OAuth app marketplace.** PATs are user-minted secrets, not OAuth credentials. There is no authorization-code flow, no app review process, and no end-user consent screen. If you're building an integration for one workspace or organization, PATs are exactly the right tool. If you're building a public product that lets thousands of independent Cadence users connect their accounts, wait for OAuth or use a per-tenant PAT collection model.
- **Per-endpoint fine-grained scopes** beyond `resource:action`. You cannot, for example, grant "can update task title but not task assignee". Scopes operate at the resource-action level.
- **Per-token outbound webhooks.** Webhooks remain workspace- or project-scoped, not PAT-scoped. You can have many webhooks per workspace.
- **Bot users.** A PAT acts on behalf of its owning human — there is no synthetic identity. Activity records show the human's name with the token name as a parenthetical.

If your integration needs one of these capabilities, open an issue describing the use case so we can prioritize.
