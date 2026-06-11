/**
 * Personal Access Token (PAT) helpers for the API token authentication flow.
 *
 * This is the central library that backs the bearer-token auth path: minting
 * tokens, deriving the HMAC-SHA256 hash that lives in the DB, verifying
 * inbound tokens (including expiry/revocation/membership checks), and
 * answering scope and project-access questions for the authorization
 * middleware.
 *
 * ## Why these primitives are critical
 *
 * - `verifyToken` is the only place that turns a plaintext `cdn_pat_...` string
 *   into a trusted `{ user, token, workspaceMembership }` triple. Every PAT
 *   request flows through it, so any bug here is an authentication bypass or
 *   denial-of-service. We deliberately reject before the DB lookup when the
 *   prefix is wrong (no expensive hash + query for garbage Authorization
 *   headers) and always re-verify workspace membership at request time
 *   (membership revocation must instantly disable the token even if the row
 *   is still active).
 * - `hashToken` is HMAC-SHA256 with a server-side pepper from `env`. The
 *   pepper hardens the storage hash against database-only exfiltration: a
 *   stolen DB row's `tokenHash` is useless without the pepper, so verifying
 *   a guessed plaintext offline requires both the database and the secret.
 *   Plain SHA-256 would be cracked in a DB-leak scenario by any attacker
 *   willing to hash a candidate dictionary. We do not use bcrypt or argon2
 *   because Cloudflare Workers' free-tier 10 ms CPU budget per invocation
 *   cannot accommodate them; HMAC-SHA256 is deterministic, fast, and the
 *   right primitive for high-entropy random secrets where the goal is "make
 *   the DB row useless without a server secret" rather than "slow down
 *   guesses against low-entropy passwords".
 * - `hasScope` enforces our resource-action permission grammar including the
 *   `read:*` / `write:*` aggregates. `project:delete` is intentionally
 *   excluded from `write:*` because deletion is a heightened action that
 *   should require an explicit, auditable grant.
 * - `canAccessProject` honors GitHub-style "all projects" vs "selected
 *   projects" scoping that lets a workspace admin mint narrowly-scoped
 *   tokens for least-privilege integrations.
 *
 * All exported helpers are pure (no module-level state) so they can be
 * exercised in isolation by the unit tests without standing up Hono or a
 * real DB beyond the in-memory Miniflare D1 fixture.
 */

import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../db";
import {
  type ApiToken,
  apiToken,
  user,
  workspaceMember,
} from "../../db/schema";
import type { WorkspaceRole } from "../../shared/types/roles";
import type { AppEnv } from "../env";
import { deferWork } from "./defer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Prefix every minted token plaintext starts with.
 *
 * The fixed prefix lets us cheap-reject anything that does not look like one
 * of our tokens before we pay the cost of a SHA-256 hash and a DB lookup.
 * It also gives secret scanners (gitleaks et al.) a deterministic anchor to
 * recognize leaked tokens in source control.
 */
export const TOKEN_PREFIX = "cdn_pat_";

/**
 * Random byte count behind every token. 32 bytes = 256 bits of entropy,
 * matching SHA-256 and the industry standard for opaque API tokens.
 */
export const TOKEN_RANDOM_BYTES = 32;

/**
 * Length of the stored / displayed prefix. First 12 characters of the
 * plaintext (i.e. `cdn_pat_` + first 4 random chars) is enough to let users
 * distinguish multiple tokens in a list without revealing meaningful entropy.
 */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 12;

/**
 * The full set of well-known scope strings that the application understands.
 *
 * We freeze the set so callers cannot mutate it at runtime. Unknown scopes
 * are still accepted on read (forward compatibility — tokens minted by a
 * future schema must not break when read by an older worker) but write-side
 * validation in token-management routes will only allow members of this set.
 */
export const KNOWN_SCOPES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    "workspace:read",
    "workspace:write",
    "project:read",
    "project:write",
    "project:delete",
    "task:read",
    "task:write",
    "task:delete",
    "label:read",
    "label:write",
    "attachment:read",
    "attachment:write",
    "team:read",
    "team:write",
    "invitation:write",
    "webhook:read",
    "webhook:write",
    "read:*",
    "write:*",
  ]),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of the `user` row returned by `verifyToken`. Mirrors the columns on
 * the `user` table — kept local so we don't drag better-auth's expanded User
 * type (with optional plugin fields) through the verification path. The
 * middleware (Batch 3) is responsible for adapting this into whatever shape
 * downstream handlers expect from `c.get("user")`.
 */
export type ApiTokenUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Workspace-membership context required by `requireWorkspaceMember`. We pre-
 * cache this on the request so the authorize middleware does not need a
 * second DB round-trip to find the membership the token already proved.
 */
export type ApiTokenWorkspaceMembership = {
  id: string;
  workspaceId: string;
  role: WorkspaceRole;
};

