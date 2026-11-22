import { api, ApiError } from "@/web/lib/api/client";

import type { SendAnswer } from "./outbox";
import type { WriteRequest } from "./perform-write";
import { activeOutbox, isOnline } from "./runtime";

export type { WriteMethod, WriteRequest } from "./perform-write";

/**
 * `sent`: the server accepted it now and `data` is its reply.
 * `queued`: stored on this device; it replays when the connection allows, and its reply is never
 * delivered to the caller — the cache is refreshed from the server once the queue drains.
 */
export type WriteResult<T> = { status: "sent"; data: T } | { status: "queued" };

function writeOrder(): number {
  return performance.timeOrigin + performance.now();
}

function viaApi<T>({ method, path, body }: WriteRequest): Promise<T> {
  switch (method) {
    case "POST":
      return api.post<T>(path, body);
    case "PUT":
      return api.put<T>(path, body);
    case "PATCH":
      return api.patch<T>(path, body);
    case "DELETE":
      return api.delete<T>(path);
  }
}

/**
 * Sends a write that may be made offline. The caller has already applied it to the cache
 * optimistically, and reverts only when this throws.
 *
 * Every write is stored in the queue first and sent in the order it was made, so it can't
 * overtake an earlier write still in flight (an edit reaching the server before its create).
 * - Online with nothing queued ahead: sent now with an idempotency key, and this resolves with
 *   the reply. No response (connection dropped) → `queued` under the same key, so a request
 *   that did land isn't applied twice.
 * - Offline, behind queued writes, or the queue blocked: stored and `queued`.
 * - The server answers with an error → throws `ApiError`, as `api.*` does.
 *
 * Without a signed-in offline runtime (guest pages, tests) this is a plain `api.*` call.
 */
export function sendWrite<T = unknown>(request: WriteRequest): Promise<WriteResult<T>> {
  const [result] = sendWrites<T>([request]);
  return result;
}

/**
 * `sendWrite` for the writes of one bulk action, which don't depend on each other: the queue
 * sends them together rather than one by one, still in order with every other write. Returns one
 * promise per request, settling as `sendWrite` would — combine with `Promise.all`/`allSettled`.
 */
export function sendWrites<T = unknown>(requests: WriteRequest[]): Promise<WriteResult<T>>[] {
  const outbox = activeOutbox();
  if (!outbox) {
    return requests.map((request) => viaApi<T>(request).then((data) => ({ status: "sent", data })));
  }

  const order = writeOrder();
  const writes = requests.map((request) => ({ request, key: crypto.randomUUID() }));
  if (!isOnline() || !outbox.canSendNow()) {
    const stored = outbox.enqueueBatch(writes, order).then((): WriteResult<T> => {
      outbox.kick();
      return { status: "queued" };
    });
    return writes.map(() => stored);
  }

  const answers = outbox.send(writes, order);
  return writes.map((_, i) => answers.then((all) => all[i]).then((answer) => toResult<T>(answer)));
}

function toResult<T>(answer: SendAnswer): WriteResult<T> {
  switch (answer.kind) {
    case "ok":
      return { status: "sent", data: answer.data as T };
    case "queued":
      return { status: "queued" };
    case "unauthorized":
      throw new ApiError(401, answer.message);
    case "rate-limited":
      throw new ApiError(429, answer.message);
    case "server-error":
      throw new ApiError(answer.status, answer.message);
    case "refused":
      throw new ApiError(answer.status, answer.message, answer.code, answer.body);
  }
}

/** The reply of a write that was `sent`, or undefined when it was queued. */
export function sentData<T>(result: WriteResult<T>): T | undefined {
  return result.status === "sent" ? result.data : undefined;
}
