/**
 * Handlers for the Personal Access Token (PAT) management endpoints.
 *
 * ## Why this surface is sensitive
 *
 * Every endpoint here mutates or exposes long-lived bearer credentials. Two
 * non-negotiable invariants are enforced at the top of every handler:
 *
 *  1. **PATs cannot manage other PATs.** A compromised token must not be able
 *     to mint, rotate, list, or revoke siblings — otherwise a single leak
 *     becomes a persistent foothold. The guard returns 403 before any logic.
 *  2. **Plaintext is returned exactly once.** `create` and `rotate` are the
 *     only paths that include `plaintext` in the response. List/get/detail
 *     never include `tokenHash` or plaintext.
 *
 * Ownership semantics mirror the GitHub PAT model: tokens are user-owned
 * inside a workspace. Workspace admins / owners can list and revoke any
 * member's token for incident response; a member sees and can revoke only
 * their own.
 *
 * Issuance is a second, narrower axis, enforced by `tokenIssuanceMiddleware`
 * in [api-tokens.routes.ts](./api-tokens.routes.ts): minting and rotating
 * both require the `owner` or `admin` role, so a plain member can never
 * bring a new credential into existence. Rotation stacks the owner-only
 * check below on top of that — an admin rotating someone else's token would
 * be handed their plaintext.
 *
 * Status derivation (active / rotating / expired / revoked) lives in this
 * file because it is purely a presentation concern over the timestamp
 * columns. Centralising it here keeps the UI and any future integrations
 * consistent without re-deriving the rules in multiple places.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";

import {
  type ApiToken,
  apiToken,
  type NewApiToken,
  project,
  user as schemaUser,
  workspace,
} from "../../../db/schema";
import type { AppEnv } from "../../env";
import {
  generateApiToken,
  KNOWN_SCOPES,
  newApiTokenId,
  parseProjectIds,
  parseScopes,
  requireTokenHashPepper,
} from "../../lib/api-tokens";
import { deferWork } from "../../lib/defer";
import { createEmailService } from "../../lib/email";
// From the leaf module, not the `./email` barrel: this file's tests replace the
// barrel wholesale with a `createEmailService`-only stub, so pulling the sender
// resolver through it would yield `undefined` under test.
import { resolveEmailFrom } from "../../lib/email/from";
import { apiTokenCreatedEmail } from "../../lib/email/templates/api-token-created";
import { apiTokenRevokedEmail } from "../../lib/email/templates/api-token-revoked";
import { apiTokenRotatedEmail } from "../../lib/email/templates/api-token-rotated";
import { errorResponse, throwWithContext } from "../../lib/error-response";
import { requireParam, requireParams } from "../../lib/params";
import { validJson, validQuery } from "../../lib/validated";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default expiry applied when the request omits `expiresInDays`.
 *
 * The plan calls for a security-conservative default rather than the
 * "never expires" option that GitHub-style products offer. 365 days
 * matches the documented cap in [docs/api/api-tokens.md] (Batch 2 P4) and
 * gives integrations a one-year rotation window before the token disappears
 * on its own.
 */
export const DEFAULT_EXPIRES_IN_DAYS = 365;

/**
 * Hard cap on `expiresInDays` — 10 years. Above this we reject the request
 * outright; the validation layer surfaces the limit so the UI can mirror it
 * without depending on backend assumptions.
 */
export const MAX_EXPIRES_IN_DAYS = 3650;

/**
 * Maximum project IDs a single token may target. 50 is generous for real-
 * world fine-grained integrations and small enough that the JSON array column
 * stays cheap to parse on the hot path.
 */
export const MAX_PROJECT_IDS = 50;

/**
 * Rotation grace window. When `rotate` is invoked the old token survives for
 * this long so live integrations can swap to the new plaintext without an
 * outage; after `revokeAt` the scheduled-handler sweep finalises revocation.
 */
