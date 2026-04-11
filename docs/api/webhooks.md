# Webhooks

## Overview

Webhooks allow external systems to receive real-time notifications when events occur in a Cadence workspace. When a subscribed event fires (e.g. a task is created, a project member is added), Cadence sends an HTTP POST request to your configured endpoint with a JSON payload describing the event. Webhooks can optionally be scoped to a specific project so they only fire for events from that project.

Common use cases:

- **Slack / Discord notifications** -- Post updates to a channel when tasks change status or are assigned.
- **Zapier / Make integrations** -- Trigger multi-step automations from workspace events.
- **CI/CD pipelines** -- Kick off builds or deployments when a project is updated.
- **AI agents** -- Feed task and project activity into LLM-based assistants for summarization or triage.
- **Data warehouses** -- Stream workspace activity into analytics systems for reporting.

---

## Event Types

There are 23 event types organized into four domains. Each webhook subscription can listen to any combination of events.

### Task Events (11)

| Event                  | Description                                                    | `changes` field |
| ---------------------- | -------------------------------------------------------------- | :-------------: |
| `task.created`         | A new task is created                                          |       No        |
| `task.updated`         | One or more task fields are modified                           |       Yes       |
| `task.completed`       | A task is marked as complete (or moved to a completion column) |       No        |
| `task.uncompleted`     | A completed task is re-opened                                  |       No        |
| `task.deleted`         | A task is permanently deleted                                  |       No        |
| `task.assigned`        | A task is assigned to a user (fires alongside `task.updated`)  |       Yes       |
| `task.unassigned`      | A task's assignee is removed (fires alongside `task.updated`)  |       Yes       |
| `task.moved`           | A task is moved between groups/columns (fires alongside `task.updated`) |       Yes       |
| `task.comment_created` | A comment is added to a task                                   |       No        |
| `task.label_added`     | A label is attached to a task                                  |       No        |
| `task.label_removed`   | A label is removed from a task                                 |       No        |

> **Note:** `task.assigned`, `task.unassigned`, and `task.moved` are secondary events that fire automatically alongside `task.updated` when the relevant field changes. They carry the same `changes` object as the parent `task.updated` event.

### Project Events (6)

| Event                    | Description                          | `changes` field |
| ------------------------ | ------------------------------------ | :-------------: |
| `project.created`        | A new project is created             |       No        |
| `project.updated`        | One or more project fields change    |       Yes       |
| `project.archived`       | A project's status changes to "archived" (fires alongside `project.updated`) |       No        |
| `project.deleted`        | A project is permanently deleted     |       No        |
| `project.member_added`   | A user is added to a project         |       No        |
| `project.member_removed` | A user is removed from a project     |       No        |

### Workspace Events (3)

| Event                            | Description                                 | `changes` field |
| -------------------------------- | ------------------------------------------- | :-------------: |
| `workspace.member_joined`        | A user joins the workspace (via invitation) |       No        |
| `workspace.member_removed`       | A user is removed from the workspace        |       No        |
| `workspace.member_role_changed`  | A workspace member's role is changed        |       Yes       |

### Invitation Events (3)

| Event                 | Description                              | `changes` field |
| --------------------- | ---------------------------------------- | :-------------: |
| `invitation.created`  | A new workspace invitation is sent       |       No        |
| `invitation.accepted` | An invitation is accepted by the invitee |       No        |
| `invitation.revoked`  | An invitation is revoked by an admin     |       No        |

---

## Project Scoping

Webhooks can optionally be scoped to a single project by setting the `projectId` field when creating or updating a webhook.

### Scope Behavior

| Webhook scope | Event origin | Fires? |
| --- | --- | :---: |
| Workspace-level (`projectId` is null) | Any event in the workspace | Yes |
| Project-scoped (`projectId` set) | Event from the matching project | Yes |
| Project-scoped (`projectId` set) | Event from a different project | No |
| Project-scoped (`projectId` set) | Workspace or invitation event (no project context) | No |

### Project Archiving

When a project is archived, all project-scoped webhooks belonging to that project are automatically deleted. Workspace-scoped webhooks still receive the `project.archived` event. This prevents stale webhooks from accumulating for inactive projects.

### Event Restrictions

Events are classified into two categories:

- **Project-scoped events** (`task.*`, `project.*`) — have a project context and can be used with project-scoped webhooks.
- **Workspace-scoped events** (`workspace.*`, `invitation.*`) — have no project context and are only delivered to workspace-level webhooks.

