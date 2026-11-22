# Frontend API Client

The frontend uses a typed fetch wrapper defined in `src/web/lib/api/client.ts`:

```ts
export async function api<T>(path: string, options?: RequestInit): Promise<T>
api.get    = <T>(path: string, options?: RequestInit) => api<T>(path, options);
api.post   = <T>(path: string, body: unknown, options?: RequestInit) => ...;
api.put    = <T>(path: string, body: unknown, options?: RequestInit) => ...;
api.patch  = <T>(path: string, body: unknown, options?: RequestInit) => ...;
api.delete = <T>(path: string, options?: RequestInit) => ...;
```

## Features

- Automatically sets `Content-Type: application/json` and `credentials: "include"`.
- Supports `FormData` bodies for file uploads -- when the body is a `FormData` instance, the `Content-Type` header is omitted so the browser sets the correct `multipart/form-data` boundary.
- Throws `ApiError` on non-2xx responses: `status`, `message` (the body's `error`), `code` (the body's machine-readable `code`, e.g. `description_conflict`) and `body` (the parsed error body, for refusals that carry data).
- Throws `OfflineError` (an `ApiError` with `status` 0 and the message "You're offline — this needs a connection.") when the request never reached the server. An `AbortError` is rethrown as is.
- On 401 responses, calls the `onUnauthorized` callback (which shows a toast and redirects to `/login`).
- A `GET` first waits for the offline write queue to finish an active drain (`src/web/lib/offline/read-barrier.ts`), so it can't return server state from before the user's own queued writes.

`api` sends a request once. A write that should survive going offline goes through `sendWrite` instead, which queues it and replays it with an `Idempotency-Key` — see [Offline mode](../architecture/offline.md).

## Usage

```ts
import { api } from "@/web/lib/api/client";

// GET
const { user } = await api.get<{ user: User }>("/api/me");

// POST
const { post } = await api.post<{ post: Post }>("/api/posts", { title: "Hello" });

// PUT with FormData (file upload)
const formData = new FormData();
formData.append("file", file);
const { upload } = await api.put<{ upload: Upload }>("/api/users/me/avatar", formData);
```