export const ROTATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * Body schema for `POST /workspaces/:workspaceId/api-tokens`.
 *
 * Field-level rules:
 *  - `name`: required, 1–100 chars; surfaced in the audit email and UI.
 *  - `scopes`: required, non-empty. Each entry must be in `KNOWN_SCOPES`;
 *    membership is enforced at the handler level (not zod) so the 400 error
 *    can name the offending scope precisely.
 *  - `projectScope`: required enum; "all" ignores `projectIds`, "selected"
 *    requires a non-empty list and triggers a workspace membership check on
 *    each id.
 *  - `expiresInDays`: optional integer 1–MAX_EXPIRES_IN_DAYS; defaults to
 *    DEFAULT_EXPIRES_IN_DAYS. We don't allow `null` here — the plan's
 *    open-question default explicitly disallows infinite tokens.
 */
export const createApiTokenSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  scopes: z.array(z.string().min(1)).min(1, "At least one scope is required"),
  projectScope: z.enum(["all", "selected"]),
  projectIds: z.array(z.string().min(1)).max(MAX_PROJECT_IDS).optional(),
  expiresInDays: z
    .number()
    .int()
    .min(1, "expiresInDays must be at least 1")
    .max(MAX_EXPIRES_IN_DAYS, `expiresInDays must be at most ${MAX_EXPIRES_IN_DAYS}`)
    .optional(),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

/**
 * Query schema for `GET /workspaces/:workspaceId/api-tokens`.
 *
 * `includeRevoked` controls whether soft-revoked rows appear in the list.
 * Default behaviour is **hide revoked** — the workspace settings UI showed
 * revoked rows indefinitely (we never hard-delete so historical audit
 * attribution survives), which made the list grow unboundedly over time.
 * Callers that need the audit view (admin incident response, deliberate
 * "show revoked" toggle) opt in with `?includeRevoked=true`.
 *
 * Why a string enum rather than `z.coerce.boolean()`: `coerce.boolean()`
 * accepts ANY non-empty string as `true` (including the literal string
 * `"false"`), which is a footgun on URL query params. The enum forces a
 * canonical wire format and matches the `completed` filter pattern already
 * established in [tasks.routes.ts](./tasks.routes.ts) — keeping query-param
 * conventions consistent across the API.
 */
export const listApiTokensQuerySchema = z.object({
  includeRevoked: z.enum(["true", "false"]).optional(),
});

export type ListApiTokensQuery = z.infer<typeof listApiTokensQuerySchema>;

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

/**
 * Derived lifecycle status for a token row.
 *
 * Precedence (most-final state first):
 *  - `revokedAt != null` → "revoked"
 *  - past `expiresAt` → "expired"
 *  - `rotatedToId != null` → "rotating" (sibling exists; old token is in the
 *    7-day grace window before `processScheduledTokenRevocations` sweeps it)
 *  - else → "active"
 *
 * Surfaced in list/detail responses so the UI never has to re-implement the
 * rules. Keeping this single-sourced here matches CLAUDE.md Rule 4 (one
 * source of truth — no adapters).
 */
export type ApiTokenStatus = "active" | "rotating" | "expired" | "revoked";

function deriveStatus(token: ApiToken, now = Date.now()): ApiTokenStatus {
  if (token.revokedAt !== null) return "revoked";
  if (token.expiresAt !== null && token.expiresAt.getTime() < now) {
    return "expired";
  }
  if (token.rotatedToId !== null) return "rotating";
  return "active";
}

/**
 * Public representation of an api_token row — strips `tokenHash` (never
 * leaves the DB layer) and parses the JSON columns so the API client does
 * not have to. The plaintext field is added separately by mint/rotate
 * handlers; it is never present on list/detail responses.
 */
export type ApiTokenView = {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  projectScope: string;
  projectIds: string[] | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokeAt: Date | null;
  revokedAt: Date | null;
  rotatedToId: string | null;
  createdAt: Date;
  status: ApiTokenStatus;
};

