import type { User } from "better-auth/types";
import { createMiddleware } from "hono/factory";

import type { AppBindings, AppVariables } from "../env";
import {
  bumpLastUsedAt,
  requireTokenHashPepper,
  TOKEN_PREFIX,
  verifyToken,
} from "../lib/api-tokens";
import { createAuth } from "../lib/auth";
import { errorResponse } from "../lib/error-response";

/**
 * The PAT (Personal Access Token) bearer prefix we accept on the
 * Authorization header. We deliberately require the full `Bearer cdn_pat_`
 * prefix so non-PAT bearer tokens (e.g. better-auth's own session bearer
 * plugin) keep falling through to the cookie/session path.
 */
const PAT_BEARER_PREFIX = `Bearer ${TOKEN_PREFIX}`;

/**
 * Authenticates the request via one of two channels:
 *
 * 1. **Personal Access Token (PAT)** — `Authorization: Bearer cdn_pat_…`.
 *    PAT verification is delegated to [src/api/lib/api-tokens.ts](../lib/api-tokens.ts).
 *    On success the middleware sets `user`, `apiToken` and pre-caches the
 *    `workspaceMembership` (the join already happened during verification, so
 *    downstream `requireWorkspaceMember` can skip a redundant lookup). Last-used
 *    telemetry is fired-and-forgotten via `bumpLastUsedAt`. On *failure* we
 *    return 401 immediately rather than falling through to cookie auth — falling
 *    through would let a stolen-but-revoked PAT silently downgrade to a session
 *    cookie carried in the same request.
 *
 * 2. **Better Auth session cookie** (the existing flow) — used for browser
 *    requests. The early-exit when no credentials are present avoids a DB
 *    round-trip for unauthenticated traffic (health checks, static asset
 *    fallbacks, etc.).
 *
 * `c.set("apiToken", null)` is always written on the session branch so
 * downstream code can rely on `c.get("apiToken") === null` meaning "this is a
 * cookie-authenticated request" without having to disambiguate `undefined`.
 */
export const authSessionMiddleware = createMiddleware<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>(async (c, next) => {
  // Skip session resolution when no auth credentials are present.
  // Better Auth resolves sessions from cookies (default: "better-auth.session_token").
  // If neither a cookie header nor an authorization header is sent, there is
  // no possible session to look up — avoid the DB round-trip entirely.
  const cookieHeader = c.req.header("cookie");
  const authHeader = c.req.header("authorization");

  if (!cookieHeader && !authHeader) {
    c.set("user", null);
    c.set("session", null);
    c.set("apiToken", null);
    await next();
    return;
  }

  // ---------------------------------------------------------------------------
  // PAT branch — Bearer cdn_pat_… tokens
  // ---------------------------------------------------------------------------
  if (authHeader && authHeader.startsWith(PAT_BEARER_PREFIX)) {
    const plaintext = authHeader.slice("Bearer ".length);
    const db = c.get("db");

    // Resolve the pepper through the same guard the mint paths use. A missing
    // pepper here would otherwise reach WebCrypto as an empty key and fail
    // with an opaque "HMAC key length (0)" DataError — the explicit throw
    // turns a misconfigured deployment into a clear, greppable log line
    // ("TOKEN_HASH_PEPPER is required…") that surfaces via the onError 500.
    const pepper = requireTokenHashPepper(c.env.TOKEN_HASH_PEPPER);

    const result = await verifyToken(db, plaintext, pepper);
    if (!result) {
      // Single 401 message for every failure mode (malformed body, expired,
      // revoked, lost workspace membership). Leaking which one helps an
      // attacker enumerate valid tokens.
      return errorResponse(c, "Invalid API token", 401);
    }

    // Bridge ApiTokenUser → better-auth User. Both shapes carry the same
    // columns (id, email, name, emailVerified, image, createdAt, updatedAt),
    // so we construct the object explicitly rather than asserting types —
    // this keeps the boundary auditable and surfaces drift as a compile error
    // instead of hiding it behind a cast.
    const bridgedUser: User = {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      emailVerified: result.user.emailVerified,
      image: result.user.image,
      createdAt: result.user.createdAt,
      updatedAt: result.user.updatedAt,
    };

    c.set("user", bridgedUser);
    c.set("session", null);
    c.set("apiToken", result.token);
    // Pre-cache the membership the verify-join already resolved so the
    // authorize middleware does not need to re-fetch it.
    c.set("workspaceMembership", result.workspaceMembership);

    // Fire-and-forget — never awaited, never throws (helper swallows errors).
    bumpLastUsedAt(c, result.token.id);

    await next();
    return;
  }

  // ---------------------------------------------------------------------------
  // Session-cookie branch (existing flow) — also handles non-PAT bearers
  // (e.g. better-auth's own session bearer plugin) by letting better-auth
  // figure out whether the header is a session it recognizes.
  // ---------------------------------------------------------------------------
  const auth = createAuth(c.env);

  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        middleware: "authSession",
        method: c.req.method,
        path: c.req.path,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }

  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
  } else {
    c.set("user", null);
    c.set("session", null);
  }
  c.set("apiToken", null);

  await next();
});