Project-scoped webhooks **cannot** subscribe to workspace-scoped events (`workspace.*`, `invitation.*`). The API enforces this via a validation rule on both create and update. The UI disables workspace/invitation event groups when a project is selected.

### Validation

- The `projectId` must reference a project that belongs to the same workspace as the webhook.
- On update, changing `projectId` to a project value while the webhook has workspace-scoped events subscribed will be rejected.
- Clearing `projectId` (setting to `null`) converts a project-scoped webhook back to workspace-level.

---

## Payload Format

Every webhook delivery sends a JSON envelope with a consistent structure. The top-level fields are always present; `project` and `changes` are included only when applicable.

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "event": "task.updated",
  "timestamp": "2026-03-26T12:00:00.000Z",
  "workspace": {
    "id": "ws_abc123",
    "name": "Acme Corp",
    "slug": "acme-corp"
  },
  "project": {
    "id": "proj_def456",
    "name": "Q2 Launch"
  },
  "actor": {
    "id": "user_ghi789",
    "name": "Jane Smith",
    "email": "jane@acme.com"
  },
  "data": {
    "id": "task_jkl012",
    "title": "Update landing page copy",
    "description": "Revise hero section for Q2 campaign",
    "projectId": "proj_def456",
    "taskGroupId": "group_mno345",
    "taskGroup": { "id": "group_mno345", "name": "In Progress" },
    "assigneeId": "user_ghi789",
    "assignee": { "id": "user_ghi789", "name": "Jane Smith", "email": "jane@acme.com" },
    "priority": "critical",
    "dueDate": "2026-04-01T00:00:00.000Z",
    "cost": 5,
    "completed": false,
    "completedAt": null,
    "completedBy": null,
    "completedByUser": null,
    "position": 1,
    "icon": null,
    "recurrenceRule": null,
    "recurrenceParentId": null,
    "recurrenceSeriesId": null,
    "createdAt": "2026-03-20T09:00:00.000Z",
    "updatedAt": "2026-03-26T12:00:00.000Z"
  },
  "changes": {
    "priority": { "from": "low", "to": "critical" },
    "assigneeId": { "from": null, "to": "user_ghi789" },
    "assignee": { "from": null, "to": { "id": "user_ghi789", "name": "Jane Smith", "email": "jane@acme.com" } }
  }
}
```

### Field Reference

| Field       | Type     | Always present | Description                                                                 |
| ----------- | -------- | :------------: | --------------------------------------------------------------------------- |
| `id`        | `string` |      Yes       | Unique delivery ID (UUID). Use as an idempotency key.                       |
| `event`     | `string` |      Yes       | The event type that triggered this delivery (e.g. `task.updated`).          |
| `timestamp` | `string` |      Yes       | ISO 8601 timestamp of when the event occurred.                              |
| `workspace` | `object` |      Yes       | `{ id, name, slug }` of the workspace where the event occurred.             |
| `project`   | `object` |       No       | `{ id, name }` of the related project. Absent for workspace/invitation events. |
| `actor`     | `object` |      Yes       | `{ id, name, email }` of the user who triggered the event.                  |
| `data`      | `object` |      Yes       | The full entity snapshot. Shape depends on the event domain (see below).    |
| `changes`   | `object` |       No       | Only present on update events. Maps field names to `{ from, to }` pairs.    |

### Data Shapes by Domain

- **Task events** (`task.*`): Full task object with `id`, `title`, `description`, `projectId`, `taskGroupId`, `taskGroup`, `assigneeId`, `assignee`, `priority`, `dueDate`, `cost`, `completed`, `completedAt`, `completedBy`, `completedByUser`, `position`, `icon`, `recurrenceRule`, `recurrenceParentId`, `recurrenceSeriesId`, `createdAt`, `updatedAt`. The `recurrenceRule` field is the JSON-encoded rule string (or `null`); `recurrenceParentId` links to the previous instance in a recurring series; `recurrenceSeriesId` groups all instances in the same series. Exception: `task.comment_created` sends the comment object (`id`, `taskId`, `authorId`, `author`, `body`, `createdAt`, `updatedAt`); `task.label_added` and `task.label_removed` send `{ task: { id, projectId }, label: { id, name } }`.
- **Project events** (`project.*`): Full project object with `id`, `workspaceId`, `name`, `description`, `status`, `icon`, `budget`, `createdAt`, `updatedAt`. Exception: `project.member_added` and `project.member_removed` send `{ userId, user, projectId, role }`.
- **Workspace events** (`workspace.*`): Member data with `{ userId, user, workspaceId, role }`.
- **Invitation events** (`invitation.*`): Full invitation object with `id`, `workspaceId`, `email`, `role`, `status`, `expiresAt`, `createdAt`.

### Enriched Fields

Webhook payloads include resolved objects alongside raw IDs so consumers can display human-readable info without a round-trip to the API. All enriched fields are `null` when the referenced entity does not exist.

| Raw ID field | Enriched field | Shape | Present on |
| --- | --- | --- | --- |
| `assigneeId` | `assignee` | `{ id, name, email }` | Task events |
| `completedBy` | `completedByUser` | `{ id, name, email }` | Task events |
| `taskGroupId` | `taskGroup` | `{ id, name }` | Task events |
| `authorId` | `author` | `{ id, name, email }` | `task.comment_created` |
| `userId` | `user` | `{ id, name, email }` | Member events (workspace + project) |

For `task.updated` and `task.moved` events, the `changes` field also includes enriched objects for ID changes. For example, when `assigneeId` changes, the `changes` object includes both `assigneeId: { from, to }` (raw IDs) and `assignee: { from, to }` (resolved user objects). The same applies for `taskGroupId`/`taskGroup`.

### Changes Format

The `changes` field uses `computeChanges()` to diff specific tracked fields before and after the mutation. Each changed field maps to an object with `from` (previous value) and `to` (new value). Date values are normalized to ISO 8601 strings. Fields that did not change are omitted.

Tracked fields for `task.updated`: `title`, `description`, `assigneeId`, `priority`, `dueDate`, `cost`, `icon`, `taskGroupId`, `coverImageKey`, `coverImagePosition`, `recurrenceRule`.

Tracked fields for `project.updated`: `name`, `description`, `status`, `icon`, `budget`.

---

## Headers

Every webhook delivery includes these HTTP headers:

| Header                    | Example Value                                        | Description                                                        |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `Content-Type`            | `application/json`                                   | Payload is always JSON.                                            |
| `X-Webhook-Signature`     | `sha256=a1b2c3d4e5f6...`                             | HMAC-SHA256 hex digest of the raw request body, prefixed with `sha256=`. |
| `X-Webhook-Event`         | `task.updated`                                       | The event type for this delivery.                                  |
| `X-Webhook-Delivery-Id`   | `a1b2c3d4-e5f6-7890-abcd-ef1234567890`               | Unique delivery UUID. Use as an idempotency key to deduplicate.    |
| `X-Webhook-Timestamp`     | `1711454400`                                         | Unix timestamp (seconds) of when the delivery was sent. Use for replay protection. |
| `User-Agent`              | `Cadence-Webhooks/1.0`                               | Identifies Cadence as the sender.                                  |

---

## Signature Verification

Every delivery is signed with your webhook's secret using HMAC-SHA256. You should verify the signature to confirm the payload was sent by Cadence and has not been tampered with.

The signature is computed over the **raw request body string** (not parsed JSON). The `X-Webhook-Signature` header contains the hex digest prefixed with `sha256=`.

### Node.js / Bun

```typescript
import { createHmac, timingSafeEqual } from "crypto";

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const received = signatureHeader.replace("sha256=", "");

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
}

