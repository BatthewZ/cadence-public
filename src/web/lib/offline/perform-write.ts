import { IDEMPOTENCY_KEY_HEADER, WRITE_ERROR_CODES } from "@/shared/constants/offline-sync";
import type { ErrorBody } from "@/web/lib/api/client";

export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** What a call site asks for: one REST write, named for the person reading the sync status. */
export interface WriteRequest {
  method: WriteMethod;
  path: string;
  /** JSON-serialisable. Not FormData: uploads are online-only. */
  body?: unknown;
  /** Shown in sync notices, e.g. `Move “Fix login”`. */
  label: string;
}

/**
 * One queued write as stored in IndexedDB. ONE-WAY DOOR: rows written by an older build are
 * replayed by a newer one, so fields are add-only and `v` names the layout.
 */
export interface QueuedWrite extends WriteRequest {
  v: 1;
  /** IndexedDB auto-increment key; absent until stored. */
  id?: number;
  /** Replay order: when the person made the write (`performance.timeOrigin + now()`), not when it was stored. */
  order: number;
  /** Sent as `Idempotency-Key` on every attempt, so a replay after a lost response is applied once. */
  key: string;
  createdAt: number;
  attempts: number;
  /** Five server errors in a row: the queue stops here until the person retries or discards it. */
  stuck: boolean;
  lastError: string | null;
  /**
   * Shared by the writes of one bulk action. They are independent of each other, so the queue
   * sends them together; they still wait behind earlier writes, and later ones wait for all of them.
   */
  batch?: string;
}

export type WriteOutcome =
  | { kind: "ok"; status: number; data: unknown }
  | { kind: "network" }
  | { kind: "unauthorized"; message: string }
  | { kind: "rate-limited"; retryAfterMs: number; message: string }
  | { kind: "in-progress" }
  | { kind: "server-error"; status: number; message: string }
  | { kind: "refused"; status: number; message: string; code?: string; body: unknown };

const DEFAULT_RETRY_AFTER_MS = 5_000;

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function retryAfterMs(res: Response, body: ErrorBody): number {
  const header = Number(res.headers.get("Retry-After"));
  const seconds = Number.isFinite(header) && header > 0 ? header : body.retryAfter;
  return seconds && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

/**
 * A request with no answer by then is abandoned as "no answer" and retried under the same key. On a
 * network that is up but not answering, fetch can otherwise wait minutes, and every later write
 * waits behind it.
 */
export const WRITE_TIMEOUT_MS = 20_000;

export async function performWrite(
  write: Pick<QueuedWrite, "method" | "path" | "body" | "key">,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = WRITE_TIMEOUT_MS
): Promise<WriteOutcome> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let res: Response;
  let data: unknown;
  try {
    res = await fetchImpl(write.path, {
      method: write.method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [IDEMPOTENCY_KEY_HEADER]: write.key,
      },
      body: write.body === undefined ? undefined : JSON.stringify(write.body),
      signal: abort.signal,
    });
    data = await readBody(res);
  } catch {
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
  // A body cut off by the timeout reads as empty; the answer is unknown, so retry under the key.
  if (abort.signal.aborted) return { kind: "network" };

  if (res.ok) return { kind: "ok", status: res.status, data };

  const body = (data && typeof data === "object" ? data : {}) as ErrorBody;
  const message = body.error ?? res.statusText ?? `HTTP ${res.status}`;

  if (res.status === 401) return { kind: "unauthorized", message };
  if (res.status === 429)
    return { kind: "rate-limited", retryAfterMs: retryAfterMs(res, body), message };
  if (res.status === 409 && body.code === WRITE_ERROR_CODES.idempotencyInProgress) {
    return { kind: "in-progress" };
  }
  if (res.status >= 500) return { kind: "server-error", status: res.status, message };
  return { kind: "refused", status: res.status, message, code: body.code, body: data };
}
