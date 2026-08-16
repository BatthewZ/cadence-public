# Error Handling

## `errorResponse()` Helper (`src/api/lib/error-response.ts`)

All error responses across middleware and route handlers use the `errorResponse()` helper. This guarantees a consistent error envelope that always includes `requestId`.

```ts
import { errorResponse } from "../lib/error-response";

// Usage in a handler:
return errorResponse(c, "Not found", 404);

// With extra fields:
return errorResponse(c, "Validation failed", 400, { details: [...] });
```

Every error response has this shape:

```json
{
  "error": "Not found",
  "requestId": "a1b2c3d4-..."
}
```

The one exception is the Zod validation failure body, which is built by `validationHook` with `c.json()` and carries `details` but no `requestId` — see [Validation Middleware](./validation.md#validation-error-response).

A second helper, `throwWithContext(error, context)`, re-throws an error with a contextual prefix on the message (e.g. `[createTask] original message`) while preserving the stack trace. This is used in `try/catch` blocks to add handler context to unexpected errors before they reach the global handler.

## Global Error Handler

The global error handler is defined in `src/api/index.ts`:

```ts
app.onError((err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  console.error(
    JSON.stringify({
      level: "error",
      method: c.req.method,
      path: c.req.path,
      error: err.message,
      stack: err.stack,
      requestId,
    })
  );
  return c.json({ error: "Internal Server Error", requestId }, 500);
});
```

## Behavior

1. **Unexpected errors**: Any unhandled error is logged as a structured JSON object (with the full stack trace) and returns a generic `500 Internal Server Error` response. The error details are never leaked to the client.

2. **Request ID**: Every error response includes the `requestId`, making it possible to correlate client-side errors with server-side logs.

3. **No `HTTPException` handling**: The global handler does not catch `HTTPException`. All error paths use `errorResponse()` directly, returning structured JSON responses from middleware and handlers before errors reach the global handler. No middleware in the app throws `HTTPException` — Better Auth catches errors internally, `zValidator` returns responses from its hook, and CORS doesn't throw.

## Status Code Conventions

| Status | Used for |
|---|---|
| `400` | The request was understood but is not a legal thing to ask for — validation failures, and states like "you are already a member of this workspace" or "this invitation has expired" |
| `401` | No credential, or a credential that does not resolve to a user |
| `403` | Authenticated, but not permitted — insufficient workspace/project role, an API token missing a scope, an API token outside its workspace or project selection, or an endpoint that refuses API tokens entirely |
| `404` | The resource does not exist — **and**, on a small set of capability-URL routes, the case where the caller is not permitted to read it (see below) |
| `409` | A conflict with existing state that the caller could not have known about: a duplicate workspace slug, or an invitation that stopped being `pending` |
| `413` | Upload larger than the endpoint's cap, rejected before parsing |
| `429` | Rate limit exceeded (see [Rate Limiting](./rate-limiting.md)) |
| `500` | Unexpected — never carries detail |
| `503` | A required binding (R2 storage, an external API key) is not configured on this deployment |

### 403 vs 404 for an unauthorized read

The default is `403`. It is the honest answer whenever the caller addressed the resource by an id they legitimately hold — from a listing, a URL in the app, a webhook payload — because in that case "you lack permission" tells them nothing they could not already infer.

A small set of routes answer `404` instead, uniformly, for both "does not exist" and "not yours":

- `GET /api/uploads/:purpose/:userId/:filename` — see [File Storage](./storage.md#get-apiuploadspurposeuseridfilename)
- The calendar ICS feed, which is addressed by a feed token
- Notification rows belonging to another user

What these have in common is that the URL is an unguessable capability rather than an addressable id: nothing in the product hands a caller one of these URLs for a resource they cannot read. Answering `403` would therefore convert a URL that leaked into a browser history, a referrer header or a log line into a confirmation that the resource exists. The uniform `404` gives back exactly one bit — the URL works, or it does not.

### API-token refusals

Requests authenticated with a Personal Access Token have three additional ways to earn a `403`, and the wording is deliberately not uniform across them:

| Cause | Body |
|---|---|
| Token lacks the capability scope for this route | `Insufficient scope: requires <resource>:<action>` |
| Token belongs to another workspace, or the target project is outside a `projectScope: "selected"` token's list, or the owning user lacks the role | `Forbidden` |
| The route refuses machine credentials at any scope | `API tokens cannot <action>` |

The scope message names the missing scope because the caller has already proven possession of the token, and telling an integration developer exactly which scope to add is the entire point. The binding failures are deliberately indistinguishable from each other and from a role failure, so that the response body cannot be used to map which workspaces and projects exist outside the token's reach. Do not "improve" that message.

A token with `projectScope: "selected"` is additionally refused with a plain `403 Forbidden` on workspace-wide actions, rather than being served a narrowed result — the whole-workspace export, deleting the workspace, removing a workspace member, and managing workspace-wide webhooks. There is no partial form of those operations, so narrowing them would perform something other than what was asked. Workspace-wide *listing* endpoints do narrow instead, returning only the token's projects.

### Invitation accept

`POST /api/invitations/accept` is the densest status surface in the API, so its full ladder is worth stating in one place. Checks run in this order, and each returns before the next is reached:

| Condition | Status |
|---|---|
| Request authenticated with an API token | `403 API tokens cannot accept invitations` |
| No invitation matches the supplied `token` or `invitationId` | `404 Invitation not found` |
| Invitation is not `pending` (already accepted, or revoked) | `409 Invitation is <status>` |
| Invitation has expired | `400 Invitation has expired` |
| The signed-in account's email is not the invited address | `403 This invitation was sent to a different email address` |
| The caller is already a member of that workspace | `400 You are already a member of this workspace` |
| Two accepts raced and this one lost the claim | `409 Invitation is <status>` |
| The membership already existed, found on rollback | `400 You are already a member of this workspace` |

The last two rows matter: losing a race and simply arriving late are the same fact from the caller's side, so they return byte-identical bodies. A client must never have to branch on timing it cannot observe. See [Atomic Multi-Write: `acceptInvitation`](#atomic-multi-write-acceptinvitation) for how the single batch produces those outcomes.

`GET /api/invitations/pending` refuses tokens the same way, with `403 API tokens cannot list invitations`; so does the invite-link copy endpoint, with `403 API tokens cannot retrieve invitation links`. Reviewing, accepting and sharing an invitation are human actions taken from a browser — an invitation is itself a credential, and a machine credential must not be able to mint or harvest another one.

## Non-Fatal Error Handling

Some handler operations are supplementary — their failure should not abort the primary action. These are wrapped in targeted `try/catch` blocks that log the error and allow the response to proceed with partial data or without the side effect.

**Categories of non-fatal operations:**

- **Activity logging** (`logActivity`) — If recording an activity entry fails after a task was already created/updated, the task mutation is still valid.
- **Notifications** (`createNotification`) — Assignment, invitation, and membership notifications are best-effort. Handlers use either `try/catch` or `.catch()` to swallow failures.
- **Supplementary dashboard queries** — Cost aggregation, budget, and cost-per-member queries in the dashboard handlers are individually wrapped. If one fails, the dashboard returns zeroed/empty data for that section while the rest of the response remains intact.

All non-fatal catches log with `console.error` so failures are observable in structured logs.

## Batching with `db.batch()`

Handlers use `db.batch()` to combine multiple D1 statements into a single round-trip. This serves two purposes:

### Atomic write batching

Write batches are atomic — if any statement fails, none are applied.

- **`createProject`** — Inserts the project, creator as admin member, and default task groups in a single `db.batch()` call.
- **`createWorkspace`** — Inserts the workspace and owner membership in a single `db.batch()` call. Catches unique-constraint violations on the `(ownerId, slug)` composite index and returns `409` instead of a generic `500`.
- **`deleteProject`** — Deletes tasks then the project in a single ordered batch (task → project ordering preserves FK constraint behavior).
- **`deleteAttachment`** — Batches DB record deletes and runs them concurrently with the R2 object deletion via `Promise.all`.

### Read batching

When a handler needs multiple independent lookups before it can proceed (e.g., verify a task exists, verify a label exists, check assignment count), these are batched into a single `db.batch()` call to reduce latency. This pattern is used across all handler files — see [Drizzle Query Examples: Batch](../database/query-examples.md#batch-multiple-queries).

> **SQL aliases** — Batch queries that join tables with overlapping column names (e.g., `task.id` vs `project.id`) use explicit `.as()` aliases to prevent D1 result-mapping collisions.

### `.returning()` optimization

Where a handler previously did `SELECT` then `DELETE` (or `UPDATE`), the mutation now uses `.returning()` to combine both into a single query. For example, `markAsRead` and `deleteNotification` use `update(...).returning()` and `delete(...).returning()` to detect not-found in the same statement as the mutation.

## Multi-Step Rollback

Handlers that cannot be fully batched (e.g., where a later step depends on the result of an earlier one in ways that prevent batching) use try/catch with manual cleanup to maintain consistency — the attachment and avatar upload handlers do this because an R2 object and a D1 row cannot share a transaction.

Cleanup `.catch()` calls on rollback deletes ensure that a failed cleanup does not mask the original error.

> **Prefer a transaction to a compensation.** Manual cleanup is the fallback for steps that span systems (R2 objects, external APIs) and genuinely cannot share a transaction. When both writes are database writes, put them in one `db.batch()` — D1 runs a batch as a single implicit transaction, so there is no partial state to compensate for and no compensating write to get wrong. `acceptInvitation` below is the worked example of why.

## Atomic Multi-Write: `acceptInvitation`

Accepting an invitation must do two things — grant the workspace membership and consume the invitation — and they must both happen or neither. It is a single `db.batch()`:

1. `INSERT INTO workspace_member (...) SELECT ... FROM invitation WHERE id = ? AND status = 'pending'`
2. `UPDATE invitation SET status = 'accepted', acceptedAt = ? WHERE id = ? AND status = 'pending'`

Both statements are guarded on the same predicate and, inside one transaction, both see the same pre-state. The insert must be `INSERT ... SELECT` rather than a plain `VALUES` insert because **a conditional `UPDATE` matching zero rows is a success in SQLite, not an error** — a naive pair of statements would happily grant membership from an invitation it had just failed to claim. Deriving the inserted row from the invitation row makes the insert a no-op in exactly the cases the claim is a no-op.

Three outcomes, all clean:

| Outcome | Result |
|---|---|
| Both statements apply | `200` — member joined, invitation consumed |
| Invitation was no longer `pending` | Nothing was written at all → `409 Invitation is <status>` |
| Caller is already a member | Unique index on `(workspaceId, userId)` aborts and rolls the batch back → `400 You are already a member of this workspace`, and the invitation is left **pending** rather than burned |

**Why neither ordering of two separate statements works.** Insert-then-update was the original: the `status !== "pending"` pre-check is a *read*, and a read is not a lock, so two concurrent accepts both passed it, both inserted, the unique index rejected the loser, and that surfaced as an unhandled **500** — telling the caller the server was broken when their invitation had merely already been used. The obvious repair, update-then-insert with a compensating release, fixes the race but trades it for something worse: between the two statements the invitation is consumed with no membership behind it, and a compensating write only runs if an error is *thrown*, not if the isolate is torn down. That window locks the invitee out permanently, with no retry (the invitation is no longer pending) and no signal to anyone. An invisible availability failure is worse than the 500 it replaced.

**Why the rollback is classified by re-reading, not by the error text.** When the batch aborts, the handler re-queries `workspace_member` to decide whether the cause was an existing membership. Matching on the driver's constraint-error string would stop working the day D1 rewords it, and it would fail in the worst direction — turning this clean `400` back into the `500` the change exists to remove. The 400 is worded identically to the pre-flight already-a-member check, because it is the same fact found a few milliseconds later.