/**
 * Successful verification yields all three pieces of state the rest of the
 * request pipeline needs: the token itself (for scope/project checks), the
 * user (for `c.set("user")`), and the workspace membership (for
 * `requireWorkspaceMember`).
 */
export type VerifyResult = {
  token: ApiToken;
  user: ApiTokenUser;
  workspaceMembership: ApiTokenWorkspaceMembership;
};

// ---------------------------------------------------------------------------
// Generation / hashing
// ---------------------------------------------------------------------------

/**
 * Encode bytes to base64url (RFC 4648 §5) without padding. The browser /
 * Workers runtime only ships standard base64, so we manually swap the
 * URL-unsafe characters and strip `=`. Pure helper so we can share between
 * generation and any future verification helper.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  // btoa is available in the Workers runtime (and Node 16+).
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Convert an ArrayBuffer (e.g. the output of `crypto.subtle.digest`) to a
 * lowercase hex string. Hex is the canonical storage format for token
 * hashes so the column stays human-greppable in audit dumps.
 */
function bufferToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < view.length; i += 1) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Resolve the server-side pepper from env, enforcing presence at the call
 * site.
 *
 * Throwing here (rather than silently falling back to plain SHA-256) is
 * intentional: a missing pepper means every minted token is one DB-exfil
 * away from offline cracking, and that failure mode must not depend on a
 * deployer remembering to read a warning log. The error is opaque to the
 * client because it bubbles up through `onError` as a 500, never disclosing
 * the missing config name on the wire.
 */
export function requireTokenHashPepper(pepper: string | undefined): string {
  if (!pepper || pepper.length === 0) {
    throw new Error(
      "[api-tokens] TOKEN_HASH_PEPPER is required for PAT hashing — refusing to mint or verify with an unpeppered hash",
    );
  }
  return pepper;
}

/**
 * Generate a fresh API token.
 *
 * Returns the plaintext (to show to the user once), the HMAC-SHA256 hex
 * hash (to store in the DB), and the display prefix (for the UI list). The
 * plaintext is the only sensitive value — callers MUST NOT persist it
 * anywhere. The `pepper` MUST come from server-controlled env (never a
 * request-controlled value).
 */
export async function generateApiToken(pepper: string): Promise<{
  plaintext: string;
  hash: string;
  prefix: string;
}> {
  const random = new Uint8Array(TOKEN_RANDOM_BYTES);
  crypto.getRandomValues(random);
  const plaintext = TOKEN_PREFIX + bytesToBase64Url(random);
  const hash = await hashToken(plaintext, pepper);
  const prefix = plaintext.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH);
  return { plaintext, hash, prefix };
}

/**
 * Compute the HMAC-SHA256 hex digest of a plaintext token, keyed by the
 * server-side `pepper`. Deterministic so the same plaintext always produces
 * the same lookup key, and one-way so a DB leak does not expose live tokens.
 *
 * Why HMAC-SHA256 rather than plain SHA-256:
 *  - A plain hash is publicly computable — an attacker who steals the DB
 *    can verify any guessed plaintext offline against the stored row.
 *  - HMAC-SHA256 keyed by a server-only secret makes the stored hash
 *    useless without the pepper. Offline verification requires both the
 *    database AND the server secret.
 *
 * Why not bcrypt/argon2:
 *  - PAT plaintext is 192 bits of CSPRNG output, not a low-entropy
 *    password. The threat is DB exfil, not online guessing. Slow KDFs
 *    optimise for the wrong threat model.
 *  - Cloudflare Workers' free tier enforces a 10 ms CPU budget per
 *    invocation. Bcrypt cost factors high enough to be useful exceed
 *    that budget; HMAC-SHA256 completes in microseconds.
 */
export async function hashToken(plaintext: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(plaintext));
  return bufferToHex(signature);
}

/**
 * Mint a fresh ID for the `api_token.id` column.
 *
 * The codebase does not currently include a ULID library, so we use
 * `crypto.randomUUID()` to stay consistent with every other id column
 * (workspace, project, task, notification, etc.). If a ULID library is
 * adopted later, this helper is the single switch-point.
 */
export function newApiTokenId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify an inbound plaintext token.
 *
 * Returns `null` on every failure mode (no DB row, revoked, expired, lost
 * workspace membership, garbage prefix). Callers MUST treat null as
 * "respond 401" and never leak which condition failed — that information
 * would help an attacker enumerate valid tokens.
 *
 * The single LEFT JOIN folds the three lookups (token row, owning user,
 * current workspace membership) into one D1 round-trip. The membership join
 * is the critical re-check that prevents a token from outliving its user's
 * workspace access: even if the token row is otherwise healthy, removing
 * the user from the workspace immediately disables the token without
 * requiring a sweep job.
 */