function toView(token: ApiToken, now = Date.now()): ApiTokenView {
  return {
    id: token.id,
    userId: token.userId,
    workspaceId: token.workspaceId,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: parseScopes(token.scopes),
    projectScope: token.projectScope,
    projectIds:
      token.projectScope === "selected" ? parseProjectIds(token.projectIds) : null,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    revokeAt: token.revokeAt,
    revokedAt: token.revokedAt,
    rotatedToId: token.rotatedToId,
    createdAt: token.createdAt,
    status: deriveStatus(token, now),
  };
}

// ---------------------------------------------------------------------------
// Shared guards / helpers
// ---------------------------------------------------------------------------

/**
 * Block PAT-authenticated callers from every endpoint in this file is now
 * enforced by the `rejectPatAuth()` middleware mounted in
 * `api-tokens.routes.ts`. Handlers do NOT need to re-check; if a request
 * reaches a handler here it is cookie-authenticated by construction.
 *
 * Resolve the calling user's role inside the workspace. The workspaceMember
 * resolver in `requireWorkspaceMember` caches this on the context so we
 * read it without another DB round-trip when possible.
 */
function isWorkspaceAdmin(c: Context<AppEnv>): boolean {
  const membership = c.get("workspaceMembership");
  if (!membership) return false;
  return membership.role === "owner" || membership.role === "admin";
}

// ---------------------------------------------------------------------------
// listApiTokens
// ---------------------------------------------------------------------------

/**
 * GET /workspaces/:workspaceId/api-tokens
 *
 * Members see their own tokens; admins additionally see siblings owned by
 * other members for incident-response use cases (revocation is admin-
 * privileged on someone else's token, see `revokeApiToken`).
 *
 * Revoked tokens are **hidden by default** — they are kept in the database
 * indefinitely (no purge job) so historical activity attribution survives,
 * but surfacing them on every list call clutters the UI and leaks workspace
 * history to every member. Callers that need them (the workspace settings
 * "Show revoked" toggle, audit tooling) opt in with `?includeRevoked=true`.
 *
 * `tokenHash` is never returned. `plaintext` is unavailable here by design —
 * the database does not store it. The response is the parsed `ApiTokenView`
 * so the UI never has to re-derive `status` or re-parse the JSON columns.
 */
export async function listApiTokens(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");
  // Query may be absent when the handler is exercised through a bare
  // `app.get(...)` test mount (no validateQuery middleware). The OpenAPI
  // route always pre-validates in production. Defaulting to an empty object
  // means the same handler works in both contexts without test-only branches.
  const query: ListApiTokensQuery =
    (validQuery(c, listApiTokensQuerySchema) as ListApiTokensQuery | undefined) ?? {};
  const includeRevoked = query.includeRevoked === "true";

  const baseWhere = eq(apiToken.workspaceId, workspaceId);
  const ownershipWhere = isWorkspaceAdmin(c)
    ? baseWhere
    : and(baseWhere, eq(apiToken.userId, user.id));
  // `isNull(revokedAt)` is the soft-delete filter — keep the predicate at the
  // DB level so a workspace with thousands of historical revoked tokens
  // doesn't ship every row over the wire only to have the UI hide them.
  const where = includeRevoked
    ? ownershipWhere
    : and(ownershipWhere, isNull(apiToken.revokedAt));

  const rows = await db.select().from(apiToken).where(where);
  const now = Date.now();
  return c.json({ tokens: rows.map((row) => toView(row, now)) });
}

// ---------------------------------------------------------------------------
// getApiToken
// ---------------------------------------------------------------------------

/**
 * GET /workspaces/:workspaceId/api-tokens/:tokenId
 *
 * Owner sees their token; workspace admins see any token. Non-owners get a
 * uniform 404 so the response shape never reveals whether a token id exists
 * for someone else (`404 ≠ 403` would let an admin-impersonator probe).
 */
