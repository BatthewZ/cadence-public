import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { idempotencyKey } from "../../db/schema/idempotency-key";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_RE,
  IDEMPOTENT_REPLAYED_HEADER,
  WRITE_ERROR_CODES,
} from "../../shared/constants/offline-sync";
import type { AppEnv } from "../env";
import { errorResponse } from "../lib/error-response";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A pending key younger than this is treated as still running; older, as a crashed attempt to take over. */
export const IDEMPOTENCY_PENDING_TIMEOUT_MS = 60_000;

/** Responses larger than this are not stored, so a retry re-executes instead of replaying. */
export const IDEMPOTENCY_MAX_STORED_BODY_BYTES = 1024 * 1024;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 over `method \n path \n body`, so any change to what the key names is a mismatch. */
async function fingerprintRequest(
  method: string,
  path: string,
  body: ArrayBuffer
): Promise<string> {
  const head = new TextEncoder().encode(`${method}\n${path}\n`);
  const bytes = new Uint8Array(head.byteLength + body.byteLength);
  bytes.set(head, 0);
  bytes.set(new Uint8Array(body), head.byteLength);
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

/** Reads a response body as text, or returns null once it exceeds `limit` bytes. */
async function readCappedText(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      // Not awaited: a tee branch's cancel settles only once the other branch (the client's) finishes.
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function inProgressResponse(c: Context<AppEnv>): Response {
  c.header("Retry-After", "1");
  return errorResponse(c, "A request with this Idempotency-Key is still in progress", 409, {
    code: WRITE_ERROR_CODES.idempotencyInProgress,
  });
}

/**
 * Makes a mutation safe to retry: the first 2xx JSON response for a
 * `(user, Idempotency-Key)` pair is stored and replayed to every later request
 * with the same key, without running the handler again.
 *
 * Mount after `authSessionMiddleware` (needs `user`) and before anything that
 * records side effects of a handler run, such as `auditPatMutations`.
 */
export const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
  const user = c.get("user");
  const method = c.req.method.toUpperCase();
  if (
    key === undefined ||
    !user ||
    !MUTATION_METHODS.has(method) ||
    c.req.path.startsWith("/api/auth/")
  ) {
    await next();
    return;
  }

  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    return errorResponse(
      c,
      `${IDEMPOTENCY_KEY_HEADER} must be 1-255 characters of A-Z, a-z, 0-9, "_" or "-"`,
      400
    );
  }

  const db = c.get("db");
  const url = new URL(c.req.url);
  const path = url.pathname + url.search;
  // Not c.req.arrayBuffer(): Hono would cache the bytes, and a later
  // c.req.parseBody() rebuilds them without a Content-Type, breaking multipart.
  const fingerprint = await fingerprintRequest(method, path, await c.req.raw.clone().arrayBuffer());
  const now = new Date();
  const thisKey = and(eq(idempotencyKey.userId, user.id), eq(idempotencyKey.key, key));

  const claimed = await db
    .insert(idempotencyKey)
    .values({
      userId: user.id,
      key,
      method,
      path,
      fingerprint,
      status: null,
      responseBody: null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKey.key });

  if (claimed.length === 0) {
    const [existing] = await db.select().from(idempotencyKey).where(thisKey).limit(1);
    // Released by a failed attempt between our insert and this read.
    if (!existing) return inProgressResponse(c);

    if (existing.fingerprint !== fingerprint) {
      return errorResponse(
        c,
        "This Idempotency-Key was already used for a different request",
        422,
        { code: WRITE_ERROR_CODES.idempotencyMismatch }
      );
    }

    if (existing.status !== null) {
      return new Response(existing.responseBody, {
        status: existing.status,
        headers: { "Content-Type": "application/json", [IDEMPOTENT_REPLAYED_HEADER]: "true" },
      });
    }

    if (now.getTime() - existing.createdAt.getTime() < IDEMPOTENCY_PENDING_TIMEOUT_MS) {
      return inProgressResponse(c);
    }

    const takenOver = await db
      .update(idempotencyKey)
      .set({ createdAt: now })
      .where(
        and(
          thisKey,
          isNull(idempotencyKey.status),
          eq(idempotencyKey.createdAt, existing.createdAt)
        )
      )
      .returning({ key: idempotencyKey.key });
    if (takenOver.length === 0) return inProgressResponse(c);
  }

  let stored = false;
  try {
    await next();

    const res = c.res;
    const isJson =
      res.headers.get("Content-Type")?.toLowerCase().startsWith("application/json") ?? false;
    if (res.status >= 200 && res.status < 300 && isJson) {
      const body = await readCappedText(res.clone(), IDEMPOTENCY_MAX_STORED_BODY_BYTES);
      if (body !== null) {
        await db
          .update(idempotencyKey)
          .set({ status: res.status, responseBody: body })
          .where(and(thisKey, isNull(idempotencyKey.status)));
        stored = true;
      }
    }
  } finally {
    if (!stored) {
      await db.delete(idempotencyKey).where(and(thisKey, isNull(idempotencyKey.status)));
    }
  }
});