export async function verifyToken(
  db: Database,
  plaintext: string,
  pepper: string,
): Promise<VerifyResult | null> {
  // Cheap reject: garbage Authorization headers must not cost us a hash.
  if (typeof plaintext !== "string" || !plaintext.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const hash = await hashToken(plaintext, pepper);

  const [row] = await db
    .select({
      token: apiToken,
      user: user,
      membership: workspaceMember,
    })
    .from(apiToken)
    .innerJoin(user, eq(user.id, apiToken.userId))
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.workspaceId, apiToken.workspaceId),
        eq(workspaceMember.userId, apiToken.userId),
      ),
    )
    .where(eq(apiToken.tokenHash, hash))
    .limit(1);

  if (!row) return null;

  // Revoked tokens are tombstones — must never authenticate.
  if (row.token.revokedAt !== null) return null;

  // Past-expiry tokens are dead even if revokedAt is still null. We compare
  // by epoch ms so a freshly-set expiresAt in the past correctly fails.
  if (
    row.token.expiresAt !== null &&
    row.token.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }

  // The user lost their workspace seat between mint time and now.
  if (!row.membership) return null;

  return {
    token: row.token,
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      emailVerified: row.user.emailVerified,
      image: row.user.image,
      createdAt: row.user.createdAt,
      updatedAt: row.user.updatedAt,
    },
    workspaceMembership: {
      id: row.membership.id,
      workspaceId: row.membership.workspaceId,
      role: row.membership.role,
    },
  };
}

// ---------------------------------------------------------------------------
// Scope / project authorization
// ---------------------------------------------------------------------------

/**
 * Parse the JSON-encoded scopes column into a string array.
 *
 * On any parse error (corrupt row, half-written migration, manual SQL
 * mutation) we return an empty array rather than throwing. The downstream
 * effect is "no scopes" which is a fail-closed default — the token will
 * simply 403 on every scope-guarded endpoint, which is exactly what we want
 * if the row is unreadable.
 */
export function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

/**
 * Parse the JSON-encoded `projectIds` column. Treats null/empty as no
 * projects (used by `canAccessProject` to fail-closed when the column is
 * misconfigured for a `selected` token).
 */
export function parseProjectIds(projectIdsJson: string | null): string[] {
  if (projectIdsJson === null || projectIdsJson === "") return [];
  try {
    const parsed = JSON.parse(projectIdsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

/**
 * Does this token carry the requested scope?
 *
 * Direct grants match exactly (`task:write` matches `task:write`). Aggregate
 * grants follow GitHub's convention: `read:*` covers any `<resource>:read`,
 * `write:*` covers any `<resource>:write`. `project:delete` is deliberately
 * NOT granted by `write:*` — deletion is a heightened action that must be
 * granted explicitly so an over-broad `write:*` token cannot wipe data.
 *
 * Scope strings outside the resource:action grammar (e.g. plain `admin`)
 * fall through to the direct-match check, which keeps the function forward
 * compatible with future scope shapes.
 */
export function hasScope(token: ApiToken, required: string): boolean {
  const scopes = parseScopes(token.scopes);
  if (scopes.includes(required)) return true;

  const colonIndex = required.indexOf(":");
  if (colonIndex === -1) return false;

  const action = required.slice(colonIndex + 1);
  // `delete` is intentionally excluded from `write:*` — see jsdoc.
  if (action === "read" && scopes.includes("read:*")) return true;
  if (action === "write" && scopes.includes("write:*")) return true;

  return false;
}

/**
 * Does this token grant access to the given project?
 *
 * `projectScope === "all"` is the convenience grant — the token can touch
 * any project in its workspace (subject to scope checks). `selected` narrows
 * access to the explicit JSON-encoded id list; missing/corrupt list means
 * no access (fail-closed). Anything else is treated as no access so a
 * row written by a future schema with an unknown scope mode cannot
 * accidentally over-grant.
 */
export function canAccessProject(
  token: ApiToken,
  projectId: string,
): boolean {
  if (token.projectScope === "all") return true;
  if (token.projectScope === "selected") {
    return parseProjectIds(token.projectIds).includes(projectId);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Telemetry: lastUsedAt bump
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget update of `lastUsedAt` for an authenticated token.
 *
 * Runs via `deferWork` so the response is not blocked. Errors are caught
 * and logged — a failed bump is non-fatal (the worst case is a stale
 * "Never used" indicator in the UI), and we never want a flaky write to
 * derail an otherwise successful API call.
 */
export function bumpLastUsedAt(
  c: Context<AppEnv>,
  tokenId: string,
): void {
  deferWork(c, async () => {
    try {
      const db = c.get("db");
      await db
        .update(apiToken)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiToken.id, tokenId));
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          lib: "api-tokens",
          op: "bumpLastUsedAt",
          tokenId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });
}
