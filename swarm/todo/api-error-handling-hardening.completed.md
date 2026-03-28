# API Error Handling Hardening

## Completion Notes (2026-03-26)

All 12 handler files hardened with try-catch error handling following the reference pattern from `attachments.handlers.ts`:

**Files modified (12 handlers + 1 test):**
- `dashboard.handlers.ts` — 6+ try-catch blocks, supplementary queries (budget/cost) are non-fatal
- `search.handlers.ts` — try-catch around Promise.all DB execution
- `notifications.handlers.ts` — 5 handlers wrapped
- `projects.handlers.ts` — multi-step create with cleanup (orphan project deletion), notification fire-and-forget
- `tasks.handlers.ts` — 19 handlers, 73 try-catch blocks; activity/notifications non-fatal; duplicateTask includes cleanup
- `workspaces.handlers.ts` — unique constraint detection returns 409 for duplicate slugs
- `invitations.handlers.ts` — accept-invitation cleanup (delete member if status update fails), already-accepted returns 409
- `teams.handlers.ts` — all CRUD + member management with contextual status codes
- `users.handlers.ts` — defensive wrap around getMe
- `task-groups.handlers.ts` — separate try-catch for reorder and delete steps
- `projects/labels.handlers.ts` — count, duplicate, CRUD with 409 for duplicates
- `tasks/labels.handlers.ts` — assign/unassign with per-operation error handling
- `invitations.handlers.test.ts` — updated test to expect 409 for already-accepted invitation

**Verification:** typecheck passes (0 errors), eslint passes (0 errors), all 1352 tests pass.
**Version:** bumped to 0.1.24.

11 API handler files perform database operations without try-catch blocks. While a global `app.onError()` handler in `src/api/index.ts` catches unhandled exceptions and returns generic 500 responses, handler-specific error handling is needed for:
- **Specific error messages** (e.g., "Failed to load dashboard data" vs generic "Internal Server Error")
- **Correct HTTP status codes** (404 for not-found, 409 for conflicts, 400 for bad input, 500 for unexpected errors)
- **Cleanup logic** when multi-step operations partially complete (see attachments.handlers.ts for the pattern)
- **Better logging** of what specifically failed in each handler

## Reference Pattern

The existing error handling in `src/api/routes/tasks/attachments.handlers.ts` is the gold standard:
```typescript
try {
  await putObject(storage, key, arrayBuffer, { mimeType, filename });
} catch (error) {
  console.error("Failed to upload attachment to R2:", error);
  return c.json({ error: "Failed to upload file" }, 500);
}

// Multi-step with cleanup:
try {
  await db.insert(upload).values({...});
  await db.insert(taskAttachment).values({...});
} catch (error) {
  // Clean up partially-completed work
  await deleteObject(storage, key).catch((err) =>
    console.error("Failed to clean up orphaned R2 object:", err),
  );
  console.error("Failed to save attachment records:", error);
  return c.json({ error: "Failed to save attachment" }, 500);
}
```

**Key principles:**
1. Wrap each logical DB operation (or group of related operations) in try-catch
2. Return `c.json({ error: "Descriptive message" }, statusCode)` — don't re-throw
3. Use `console.error("Context:", error)` for server-side logging
4. For multi-step mutations (insert + insert, or external call + insert), add cleanup in the catch block
5. Use appropriate status codes: 500 for DB/infra failures, 404 for missing resources, 409 for constraint violations

## Dependencies

None. All handler files are independent. All tasks can run concurrently.

## Concurrency Plan

14 handler files total. Group into **4 batches** based on complexity and file count.

The orchestrator should run 3-4 agents concurrently per batch.

---

### Batch 1 (3 concurrent agents — simple read-heavy handlers)

#### Task 1: dashboard.handlers.ts
- **File:** `src/api/routes/dashboard/dashboard.handlers.ts`
- **What it does:** Aggregates workspace dashboard data (projects, member counts, task counts, recent activity, budget info).
- **Risk without try-catch:** Multiple complex queries with joins — any failure returns generic 500 with no context.
- **Fix:**
  1. Read the file to understand all handler functions and their DB queries
  2. Wrap each handler's DB operations in try-catch
  3. Return specific error messages: e.g., `c.json({ error: "Failed to load dashboard data" }, 500)`
  4. For queries that fetch optional/supplementary data (like budget info), consider catching individually so partial data can still be returned
- **Verification:** Run `bun run typecheck`. Run tests if any exist for dashboard handlers (`bun test dashboard`).

#### Task 2: search.handlers.ts
- **File:** `src/api/routes/search/search.handlers.ts`
- **What it does:** Search across projects, tasks, and other entities.
- **Risk:** Search queries with LIKE/FTS can fail on malformed input or DB issues.
- **Fix:**
  1. Read the file
  2. Wrap search operations in try-catch
  3. Return `c.json({ error: "Search failed" }, 500)` for DB errors
  4. Consider returning empty results with a warning header for partial failures
- **Verification:** Run `bun run typecheck`. Run tests if any exist (`bun test search`).