// Usage in an Express/Hono handler:
app.post("/webhook", (req, res) => {
  const rawBody = req.body; // must be the raw string, not parsed JSON
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];

  // Optional: reject stale deliveries (e.g. older than 5 minutes)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) {
    return res.status(400).send("Stale webhook delivery");
  }

  if (!verifyWebhookSignature(rawBody, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send("Invalid signature");
  }

  const payload = JSON.parse(rawBody);
  // Process the event...

  res.status(200).send("OK");
});
```

### Python

```python
import hmac
import hashlib
import time

def verify_webhook_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    received = signature_header.removeprefix("sha256=")

    return hmac.compare_digest(expected, received)

# Usage in a Flask handler:
@app.route("/webhook", methods=["POST"])
def handle_webhook():
    raw_body = request.get_data()
    signature = request.headers.get("X-Webhook-Signature", "")
    timestamp = request.headers.get("X-Webhook-Timestamp", "0")

    # Optional: reject stale deliveries (e.g. older than 5 minutes)
    age = int(time.time()) - int(timestamp)
    if age > 300:
        return "Stale webhook delivery", 400

    if not verify_webhook_signature(raw_body, signature, WEBHOOK_SECRET):
        return "Invalid signature", 401

    payload = request.get_json()
    # Process the event...

    return "OK", 200
