# Error Handling

The global error handler is defined in `src/api/index.ts`:

```ts
app.onError((err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  if (err instanceof HTTPException) {
    return c.json({ error: err.message, requestId }, err.status);
  }

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

1. **`HTTPException`**: If the error is a Hono `HTTPException` (e.g., thrown by middleware or handlers), the response uses the exception's status code and message. The `requestId` is always included.

2. **Unexpected errors**: Any other error is logged as a structured JSON object (with the full stack trace) and returns a generic `500 Internal Server Error` response. The error details are never leaked to the client.

3. **Request ID**: Every error response includes the `requestId`, making it possible to correlate client-side errors with server-side logs.

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

Handlers that cannot be fully batched (e.g., where a later step depends on the result of an earlier one in ways that prevent batching) use try/catch with manual cleanup to maintain consistency:

- **`acceptInvitation`** — Inserts the workspace member, then updates the invitation status. If the status update fails, the member record is deleted to avoid orphaned membership.

Cleanup `.catch()` calls on rollback deletes ensure that a failed cleanup does not mask the original error.