#### Task 3: notifications.handlers.ts
- **File:** `src/api/routes/notifications/notifications.handlers.ts`
- **What it does:** CRUD operations for user notifications (list, mark read, mark all read, delete).
- **Risk:** Bulk updates (mark all read) could fail silently.
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. Use specific messages: "Failed to fetch notifications", "Failed to mark notifications as read", etc.
  4. For mark-all-read: if the bulk update fails, return 500 with clear message
- **Verification:** Run `bun run typecheck`. Run tests (`bun test notification`).

---

### Batch 2 (3 concurrent agents — CRUD handlers with mutations)

#### Task 4: projects.handlers.ts
- **File:** `src/api/routes/projects/projects.handlers.ts`
- **What it does:** Full CRUD for projects (create, read, update, delete, archive, cover image, members).
- **Risk:** Multi-step mutations (create project + add member, delete project + cleanup) need specific error handling and possible cleanup.
- **Fix:**
  1. Read the file carefully — this is likely one of the larger handlers
  2. Wrap each handler function in try-catch
  3. For create operations: if project is created but member addition fails, decide whether to rollback or return partial success
  4. For delete operations: ensure cleanup of related data is handled
  5. Return appropriate status codes: 404 for project not found, 409 for duplicate slugs, 500 for unexpected errors
- **Verification:** Run `bun run typecheck`. Run tests (`bun test projects`).

#### Task 5: tasks.handlers.ts
- **File:** `src/api/routes/tasks/tasks.handlers.ts`
- **What it does:** Full CRUD for tasks (create, read, update, delete, move, assign, labels, due dates).
- **Risk:** Task mutations involve multiple tables (tasks, labels, assignees). Partial failures can leave inconsistent state.
- **Fix:**
  1. Read the file carefully — likely the largest handler
  2. Wrap each handler in try-catch
  3. Multi-step mutations (create task + assign labels + set assignee) need cleanup in catch blocks
  4. Use 404 for task not found, 400 for invalid input, 500 for DB failures
- **Verification:** Run `bun run typecheck`. Run tests (`bun test tasks`).

#### Task 6: workspaces.handlers.ts
- **File:** `src/api/routes/workspaces/workspaces.handlers.ts`
- **What it does:** Workspace CRUD, member management, settings.
- **Risk:** Workspace operations affect many downstream entities. Member count queries (recently added) need protection.
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. 404 for workspace not found, 409 for duplicate slugs, 500 for DB errors
  4. Member management operations (add/remove) need specific error messages
- **Verification:** Run `bun run typecheck`. Run tests (`bun test workspace`).

---

### Batch 3 (3 concurrent agents — smaller handlers)

#### Task 7: invitations.handlers.ts
- **File:** `src/api/routes/invitations/invitations.handlers.ts`
- **What it does:** Create, accept, reject, list invitations.
- **Risk:** Accept-invitation is multi-step (validate + add member + update invitation status). Partial failure = broken state.
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. Accept-invitation needs cleanup logic if member creation succeeds but invitation status update fails
  4. Use 404 for invalid invitation tokens, 409 for already-accepted, 500 for DB errors
- **Verification:** Run `bun run typecheck`. Run tests (`bun test invitation`).

#### Task 8: teams.handlers.ts
- **File:** `src/api/routes/teams/teams.handlers.ts`
- **What it does:** Team CRUD and member management.
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. 404 for team not found, 409 for duplicates, 500 for DB errors
- **Verification:** Run `bun run typecheck`. Run tests (`bun test team`).

#### Task 9: users.handlers.ts
- **File:** `src/api/routes/users/users.handlers.ts`
- **What it does:** User profile operations (get profile, update profile, sessions).
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. 404 for user not found, 500 for DB errors
- **Verification:** Run `bun run typecheck`. Run tests (`bun test user`).

---

### Batch 4 (3 concurrent agents — remaining handlers)

#### Task 10: task-groups.handlers.ts
- **File:** `src/api/routes/task-groups/task-groups.handlers.ts`
- **What it does:** CRUD for task groups (status columns on kanban board).
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. Reorder operations need special care — if position update fails mid-batch, state could be inconsistent
  4. 404 for group not found, 500 for DB errors
- **Verification:** Run `bun run typecheck`. Run tests (`bun test task-group`).

#### Task 11: labels.handlers.ts (projects)
- **File:** `src/api/routes/projects/labels.handlers.ts`
- **What it does:** CRUD for project-level labels.
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. 404 for label not found, 409 for duplicate label names, 500 for DB errors
- **Verification:** Run `bun run typecheck`. Run tests (`bun test label`).

#### Task 12: labels.handlers.ts (tasks)
- **File:** `src/api/routes/tasks/labels.handlers.ts`
- **What it does:** Add/remove labels on tasks.
- **Fix:**
  1. Read the file
  2. Wrap each handler in try-catch
  3. 404 for task/label not found, 409 for duplicate label assignment, 500 for DB errors
- **Verification:** Run `bun run typecheck`. Run tests (`bun test label`).

---

## Post-completion

After all batches are done:
1. Run `bun run typecheck` to verify no type errors were introduced across the whole project
2. Run `bun run test` to verify all tests still pass
3. Update the project version (patch increment) in package.json per semantic versioning rules
4. Verify that no `ts-expect-error` or `eslint-disable` comments were added (per project rules)