```

### Important Notes

- **Use timing-safe comparison.** Always use `timingSafeEqual` (Node.js) or `hmac.compare_digest` (Python) to prevent timing attacks.
- **Verify against the raw body string.** Do not serialize parsed JSON back to a string -- the result may differ from the original due to key ordering or whitespace.
- **Reject stale timestamps.** Optionally check `X-Webhook-Timestamp` and reject deliveries older than a reasonable window (e.g. 5 minutes) to prevent replay attacks. Account for retries when setting this window.

---

## Retry & Delivery

### Initial Delivery

When an event fires, Cadence dispatches webhook deliveries asynchronously using `executionCtx.waitUntil()`. This ensures delivery never blocks the user's HTTP request. Each delivery attempt has a **10-second timeout**.

A 2xx response (200-299) is considered successful. Any other status code or network error is treated as a failure.

Every delivery and retry attempt is tracked via the telemetry subsystem (`webhook_delivery` and `webhook_retry` events) with webhook ID, delivery ID, event type, success flag, HTTP status code, duration in milliseconds, attempt number, and workspace ID. See the [Telemetry](../../src/api/lib/telemetry/index.ts) module for sink configuration.

### Retry Schedule

Failed deliveries are retried with exponential backoff. There are **5 total attempts** (1 initial + 4 retries). Each delay has ±20% random jitter applied, so actual wait times vary slightly from the base values below:

| Attempt | Base delay after previous attempt | Approximate cumulative wait |
| :-----: | :-------------------------------: | :-------------------------: |
|    1    |            Immediate              |              0              |
|    2    |            1 minute               |          ~1 minute          |
|    3    |            5 minutes              |         ~6 minutes          |
|    4    |            30 minutes             |        ~36 minutes          |
|    5    |            2 hours                |       ~2 hours 36 min       |

### Cron-Driven Retries

A Cloudflare Cron Trigger runs every 5 minutes (`*/5 * * * *`) and processes pending retries. Each cron invocation processes up to **50 retries** per batch. Retry delays include ±20% random jitter to prevent thundering-herd effects when many deliveries become eligible simultaneously.

### Non-Retryable Status Codes

Certain HTTP status codes indicate a permanent configuration or authentication problem that will not resolve without human intervention. When a delivery receives one of these codes, retries are skipped immediately:

| Status | Meaning | Why non-retryable |
| :----: | ------- | ----------------- |
| 401 | Unauthorized | Bad or missing webhook secret / auth token |
| 403 | Forbidden | Receiver explicitly rejects the request |
| 404 | Not Found | Endpoint does not exist |
| 405 | Method Not Allowed | Receiver does not accept POST |
| 410 | Gone | Endpoint has been permanently removed |

The delivery is recorded as a failure with `maxAttempts` capped to the current attempt and `nextRetryAt` set to `null`. The webhook's `consecutiveFailures` counter is still incremented (and auto-disable still applies after 10 consecutive failures).

All other non-2xx status codes (e.g. 500, 502, 503, 429) are treated as transient and follow the normal retry schedule.

### Permanent Failure

After all 5 attempts are exhausted (or a non-retryable status code is received), the delivery is marked as permanently failed (`nextRetryAt` is set to `null`). The delivery record is retained for inspection in the webhook detail view.

---

## Auto-Disable

If a webhook accumulates **10 consecutive failures** across any deliveries (not just retries of a single delivery), the webhook is automatically disabled (`active` set to `false`). This prevents wasted requests against permanently broken endpoints.

A successful delivery at any point resets the consecutive failure counter to zero.

Workspace admins can re-enable a disabled webhook from the workspace settings page. Re-enabling resets the consecutive failure counter.

---

## Delivery Retention

Webhook delivery records are cleaned up by the scheduled cron handler:

- **Time-based retention:** Deliveries older than **30 days** are deleted.
- **Per-webhook cap:** Each webhook retains at most **200 delivery records**. When this cap is exceeded, the oldest records are pruned even if they are within the 30-day window.

Cleanup is batched (100 records per delete operation) to stay within Cloudflare Workers CPU limits.

---

## Dev Mode

When running locally with `wrangler dev`, the webhook system relaxes URL validation rules:

- **HTTP URLs are allowed** (production requires HTTPS).
- **Localhost and private IPs are allowed** (production blocks them for SSRF protection).

Dev mode is detected by checking whether the `BETTER_AUTH_URL` environment variable contains `localhost` or `127.0.0.1`.

### SSRF Protection (Production)

In production, webhook URLs are validated against:

- **HTTPS required** -- HTTP URLs are rejected.
- **Blocked hostnames** -- `localhost`, `127.0.0.1`, `::1`, `[::1]`, `0.0.0.0`.
- **Blocked IP ranges** -- `127.0.0.0/8` (loopback), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (private), `169.254.0.0/16` (link-local / cloud metadata).
- **Blocked domains** -- `*.local` (mDNS / Bonjour).

---

## API Endpoints

### Workspace-Scoped Webhooks

The workspace-level webhook CRUD API is mounted under `/api/workspaces/:workspaceId/webhooks`. Full request/response details are documented in [Endpoints](./endpoints.md).

| Method   | Path                                            | Description                                       |
| -------- | ----------------------------------------------- | ------------------------------------------------- |
| `POST`   | `/api/workspaces/:workspaceId/webhooks`         | Create a webhook (secret returned only on creation) |
| `GET`    | `/api/workspaces/:workspaceId/webhooks`         | List all webhooks (secrets omitted)               |
| `GET`    | `/api/workspaces/:workspaceId/webhooks/:id`     | Get webhook details with 20 most recent deliveries |
| `PATCH`  | `/api/workspaces/:workspaceId/webhooks/:id`     | Update webhook fields, optionally regenerate secret |
| `DELETE` | `/api/workspaces/:workspaceId/webhooks/:id`     | Delete webhook and all delivery records (cascade) |
| `POST`   | `/api/workspaces/:workspaceId/webhooks/:id/test`| Send a synchronous test delivery                  |

### Project-Scoped Webhooks

Project-scoped webhooks are managed under `/api/projects/:projectId/webhooks`. These endpoints require the `admin` project role. Project-scoped webhooks are automatically bound to the project and cannot subscribe to workspace or invitation events.

| Method   | Path                                              | Description                                       |
| -------- | ------------------------------------------------- | ------------------------------------------------- |
| `POST`   | `/api/projects/:projectId/webhooks`               | Create a project-scoped webhook                   |
| `GET`    | `/api/projects/:projectId/webhooks`               | List webhooks for the project (secrets omitted)   |
| `GET`    | `/api/projects/:projectId/webhooks/:id`           | Get webhook details with 20 most recent deliveries |
| `PATCH`  | `/api/projects/:projectId/webhooks/:id`           | Update webhook fields, optionally regenerate secret |
| `DELETE` | `/api/projects/:projectId/webhooks/:id`           | Delete webhook and all delivery records           |
| `POST`   | `/api/projects/:projectId/webhooks/:id/test`      | Send a synchronous test delivery                  |

---

## Limits

| Limit                       | Value                |
| --------------------------- | -------------------- |
| Max webhooks per workspace  | 20                   |
| Max delivery attempts       | 5 (1 initial + 4 retries) |
| Delivery timeout            | 10 seconds           |
| Auto-disable threshold      | 10 consecutive failures |
| Retry batch size (per cron) | 50                   |
| Delivery retention          | 30 days              |
| Delivery records per webhook| 200                  |
| Webhook name max length     | 100 characters       |
| Minimum subscribed events   | 1                    |
| Webhook secret length       | 64 hex characters (256-bit) |

---

## Client-Side Validation

The webhook create and edit forms perform client-side validation using the shared `createWebhookSchema` (Zod) before submitting to the API. Validation errors are displayed inline next to the relevant form field (name, URL, events) using the `useFieldErrors` hook. Field errors are cleared automatically when the user modifies the errored input.

This applies to both the workspace-level webhook management UI (`WorkspaceSettings`) and the project-level webhook management UI (`ProjectSettings > Webhooks`).

---

## Interactive API Documentation

An interactive API reference for the webhook endpoints is available at `/api/docs`, powered by [Scalar](https://scalar.com). The underlying OpenAPI 3.1 specification is served at `/api/openapi.json`.

The docs include:

- All 12 webhook management endpoints (6 workspace-scoped + 6 project-scoped) with request/response schemas
- The `WebhookPayloadEnvelope` schema documenting the shape of payloads delivered to subscriber endpoints
- Authentication requirements and error response formats

### Rate Limits

Webhook endpoints have per-action rate limits applied via the `rateLimit` middleware:

#### Workspace-Scoped

| Action | Max | Window | Prefix |
| ------ | --- | ------ | ------ |
| Read (list, get) | 60 | 60s | `webhook-read` |
| Write (create, update, delete) | 20 | 60s | `webhook-write` |
| Test delivery | 5 | 60s | `webhook-test` |

#### Project-Scoped

| Action | Max | Window | Prefix |
| ------ | --- | ------ | ------ |
| Read (list, get) | 60 | 60s | `project-webhook-read` |
| Write (create, update, delete) | 20 | 60s | `project-webhook-write` |
| Test delivery | 5 | 60s | `project-webhook-test` |