export async function getApiToken(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { workspaceId, tokenId } = requireParams(c, "workspaceId", "tokenId");

  const [row] = await db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.workspaceId, workspaceId)))
    .limit(1);

  if (!row) return errorResponse(c, "API token not found", 404);

  if (row.userId !== user.id && !isWorkspaceAdmin(c)) {
    return errorResponse(c, "API token not found", 404);
  }

  return c.json({ token: toView(row) });
}

// ---------------------------------------------------------------------------
// createApiToken
// ---------------------------------------------------------------------------

/**
 * POST /workspaces/:workspaceId/api-tokens
 *
 * Mints a token, stores only the SHA-256 hash, and returns the plaintext
 * exactly once in the response body. After this response the plaintext is
 * unrecoverable — that is the entire security model.
 *
 * Scope validation rejects unknown scopes and duplicates with a 400 that
 * names the offending entry. Project-scope validation runs as a single
 * `WHERE workspaceId = ? AND id IN (...)` query so we don't pay per-id round
 * trips, and we reject if any id is missing rather than silently dropping.
 *
 * A non-blocking creation email is dispatched via `deferWork` so a flaky
 * email provider can never delay the API response. Email failures are
 * logged but never propagated — the security signal is best-effort.
 */
export async function createApiToken(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createApiTokenSchema);

  // Reject unknown scopes — name the offender so integrators have a clear
  // signal of which scope is misspelled.
  for (const scope of body.scopes) {
    if (!KNOWN_SCOPES.has(scope)) {
      return errorResponse(c, `Unknown scope: ${scope}`, 400);
    }
  }

  // Reject duplicate scopes — the JSON array column should be a set; a
  // duplicate is almost always a client bug worth surfacing rather than
  // silently de-duplicating.
  const uniqueScopes = new Set(body.scopes);
  if (uniqueScopes.size !== body.scopes.length) {
    return errorResponse(c, "Duplicate scopes are not allowed", 400);
  }

  // Resolve project scope.
  let projectIdsJson: string | null = null;
  if (body.projectScope === "selected") {
    const requested = body.projectIds ?? [];
    if (requested.length === 0) {
      return errorResponse(
        c,
        "projectIds is required when projectScope is 'selected'",
        400,
      );
    }

    const uniqueIds = Array.from(new Set(requested));
    const existing = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(eq(project.workspaceId, workspaceId), inArray(project.id, uniqueIds)),
      );

    const existingIds = new Set(existing.map((p) => p.id));
    const missing = uniqueIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      return errorResponse(
        c,
        `Project ids not found in workspace: ${missing.join(", ")}`,
        400,
      );
    }

    projectIdsJson = JSON.stringify(uniqueIds);
  }

  // Mint + hash. The pepper is required (env validation throws if missing)
  // so a misconfigured deployment fails closed rather than silently storing
  // unpeppered hashes.
  const pepper = requireTokenHashPepper(c.env.TOKEN_HASH_PEPPER);
  const { plaintext, hash, prefix } = await generateApiToken(pepper);
  const id = newApiTokenId();
  const now = new Date();
  const expiresInDays = body.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

  const newRow: NewApiToken = {
    id,
    userId: user.id,
    workspaceId,
    name: body.name,
    tokenHash: hash,
    tokenPrefix: prefix,
    scopes: JSON.stringify(body.scopes),
    projectScope: body.projectScope,
    projectIds: projectIdsJson,
    lastUsedAt: null,
    expiresAt,
    revokeAt: null,
    revokedAt: null,
    rotatedToId: null,
    createdAt: now,
  };

  let created: ApiToken | undefined;
  try {
    [created] = await db.insert(apiToken).values(newRow).returning();
  } catch (error) {
    throwWithContext(error, "createApiToken");
  }
  if (!created) {
    throw new Error("[createApiToken] insert returned no row");
  }

  // Resolve workspace name for the audit email. A missing workspace row at
  // this point is a programming error — `requireWorkspaceMember` already
  // validated membership — but we still guard against null so the email
  // body never says "undefined".
  const [ws] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const workspaceName = ws?.name ?? "your workspace";

  // Fire-and-forget security notification.
  scheduleCreationEmail(c, {
    recipientEmail: user.email,
    recipientName: user.name,
    tokenName: created.name,
    workspaceName,
    scopes: parseScopes(created.scopes),
    createdAt: created.createdAt,
  });

  return c.json({ token: { ...toView(created), plaintext } }, 201);
}

