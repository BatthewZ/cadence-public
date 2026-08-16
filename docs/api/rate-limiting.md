# Rate Limiting

Rate limiting is implemented as a Hono middleware in `src/api/middleware/rate-limit.ts`. It uses an **in-memory store** (JavaScript `Map`) scoped to the Worker isolate.

## Configuration

```ts
rateLimit({
  max: 10,           // Maximum requests in the window
  windowSeconds: 60, // Window duration in seconds
  prefix: "auth",    // Namespace for this limiter
  keyFn: (c) => ..., // Optional: custom key extractor (defaults to client IP)
})
```

## How It Works

1. **Key generation**: With no `keyFn`, each client is identified by `{prefix}:{clientIP}`, with the IP extracted from `cf-connecting-ip` or `x-forwarded-for`. Most limiters instead pass `keyFn: defaultRateLimitKey`, which keys on the authenticated **actor** — API token id, else user id, else the IP — so a shared egress (an office, a VPN, a corporate NAT, a CI fleet) cannot let one caller's legitimate burst exhaust everyone else's budget. Per-IP keying is kept only where there is no authenticated actor to key on (`/api/auth/*`, the public invitation lookup) or where the IP *is* the thing being protected (Unsplash's per-IP upstream quota). The **Key** column in the table below records which each limiter uses. Note that no key includes the workspace id: an actor's budget is theirs across every workspace they belong to.
2. **Window tracking**: Each key has a `count` and `resetAt` timestamp. If the current time is past `resetAt`, the window resets.
3. **Enforcement**: If `count >= max`, the middleware returns a 429 response immediately without calling the next handler.
4. **Cleanup**: Every 100 requests, expired entries are purged from the store.

## Response Headers

Every response (whether rate-limited or not) includes these headers:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed in the window. |
| `X-RateLimit-Remaining` | Remaining requests in the current window. |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets. |

When rate-limited (429), an additional header is set:

| Header | Description |
|---|---|
| `Retry-After` | Seconds until the client can retry. |

## Rate-Limited Response

```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000000
```

```json
{
  "error": "Too many requests",
  "requestId": "a1b2c3d4-...",
  "retryAfter": 45
}
```

The body goes through `errorResponse()`, so it carries the same `requestId` as every other error — see [Error Handling](./error-handling.md).

## Current Rate Limits

Key column: **actor** = `defaultRateLimitKey` (API token id → user id → IP); **IP** = client IP only.

| Endpoint | Max | Window | Key | Prefix |
|---|---|---|---|---|
| `/api/auth/sign-in/*` | 10 | 60s | IP | `auth-signin` |
| `/api/auth/sign-up/*` | 5 | 60s | IP | `auth-signup` |
| `/api/auth/request-password-reset` | 3 | 60s | IP | `auth-password-reset` |
| `/api/auth/*` (all other) | 30 | 60s | IP | `auth-general` |
| `POST /api/workspaces/:workspaceId/invitations` | 20 | 3600s | actor | `invitation-create` |
| `GET /api/invitations/:token` | 10 | 60s | IP | `invitation-lookup` |
| `POST /api/invitations/accept` | 10 | 60s | actor | `invitation-accept` |
| Workspace webhook read (list, get) | 60 | 60s | actor | `webhook-read` |
| Workspace webhook write (create, update, delete) | 20 | 60s | actor | `webhook-write` |
| Workspace webhook test delivery | 5 | 60s | actor | `webhook-test` |
| Project webhook read (list, get) | 60 | 60s | actor | `project-webhook-read` |
| Project webhook write (create, update, delete) | 20 | 60s | actor | `project-webhook-write` |
| Project webhook test delivery | 5 | 60s | actor | `project-webhook-test` |
| `GET /api/workspaces/:workspaceId/export` | 5 | 3600s | actor | `workspace-export` |
| `POST /api/workspaces/:workspaceId/import` | 10 | 3600s | actor | `workspace-import` |
| `GET /api/projects/:projectId/export/csv` | 30 | 3600s | actor | `project-export-csv` |
| `GET /api/workspaces/:workspaceId/search` | 60 | 60s | actor | `search` |
| `POST /api/projects/:projectId/tasks/import` | 10 | 60s | actor | `task-import` |
| `PUT /api/projects/:projectId/cover` | 10 | 60s | actor | `project-cover-upload` |
| `PUT /api/projects/:projectId/cover/unsplash` | 10 | 60s | actor | `project-cover-unsplash` |
| `PUT /api/tasks/:taskId/cover` | 10 | 60s | actor | `task-cover-upload` |
| `PUT /api/tasks/:taskId/cover/unsplash` | 10 | 60s | actor | `task-cover-unsplash` |
| `POST /api/tasks/:taskId/attachments` | 20 | 60s | actor | `task-attachment-upload` |
| `PUT /api/users/me/avatar` | 10 | 60s | actor | `avatar-upload` |
| `GET /api/uploads/:purpose/:userId/:filename` | 100 | 60s | actor | `file-serve` |
| API token management (`/api/workspaces/:workspaceId/api-tokens*`) | 20 | 60s | actor | `api-token-mgmt` |
| Calendar feed mint / revoke | 20 | 60s | actor | `calendar-feed-mgmt` |
| `GET /api/calendar/feed/:token` | 30 | 60s | feed token | `calendar-feed` |
| `/api/unsplash/*` | 30 | 60s | IP | `unsplash-search` |

The calendar feed is keyed by the feed token itself rather than the actor, because the request is unauthenticated — possession of the token is the whole credential, so the token is the only stable identity available.

Invitation creation is deliberately the slowest window in the table. Creating an invitation sends mail from this deployment's sending domain, so the budget is measured per hour rather than per minute; 20 distinct new addresses in an hour comfortably covers an admin onboarding a whole team in one sitting, and the duplicate-pending guard in `createInvitation` already prevents repeat sends to the same address from consuming it. The limiter is mounted **after** the owner/admin role check, so a rejected non-admin cannot spend an admin's allowance.

## Limitations

The rate limit store is **in-memory per isolate**. In a production Cloudflare Workers environment, requests may be handled by different isolates, so the rate limit is not perfectly global. For stricter rate limiting, consider using Cloudflare's built-in rate limiting rules or a KV/Durable Object-backed store.

Each `rateLimit(...)` call creates its own store, so two mounts that share a prefix string (the project-webhook read and write limiters are each mounted on several routes) still count independently. The prefix namespaces keys within one limiter; it does not merge limiters.
