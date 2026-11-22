# Offline mode

Cadence is an installable PWA. It starts without a connection, shows what this device has already loaded, and accepts
the everyday board edits offline. Those edits appear at once, are stored on the device, and are sent through the
normal REST API when the connection returns.

The server stays the single source of truth. Nothing here is a local-first database: an offline edit is a REST
request that waits its turn, and replaying it runs the same handler, permission checks, activity log, notifications
and webhooks as sending it live.

## What works offline

| Works offline (queued, optimistic) | Needs a connection (control disabled, "Needs a connection") |
| --- | --- |
| Create, edit, move, complete/reopen and delete tasks | Attachments and cover uploads, Unsplash covers, duplicating tasks |
| Subtasks and comments (create, edit, delete, reorder) | Search |
| Labels and label assignment | Create or duplicate a project, create a workspace, ICS/Trello import, export |
| Task groups (create, rename, recolor, reorder, delete) | Members, teams, invitations, roles |
| Saved views | Webhooks, API tokens, calendar feed |
| Project fields and themes, project reorder | Account settings, sessions, sign-out, ToS acceptance |
| Reading every project, board, list, timeline, calendar, task and dashboard opened on this device before | Notifications, activity feeds |

## The pieces

```
src/web/lib/offline/
  idb.ts               one IndexedDB per account: `cadence-offline:<userId>` (stores `outbox`, `kv`)
  send-write.ts        sendWrite() — the one call an offline-capable write makes
  perform-write.ts     sends one write with its Idempotency-Key and classifies the answer; the stored-write format
  outbox.ts            the queue: replay order, retries, refusals, cross-tab lock, status
  read-barrier.ts      GETs wait while the queue is draining
  query-persister.ts   saves and restores the React Query cache (persisted-queries.ts says which queries)
  runtime.ts           starts all of it per signed-in account; wipeOfflineData() for sign-out
  OfflineProvider.tsx  mounted by AuthGuard; renders once the saved cache is back in memory
  hooks.ts             useOnline, useSyncStatus, useQueuedWrites, useSyncActions, useSyncRefusals
src/web/lib/auth/      useSession falls back to the last confirmed session (session-cache.ts) when unreachable
src/web/lib/pwa/       service worker registration, update prompt, install
src/web/lib/task-writes.ts   sendWrite requests shared by several call sites (taskCompletionWrite)
src/web/components/sync/  SyncStatusBadge, SyncNotices, useOnlineOnly, OfflineUnavailable, useSignOut, copyMyVersion
src/api/middleware/idempotency.ts   Idempotency-Key on the server
src/api/lib/client-id.ts           409 id_conflict for a taken client id
src/api/lib/position-conflict.ts   writeClientPosition / nextSiblingPosition for stale client positions
src/shared/constants/offline-sync.ts   the header names and error codes both sides use
```

One runtime runs at a time, for the signed-in account. Signing in as someone else stops the previous runtime and
empties the in-memory cache before the new one starts. A runtime that is stopped while it is still starting (opening
IndexedDB, restoring the cache) tears itself down instead of continuing, so one account's persister never saves another
account's cache, and stopping it clears the read barrier only if no newer runtime has set its own.

## A write, start to finish

1. The call site updates the React Query cache optimistically, as Cadence always has, then calls
   `sendWrite({ method, path, body, label })`.
2. Every write is stored in the `outbox` store first, with a fresh `Idempotency-Key`, and sent from there in the
   order it was made. So a write can never overtake an earlier one still in flight: an edit to a card made just after
   creating it reaches the server after the create, online or not. A new row can be edited, dragged or deleted at
   once; its writes wait behind its create.
3. **Online, nothing queued ahead** (except other writes being sent this way): `sendWrite` waits for that write's
   answer (`Outbox.send`). A reply → `{ status: "sent", data }` and the call site reconciles with it. An error reply
   (4xx, 5xx, 401, 429) → the write is removed and `sendWrite` throws `ApiError`; the call site reverts. These writes
   don't count as "to sync" in the badge. The wait is capped at 3 s (`ANSWER_DEADLINE_MS`). On a network that is up
   but not answering (flaky Wi-Fi, where the browser still says online), the caller then gets `queued`, so "Saving…"
   never sticks. The write carries on in the background, shown in the badge, and a refusal arrives as a sync notice.
4. **Offline, queued writes ahead, the queue blocked, or no answer** (connection dropped, no answer within the 3 s
   deadline, request still running, reload or sign-out mid-send): `{ status: "queued" }`. The call site keeps its optimistic state and does nothing
   else. The write stays stored under the key it was sent with, so if it did reach the server the replay gets the
   stored reply instead of applying it twice.
5. The queue drains in the order the writes were made, one at a time, when the browser comes online, at start-up,
   and after each new write. The exception is a bulk action (`sendWrites`): its writes are stored in one transaction
   under a shared `batch` id and sent together, since they don't depend on each other; later writes wait for all of
   them. One tab drains at a time (Web Locks); the others follow its progress over a BroadcastChannel.
6. When the queue empties after replaying writes nobody was waiting on, every query is invalidated, so the screen
   picks up the server's view of them: positions, the next instance of a recurring task, assignee names.

Writes that come back `queued` replay under these rules:

| Server answer during a replay | What the queue does |
| --- | --- |
| 2xx | done, next write |
| 409 `id_conflict` on a create | the create already landed: done |
| other 4xx (deleted task, no permission, invalid) | dropped, reported as a toast (`SyncNotices`), next write |
| 409 `description_conflict` | dropped, reported with "Copy my version" so the text isn't lost |
| 401 | stops, keeps every write, sends the person to sign in; resumes after sign-in as the same account |
| 429 | waits for `Retry-After` |
| 409 `idempotency_in_progress` | the first attempt is still running: retries in a second |
| no answer (including none within 20 s, `WRITE_TIMEOUT_MS`: the request is abandoned) | retries with backoff (2 s doubling to 60 s), and at once on the `online` event, under the same key |
| 5xx | retries with backoff; after 5 in a row the write is **stuck** and the queue stops behind it until the person retries or discards it (sync badge) |

GETs wait for an active drain (`read-barrier.ts`), so a refetch can't show server state from before the person's
own queued writes. While the queue waits between retries, reads go through. A refetch then shows server state until
the drain lands.

## Reads offline

- `persisted-queries.ts` is the allowlist of saved queries: workspaces, projects, tasks, comments, labels, saved views,
  task groups, members, dashboards, the ToS status and feature flags. Search, activity, notifications, webhooks,
  tokens, invitations and the calendar-feed status are never saved.
- The cache is saved at most once a second, and on page hide. Every tab saves to the same record, so a save merges
  into it rather than replacing it (`mergeSavedCache`, one IndexedDB transaction): per query the newer copy wins, and
  queries only another tab loaded are kept. Without that, only the last tab's projects would open offline. Saved data
  is dropped after 14 days (per query), or when the app version changes, since a new build may read responses
  differently. The write queue is kept across versions, because the
  API stays compatible.
- Queries pause while offline (TanStack `networkMode: "online"`). A screen whose data was never loaded on this
  device shows `OfflineUnavailable` instead of a spinner.
- Mutations use `networkMode: "always"`, so an online-only action fails at once with "You're offline — this needs a
  connection." (`OfflineError`), rather than pausing and firing whenever the connection returns.

## Session offline

`useSession` (`src/web/lib/auth/auth-client.ts`) returns Better Auth's answer whenever the server gives one. If the
server can't be reached (no network, a failed request, or no answer within 3 s), it uses the last session the server
confirmed. That copy is kept in localStorage without its token and trusted until the session's own expiry. The
cached copy only decides what the device shows. The cookie still authenticates every request, and the server
authorizes every replay.

## Sign-out deletes this device's data

Sign-out (and account deletion) needs a connection. If writes are still queued, the person confirms that they will be
deleted. After the server confirms the sign-out, the account's IndexedDB (saved reads and queued writes), the cached
session, the in-memory cache and the saved theme are deleted (`useSignOut` → `forgetThisDevice`). Cadence is used on
shared and work computers, so nothing is kept.

## The server side of a safe replay

- **`Idempotency-Key`** (`src/api/middleware/idempotency.ts`): see [API § Idempotency-Key](../api/api.md#idempotency-key). Scoped per user and kept 30 days.
  A replay returns the first 2xx answer with `Idempotent-Replayed: true`, and doesn't re-run the handler, its side
  effects or the PAT audit.
- **Client ids:** task, subtask, comment, task group, label and saved-view creates accept an `id` (uuid), so
  something created offline can be edited offline before it reaches the server.
- **Positions:** a move or reorder to a position that is already taken lands next to it instead of failing
  (`writeClientPosition` with `nextSiblingPosition` as its sibling lookup, in `src/api/lib/position-conflict.ts`).
- **Description compare-and-set:** `descriptionBase` on PATCH /api/tasks/:id refuses to overwrite a description
  someone else changed meanwhile. The web client sends the text the editor was opened with (`EditableMarkdown`'s
  `onEditStart`), online and offline alike.
- **Freshness counts:** the freshness endpoints report row counts as well as `MAX(updatedAt)`, so other clients
  notice deletes.

## One-way doors

- The stored write format (`QueuedWrite`, `v: 1`, in `perform-write.ts`). Rows written by an older build are replayed
  by a newer one, so fields are add-only.
- The `Idempotency-Key` semantics and the `idempotency_key` table, and the client `id` and `descriptionBase` request
  fields. These are public API: PAT clients may rely on them.
- Webhooks for replayed writes fire when the write reaches the server, timestamped then.

## Making another write offline-capable

1. Make sure the endpoint is safe to replay: client id on creates, no client-computed value that can collide.
2. Apply it to the cache optimistically and revert in `catch`. Offline, the cache is the only copy until the queue syncs,
   so write every copy a screen can be rebuilt from, not just component state. The task panel and dialog do this
   through `useLocalTask`, which writes each edit to the task's detail query as well. A rollback should undo only
   its own change, not restore a whole snapshot over edits made since. If the server changes more than the request
   says (completing a task moves it to the completion group), mirror that too: `completionChange` in
   `src/web/lib/task-writes.ts` follows `handlers/completion.ts`, so the card moves offline as it will on the server.
3. Call `sendWrite` with a label the person will recognise in the sync badge (`Move “Fix login”`). For the same
   change to many independent rows (a bulk action), use `sendWrites`, which returns one promise per request.
4. On `sent`, reconcile with the reply. On `queued`, do nothing more.
5. In a `useMutation`, return `sendWrite`'s result from `mutationFn` and make `onSuccess` tolerate `queued`.

## Checking it

- Unit: `src/web/lib/offline/*.test.ts` (queue rules against fake-indexeddb, `sendWrite` through the real runtime,
  the allowlist) and `src/web/lib/auth/auth-client.test.ts`.
- The service worker exists only in production builds. Test offline behaviour with `bun run build`, then
  `bunx wrangler dev`, then DevTools → Network → Offline. Never test it against the Vite dev server.
- iPhone: check on a real device before shipping (pwa-starter CONTRACT §7b). Headless Chromium can't show iOS
  storage or install behaviour.