/**
 * Build and ship the creation-notification email without blocking the
 * response. Wired through `deferWork` so a slow/dead SMTP path cannot delay
 * the API. Any failure is logged but never thrown — the email is a security
 * audit signal, not a hard requirement of the request.
 *
 * If `RESEND_API_KEY` is unset (the default for self-hosted / open-source
 * installations without an email provider), `createEmailService` returns
 * the `ConsoleEmailService` which logs the email to stdout. That keeps
 * the signal visible in logs without making Resend a hard dependency.
 */
function scheduleCreationEmail(
  c: Context<AppEnv>,
  args: {
    recipientEmail: string;
    recipientName: string;
    tokenName: string;
    workspaceName: string;
    scopes: string[];
    createdAt: Date;
  },
) {
  deferWork(c, async () => {
    try {
      const env = c.env;
      const emailService = createEmailService({
        RESEND_API_KEY: env.RESEND_API_KEY,
        EMAIL_FROM: env.EMAIL_FROM,
      });
      const baseUrl = env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
      const settingsUrl = `${baseUrl}/settings/api-tokens`;
      const { subject, html, text } = apiTokenCreatedEmail({
        recipientName: args.recipientName,
        tokenName: args.tokenName,
        workspaceName: args.workspaceName,
        scopes: args.scopes,
        createdAt: args.createdAt,
        settingsUrl,
      });
      await emailService.send({
        to: args.recipientEmail,
        from: resolveEmailFrom(env),
        subject,
        html,
        text,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          handler: "createApiToken",
          op: "sendCreationEmail",
          email: args.recipientEmail,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

/**
 * Out-of-band security notification when a token is rotated.
 *
 * Why rotation needs its own email: rotation mints a brand-new plaintext
 * credential. If a session is compromised, an attacker's first move is to
 * mint or rotate a token so they retain access after the cookie is
 * invalidated. The owner must hear about every new plaintext via a
 * channel they control.
 *
 * Identical degradation semantics to `scheduleCreationEmail` — no Resend
 * key falls back to the console transport so open-source deployments are
 * not forced to integrate with a paid provider.
 */
function scheduleRotationEmail(
  c: Context<AppEnv>,
  args: {
    recipientEmail: string;
    recipientName: string;
    tokenName: string;
    workspaceName: string;
    rotatedAt: Date;
    oldTokenPrefix: string;
    revokeAt: Date;
  },
) {
  deferWork(c, async () => {
    try {
      const env = c.env;
      const emailService = createEmailService({
        RESEND_API_KEY: env.RESEND_API_KEY,
        EMAIL_FROM: env.EMAIL_FROM,
      });
      const baseUrl = env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
      const settingsUrl = `${baseUrl}/settings/api-tokens`;
      const { subject, html, text } = apiTokenRotatedEmail({
        recipientName: args.recipientName,
        tokenName: args.tokenName,
        workspaceName: args.workspaceName,
        rotatedAt: args.rotatedAt,
        oldTokenPrefix: args.oldTokenPrefix,
        revokeAt: args.revokeAt,
        settingsUrl,
      });
      await emailService.send({
        to: args.recipientEmail,
        from: resolveEmailFrom(env),
        subject,
        html,
        text,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          handler: "rotateApiToken",
          op: "sendRotationEmail",
          email: args.recipientEmail,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

/**
 * Out-of-band security notification when a token is revoked.
 *
 * Always emailed to the token OWNER, even when the revocation is initiated
 * by an admin during incident response. The owner must know their
 * integration's secret has been killed so they can investigate (was their
 * laptop compromised? do they need to rotate the user's password?). We
 * omit the admin's identity from the email to keep the channel free of
 * social escalation surface — the actor is recorded in the audit ledger.
 *
 * Same fallback as the other security emails: no Resend key → console
 * transport. The signal is preserved even in bare deployments.
 */
function scheduleRevocationEmail(
  c: Context<AppEnv>,
  args: {
    recipientEmail: string;
    recipientName: string;
    tokenName: string;
    workspaceName: string;
    revokedAt: Date;
    revokedByAdmin: boolean;
  },
) {
  deferWork(c, async () => {
    try {
      const env = c.env;
      const emailService = createEmailService({
        RESEND_API_KEY: env.RESEND_API_KEY,
        EMAIL_FROM: env.EMAIL_FROM,
      });
      const baseUrl = env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
      const settingsUrl = `${baseUrl}/settings/api-tokens`;
      const { subject, html, text } = apiTokenRevokedEmail({
        recipientName: args.recipientName,
        tokenName: args.tokenName,
        workspaceName: args.workspaceName,
        revokedAt: args.revokedAt,
        revokedByAdmin: args.revokedByAdmin,
        settingsUrl,
      });
      await emailService.send({
        to: args.recipientEmail,
        from: resolveEmailFrom(env),
        subject,
        html,
        text,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          handler: "revokeApiToken",
          op: "sendRevocationEmail",
          email: args.recipientEmail,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// rotateApiToken
// ---------------------------------------------------------------------------

/**
 * POST /workspaces/:workspaceId/api-tokens/:tokenId/rotate
 *
 * Mints a sibling that inherits the original's scopes, project scope, and
 * absolute `expiresAt`. The old token is marked `rotatedToId = newId` and
 * scheduled for revocation `ROTATION_GRACE_MS` from now so live
 * integrations have a window to swap secrets. The scheduled-handler sweep
 * (`processScheduledTokenRevocations`) makes that revocation final.
 *
 * Owner-only — admins can revoke other people's tokens but should not be
 * able to silently mint sibling credentials in someone else's name. We
 * also reject if the token is already revoked or already rotating to keep
 * the lifecycle linear and avoid chains of rotations all redirecting to the
 * same successor.
 */
export async function rotateApiToken(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { workspaceId, tokenId } = requireParams(c, "workspaceId", "tokenId");

  const [old] = await db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.workspaceId, workspaceId)))
    .limit(1);

  if (!old) return errorResponse(c, "API token not found", 404);
  if (old.userId !== user.id) {
    return errorResponse(c, "Only the token owner can rotate it", 403);
  }
  if (old.revokedAt !== null) {
    return errorResponse(c, "Cannot rotate a revoked token", 409);
  }
  if (old.rotatedToId !== null) {
    return errorResponse(c, "Token has already been rotated", 409);
  }

  const pepper = requireTokenHashPepper(c.env.TOKEN_HASH_PEPPER);
  const { plaintext, hash, prefix } = await generateApiToken(pepper);
  const newId = newApiTokenId();
  const now = new Date();
  const revokeAt = new Date(now.getTime() + ROTATION_GRACE_MS);

  const newRow: NewApiToken = {
    id: newId,
    userId: old.userId,
    workspaceId: old.workspaceId,
    name: `${old.name} (rotated)`,
    tokenHash: hash,
    tokenPrefix: prefix,
    scopes: old.scopes,
    projectScope: old.projectScope,
    projectIds: old.projectIds,
    lastUsedAt: null,
    expiresAt: old.expiresAt,
    revokeAt: null,
    revokedAt: null,
    rotatedToId: null,
    createdAt: now,
  };

  // Drizzle's D1 batch returns each statement's result positionally. We need
  // the inserted new row to compose the response; the update return is
  // discarded because we already hold `old`.
  let createdRows: ApiToken[];
  let updatedRows: ApiToken[];
  try {
    [createdRows, updatedRows] = await db.batch([
      db.insert(apiToken).values(newRow).returning(),
      db
        .update(apiToken)
        .set({ rotatedToId: newId, revokeAt })
        .where(eq(apiToken.id, old.id))
        .returning(),
    ] as const);
  } catch (error) {
    throwWithContext(error, "rotateApiToken");
  }

  const created = createdRows[0];
  if (!created) {
    throw new Error("[rotateApiToken] insert returned no row");
  }
  // Touch updatedRows so the variable is observed even though we don't
  // surface the updated row in the response. Without this the lint rule for
  // unused-variables would flag, and silencing it would violate Rule 12.
  void updatedRows;

  // Resolve workspace name for the audit email. Same guard as
  // createApiToken — `requireWorkspaceMember` already verified the
  // workspace exists, but we still null-coalesce so the email body never
  // reads "undefined".
  const [ws] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const workspaceName = ws?.name ?? "your workspace";

  // Fire-and-forget security notification. Rotation produces a new
  // plaintext credential, which is a security-equivalent event to mint —
  // the owner must be told so they can recognise an unexpected rotation.
  scheduleRotationEmail(c, {
    recipientEmail: user.email,
    recipientName: user.name,
    tokenName: created.name,
    workspaceName,
    rotatedAt: created.createdAt,
    oldTokenPrefix: old.tokenPrefix,
    revokeAt,
  });

  return c.json({ token: { ...toView(created), plaintext } }, 201);
}

// ---------------------------------------------------------------------------
// revokeApiToken
// ---------------------------------------------------------------------------

/**
 * DELETE /workspaces/:workspaceId/api-tokens/:tokenId
 *
 * Soft-revoke: sets `revokedAt = now` without deleting the row so historical
 * activity attribution (`activity.apiTokenId` FK) survives. Owner or any
 * workspace admin / owner can revoke — admins for emergency response, owner
 * for routine lifecycle management.
 *
 * Idempotent on already-revoked tokens: we return 200 with `ok: true` rather
 * than 404 so a script that loops over a known id list does not crash on
 * concurrent revocations.
 */
export async function revokeApiToken(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const { workspaceId, tokenId } = requireParams(c, "workspaceId", "tokenId");

  const [row] = await db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.workspaceId, workspaceId)))
    .limit(1);

  if (!row) return errorResponse(c, "API token not found", 404);
  if (row.userId !== user.id && !isWorkspaceAdmin(c)) {
    return errorResponse(c, "API token not found", 404);
  }

  if (row.revokedAt !== null) {
    return c.json({ ok: true, alreadyRevoked: true });
  }

  const now = new Date();
  await db
    .update(apiToken)
    .set({ revokedAt: now })
    .where(eq(apiToken.id, tokenId));

  // Resolve workspace + actor email so we can notify the OWNER (which may
  // not be the same as the caller — admins can revoke a member's token
  // during incident response, and the owner must hear about that
  // immediately even if they did not initiate it).
  const [ws] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const workspaceName = ws?.name ?? "your workspace";

  // Look up the owner if it isn't the caller — admins can revoke another
  // member's token. We do not leak the admin's identity to the owner
  // beyond a generic "by an administrator" phrase to avoid creating a
  // human-on-human conflict surface; the audit log records the actor.
  let ownerEmail = user.email;
  let ownerName = user.name;
  let revokedByAdmin = false;
  if (row.userId !== user.id) {
    revokedByAdmin = true;
    const [owner] = await db
      .select({ email: schemaUser.email, name: schemaUser.name })
      .from(schemaUser)
      .where(eq(schemaUser.id, row.userId))
      .limit(1);
    if (owner) {
      ownerEmail = owner.email;
      ownerName = owner.name;
    }
  }

  scheduleRevocationEmail(c, {
    recipientEmail: ownerEmail,
    recipientName: ownerName,
    tokenName: row.name,
    workspaceName,
    revokedAt: now,
    revokedByAdmin,
  });

  return c.json({ ok: true });
}
