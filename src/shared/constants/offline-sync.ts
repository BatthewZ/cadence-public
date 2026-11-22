// Wire contract between the offline write queue (src/web/lib/offline) and the API.
// Public API surface: PAT clients may send the same header, so names here are add-only.
// Design: docs/architecture/offline.md.

/** Request header naming one logical write; a retry with the same key replays the first 2xx response. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** Response header set to "true" when the body is a stored replay, not a fresh execution. */
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";

/** Keys are 1–255 chars of `[A-Za-z0-9_-]`; the web client sends `crypto.randomUUID()`. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{1,255}$/;

/** How long a completed key is remembered. Longer than a session, so a week offline still replays safely. */
export const IDEMPOTENCY_TTL_DAYS = 30;

/**
 * `code` field on error bodies the queue must tell apart from a plain refusal.
 * - `idempotency_in_progress` (409): the first request with this key is still running; retry later.
 * - `idempotency_mismatch` (422): the key was used for a different method, path or body.
 * - `id_conflict` (409): a create's client-supplied `id` already exists.
 * - `description_conflict` (409): `descriptionBase` no longer matches the stored description.
 */
export const WRITE_ERROR_CODES = {
  idempotencyInProgress: "idempotency_in_progress",
  idempotencyMismatch: "idempotency_mismatch",
  idConflict: "id_conflict",
  descriptionConflict: "description_conflict",
} as const;

export type WriteErrorCode = (typeof WRITE_ERROR_CODES)[keyof typeof WRITE_ERROR_CODES];
