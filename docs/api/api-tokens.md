# API Tokens

## Overview

Personal Access Tokens (PATs) let trusted machine clients — Slackbots, GitHub Actions, custom internal tools, AI agents — call Cadence's `/api/*` endpoints without impersonating a real user via a session cookie. Each token is bound to one user and one workspace, carries an explicit set of scopes, and can be optionally restricted to a subset of projects.

PATs exist because cookie-based session auth is the wrong fit for unattended, long-running automation:

- **Sessions are short-lived and CSRF-sensitive.** They are designed for a browser carrying ambient credentials, not for a server that needs a stable secret it can store and reuse.
- **Sessions cannot be scoped.** A stolen session cookie has every permission the user has. PATs can be narrowed to read-only, to a single project, or to a single resource family.
- **Sessions cannot be revoked granularly.** Killing one Slackbot integration should not log every browser tab out. PAT revocation is per-token and instant.

Cadence uses **opaque** PATs (random strings looked up in the database) rather than self-signed JWTs. Opaque tokens give instant revocation, allow scope changes without reissuing the secret, and produce a centralized audit trail. JWT-style tokens require a denylist to support revocation, which is just an opaque-token lookup with extra cryptographic steps.

The stored hash is **HMAC-SHA256 keyed by a server-side pepper** (`TOKEN_HASH_PEPPER`, configured in env). Plain SHA-256 would let an attacker who exfiltrates the database verify guessed plaintexts offline; HMAC-keyed hashing makes the stored row useless without the server secret, so offline verification requires both the database AND the pepper. We do **not** use bcrypt/argon2 — the threat model is DB exfiltration, not online guessing against a low-entropy password, and Workers' free-tier 10 ms CPU budget per invocation cannot accommodate a useful KDF cost factor anyway. Rotating the pepper invalidates every minted token (treat it as a forced re-mint event for every integration).

PATs are intended for **machine clients only**. Inside a browser context, continue to use cookie auth — it's safer there (HttpOnly cookies are not readable by JS, PATs in localStorage are).

See also: [integrations.md](./integrations.md), [webhooks.md](./webhooks.md), [middleware.md](./middleware.md).

---

## Token Format

Tokens are issued in the form:

```
cdn_pat_<32 base64url characters>
```

| Component | Purpose |
| --- | --- |
| `cdn_pat_` prefix | Identifies the secret as a Cadence PAT. Allows cheap pre-hash rejection of malformed strings and enables secret-scanning tools (GitHub, Gitleaks, etc.) to detect leaks. |
| 32-char body | 32 base64url characters of CSPRNG output (`crypto.getRandomValues`). Effective entropy is ~192 bits, well above any brute-force concern. |
| `tokenPrefix` (UI only) | The first 12 characters of the plaintext (e.g. `cdn_pat_a4kZ`). Stored alongside the hash and shown in the UI so users can identify a token without seeing the secret. |
| `tokenHash` (DB) | `HMAC-SHA256(TOKEN_HASH_PEPPER, plaintext)` stored as hex. The plaintext is **never** persisted, and the pepper lives only in the server's env binding, so a database exfil yields neither plaintext nor a verifiable-offline hash. |

The plaintext is shown to the user exactly once — at creation — and never again. If they lose it, they rotate or revoke and mint a new one.

---

## Minting a Token

1. Navigate to **Settings → API Tokens**.
2. Click **New Token**.
3. Fill in:
   - **Name** — a human label (e.g. "Slackbot prod", "GitHub Actions CI"). Helps you identify the token later in the list and in activity attribution.
   - **Scopes** — checkboxes grouped by resource. See [Scopes Reference](#scopes-reference) below.
   - **Project Scope** — "All projects" or "Selected projects" (up to 50).
   - **Expiry** — 30 days, 90 days, 1 year, or a custom value up to 10 years. Defaults to 1 year. There is no "never" option (see [Expiry](#expiry)).
4. Submit. The plaintext token is displayed on the next screen with a prominent copy button.

> **You will not see this token again.** Cadence stores only the hash. If you close the reveal panel without copying, you must rotate the token to get a new plaintext.

---

## Scopes Reference

Every endpoint requires one or more scopes when called with a PAT. Scopes are AND-ed with the user's actual role (see [Effective Permissions](#effective-permissions)).

| Scope | Grants |
| --- | --- |
| `workspace:read` | Read workspace metadata, list members |
| `workspace:write` | Update workspace settings |
| `project:read` | List and read projects |
| `project:write` | Create and update projects |
| `project:delete` | Delete projects |
| `task:read` | List and read tasks |
| `task:write` | Create and update tasks |
| `task:delete` | Delete tasks |
| `label:read` | List labels |
| `label:write` | Create, update, and delete labels |
| `attachment:read` | Download attachments |
| `attachment:write` | Upload and delete attachments |
| `team:read` | List teams |
| `team:write` | Create and update teams |
| `invitation:write` | Invite members |
| `webhook:read` | List webhooks |
| `webhook:write` | Manage webhooks |
| `read:*` | Aggregate — grants every `*:read` scope. **Does not include any `*:delete` scope.** |
| `write:*` | Aggregate — grants every `*:read` and `*:write` scope. **Does not include any `*:delete` scope.** |

**Delete scopes are never granted by aggregates.** If a token needs to delete projects, tasks, or attachments, the relevant `*:delete` scope must be ticked individually. This is deliberate — destructive operations should never be granted by a wildcard.

Unknown scopes encountered on read are preserved for forward compatibility but ignored during authorization checks. The set of known scopes is validated at write time.

---

## Project Scoping

Each token has a project scope, modeled on GitHub fine-grained PATs:

| Mode | Behavior |
| --- | --- |
| **All projects** | The token can access any project in the workspace that the owning user can access. |
| **Selected projects** | The token can access only the projects whose IDs are in its `projectIds` list. Maximum 50 projects per token. Requests for other projects return `403`. |

Use selected-project scoping to limit blast radius. A Slackbot that only posts updates for one team's project does not need access to the rest of the workspace — give it a token scoped to that single project. If the bot is ever compromised, the rest of the workspace remains unaffected.

Project scope is checked **after** scope and role checks. A token with `task:write` but no access to project X cannot create tasks in project X, even if the owning user can.

---

## Effective Permissions

The authorization model is:

```
effective_permissions = token.scopes ∩ user.role_permissions ∩ token.project_scope
```

A token **cannot grant more than the human owner has.** Examples:

| User role | Token scopes | Result |
| --- | --- | --- |
| Workspace admin | `task:write` | Can create/update tasks |
| Workspace member (not admin) | `workspace:write` | **Still cannot update workspace settings** — the human can't either |
| Project viewer on project X | `task:write`, project scope = all | Cannot create tasks in project X; can in projects where the user has writer access |
| Workspace admin | `read:*` | Read-only despite being an admin; the token narrows the scope |

This prevents privilege escalation by token issuance. Lowering a user's role downstream automatically tightens every token they own — no reissue or revoke required.

---

## Workspace Scoping

Each token is bound to exactly one workspace at creation time. Requests using the token against any other workspace return `403`. This is checked in `requireWorkspaceMember` before any scope evaluation, so the answer is "no" even if the scopes would otherwise allow the action.

To integrate with multiple workspaces, mint one token per workspace. Do not share tokens across workspaces.

---

## Authentication

Send the token in the `Authorization` header on every request:

```
Authorization: Bearer cdn_pat_<32 chars>
```

- **CORS:** PAT requests do not rely on cookies, so the standard CORS preflight rules apply to the `Authorization` header. Configure your origin allowlist accordingly when calling from a browser-based admin tool.
- **CSRF:** PATs are header-based and carry no ambient credentials. There is no CSRF risk — a browser will never automatically attach a PAT to a cross-origin request.
- **Cookie fallback:** If the `Authorization` header is present but the token is invalid (malformed, expired, revoked, or unknown), the request returns `401 Invalid API token` immediately. The server **does not fall back to cookie authentication** when a Bearer token is present. This prevents a downgrade attack where an attacker presents a stale PAT and silently rides a victim's cookie session.

---

## Expiry

Tokens may be set to expire after **30 days**, **90 days**, **365 days**, or any custom duration up to **3650 days (10 years)**. If `expiresInDays` is omitted at creation, it defaults to **365 days**.

**There is no "never expires" option in v1.** Every token must have an explicit expiry. The reasoning: a token with no expiry creates an indefinite blast radius if the secret is ever exfiltrated and the operator who minted it has moved on. A 10-year maximum keeps the door open for trusted long-running automation while guaranteeing a periodic re-evaluation event.

Expired tokens are not deleted; they are rejected at authentication with `401`. This preserves the audit trail and lets the UI display "Expired" status. Rotate or mint a new token to restore access.

The UI surfaces an amber warning when a token has fewer than 7 days remaining so operators have time to roll the secret without downtime.

---

## Rotation

Long-lived secrets should be rotated periodically. The **Rotate** action in the UI streamlines this:

1. Click **Rotate** on an existing token.
2. Cadence mints a **sibling token** with identical scopes, project scope, and expiry.
3. The plaintext for the new token is shown in the same one-time reveal panel.
4. The **old token is scheduled for automatic revocation in 7 days** (`revokeAt = now + 7d`).
5. During the 7-day grace window, **both tokens work**. Deploy the new secret, verify, and the old one self-destructs.

This pattern lets operators rotate secrets with zero downtime. After deployment, you can revoke the old token manually instead of waiting the full 7 days.

Rotation preserves the audit lineage via `rotatedToId` — activity records and attribution survive rotation. Every rotation triggers an out-of-band security email to the token owner because rotation produces a new plaintext credential (security-equivalent to a fresh mint).

### Automatic revocation sweep

Scheduled auto-revocation is driven by `processScheduledTokenRevocations`, a task that runs inside the **scheduled handler invoked every 5 minutes** (Cloudflare Cron Trigger). The task finds tokens where `revokeAt < now AND revokedAt IS NULL`, sets `revokedAt = now`, and emits telemetry for each revocation. It is error-isolated like the other scheduled cleanup tasks — a failure in this sweep cannot prevent webhook retries or notification cleanup from running.

The 5-minute interval means a rotated token's actual revocation lands somewhere in `[revokeAt, revokeAt + 5min]`. We document the grace window as "7 days" rather than "7 days and up to 5 minutes" because the difference is operationally irrelevant — the integration is expected to be cut over well before the window closes.

---

## Revocation

Tokens can be revoked at any time. Revocation is **instant** — the next request using the token returns `401`.

| Who can revoke | What they can revoke |
| --- | --- |
| Token owner | Their own tokens, at any time |
| Workspace owner / admin | **Any token in their workspace** — for emergency response when a member's machine is compromised |

Revocation is implemented as a soft-delete: `revokedAt` is set to the current timestamp. The row is retained so the audit trail (activity attribution, last-used timestamps) survives. Revoked tokens remain visible in the UI under a "Revoked" filter.

A token cannot be un-revoked. Mint a new one if access is needed again.

---

## Authorization Policy

The token management endpoints follow a deliberately tight policy to prevent a leaked PAT from being used to mint replacements or to silently rotate itself out of audit visibility.

| Action | Who can perform |
| --- | --- |
| **Mint** (`POST /api-tokens`) | Any workspace member — for their **own** tokens. Members cannot mint tokens on behalf of other users. |
| **List own** (`GET /api-tokens`) | Any workspace member sees their own tokens. |
| **List all in workspace** | Workspace owner / admin only. Members see only the tokens they own. |
| **Get detail** (`GET /api-tokens/{id}`) | Token owner; workspace owner / admin can also read any token in the workspace. |
| **Rotate** (`POST /api-tokens/{id}/rotate`) | **Token owner only.** An admin cannot rotate someone else's token — rotation produces a new plaintext that only the owning user should ever see. The correct admin remediation is to revoke. |
| **Revoke** (`DELETE /api-tokens/{id}`) | Token owner; workspace owner / admin. Admins need this for emergency response when a member's machine is compromised. The token owner is always emailed when a revocation lands, even when an admin initiates it, so the owner finds out before their integration breaks. |

### PATs cannot manage other tokens

Every token management endpoint rejects requests authenticated via a PAT with `403`. Only **cookie-authenticated humans** can mint, list, rotate, or revoke. This bypass prevents a compromised PAT from:

- Minting a sibling token with broader scopes and discarding the original (silent privilege escalation).
- Rotating itself to extend its effective lifetime past discovery.
- Enumerating other tokens in the workspace.

If you need automation to *use* tokens, mint them out-of-band via the UI or a cookie-authed admin session, then store the plaintext in your secret manager.

### Workspace-scope information disclosure (known minor)

A PAT scoped to workspace X can still call `GET /api/workspaces` and see the list of every workspace its owning user belongs to. It **cannot access any resource in those other workspaces** — every project, task, member, and attachment endpoint scoped to a different workspace returns `403`.

We document this as a deliberate, known trade-off rather than a bug:

- The list endpoint is a tiny information disclosure (workspace names + IDs).
- Fully sandboxing it would require a parallel "PAT-only" list endpoint or a per-request workspace filter, neither of which adds defensive value once resource-level checks already block access.
- The **practical recommendation** is unchanged: mint one PAT per workspace. Don't rely on this list endpoint being scoped — rely on resource-level workspace checks, which are.

If your threat model treats the existence and names of sibling workspaces as sensitive, route those operations through cookie auth or revoke the token's owner from the sibling workspaces.

---

## `lastUsedAt` and Unused-Token Warnings

Every successful authentication updates the token's `lastUsedAt` timestamp via a fire-and-forget deferred write — it never blocks the request.

The UI shows `lastUsedAt` as a relative time ("3 hours ago", "Never used") in the token list. Tokens unused for more than **30 days** are flagged with an amber indicator. Stale tokens are a primary attack vector — if the integration that minted a token no longer exists, the token should be revoked.

---

## Activity Attribution

Two parallel attribution surfaces work together:

### 1. User-facing task activity feed

Task mutations made via a PAT are attributed in the task activity feed as:

```
Jane Smith (via Slackbot prod) created task "Fix login bug"
```

`task_activity.apiTokenId` is a `set null` FK to the token, so the attribution survives revocation. If the token is later hard-deleted, the activity record still shows `(via deleted token)`. PATs do **not** generate synthetic bot users — the owning human remains the actor on every record, with the token name as a parenthetical. This keeps `assigneeId`, mention notifications, and existing `createdBy` logic working without special cases.

### 2. Data egress & cross-resource audit ledger (`audit_log`)

For every other resource a PAT can touch (workspaces, projects, labels, teams, webhooks, invitations, attachments, the api-tokens management surface itself), a row is appended to `audit_log` on every successful 2xx mutation. This is the source of truth for "what has this token done?" — exactly the question an operator needs answered when deciding whether to revoke a misbehaving integration.

The ledger captures:

- `apiTokenId`, `actorUserId`, `workspaceId` — the principal trio. `apiTokenId` is **nullable**: it is the token id for PAT-attributed events, and `null` for cookie-session events (e.g. a human-initiated workspace export), so human-initiated activity is attributable without a token.
- `resourceType` / `resourceId` — derived from the matched route pattern
- `action` — `create` / `update` / `delete` for collection / item ops, plus verbs like `complete`, `rotate`, `move`, and the data-movement verbs `export` / `import`
- `method`, `path`, `status` — the raw HTTP envelope so an investigator can reconstruct the exact request
- `metadata` — JSON-encoded context (route params for mutations; for an export, the `includeActivity` flag plus project/task counts)

Writes happen through a post-response middleware via `deferWork`, so they never block the response. Failed audit inserts are logged and dropped — the audit signal must never break the API surface. Indexes target the three queries that matter: `(workspaceId, createdAt)`, `(apiTokenId, createdAt)`, and `(resourceType, resourceId)`. Both the PAT writer (`recordPatAuditLog`) and the data-egress writer (`recordWorkspaceDataEvent`) delegate to one shared insert path, so there is a single source of truth for how a row is persisted (CLAUDE.md rule 4).

Reads, GETs, and non-2xx responses are deliberately **not** audited: read traffic belongs in the access log; failed requests don't represent state changes and would let an attacker flood the audit table. **The one deliberate exception is workspace data egress** — `GET /api/workspaces/:workspaceId/export` writes an `export` row (via `recordWorkspaceDataEvent`) even though it is a read, because a full-workspace download is precisely the event an operator must be able to reconstruct after a suspected leak. It is recorded whether the caller authenticated with a PAT or a cookie session.

---

## Rate Limits

PAT-authenticated requests are subject to a higher rate-limit quota than cookie-authenticated requests. The defaults are **600 requests per minute for PATs** versus **120 per minute for cookies** — a 5× multiplier — defined as named constants (`RATE_LIMIT_DEFAULTS`) in [`src/api/middleware/rate-limit.ts`](../../src/api/middleware/rate-limit.ts) so they're easy to audit and tune. Specific routes may set tighter or looser limits; the exact per-route limits are documented in the interactive API reference at `/api/docs`.

The intuition: a cookie session is a human clicking, so it generates traffic at human pace. A PAT is a machine, which may legitimately need to batch-fetch tasks or sync state on a schedule. The cookie quota is calibrated for the former; the PAT quota is calibrated for the latter.

Rate-limit keys are scoped per-token (`pat:<tokenId>`), so two PATs owned by the same user do not contend with each other. Rotated tokens get a fresh key. Unauthenticated requests fall back to an IP-based key.

See [rate-limiting.md](./rate-limiting.md) for the broader rate-limit model.

The **token-management surface itself** (`/api/workspaces/:id/api-tokens/*`) sits behind a separate, tighter per-user limiter — 20 requests/minute. These endpoints already reject PAT callers entirely (see [Authorization Policy](#authorization-policy)), and the rate limit ensures even a compromised session cannot spam mint/rotate/revoke to fan out emails or churn the audit ledger.

Token-management responses also carry `Cache-Control: no-store` so a misconfigured CDN or corporate proxy cannot retain token metadata across users.

---

## curl Examples

The general form of any PAT-authenticated request is:

```
curl -H "Authorization: Bearer cdn_pat_..." https://your-cadence-host/api/...
```

### Token management

These endpoints require **cookie authentication** — PATs cannot mint, list, rotate, or revoke other tokens (they receive `403`). This is a deliberate lockout: a compromised PAT must not be able to bootstrap further access.

```bash
# List your tokens in a workspace (active, rotating, and expired — revoked
# tokens are hidden by default; see the `includeRevoked` flag below)
curl -H "Cookie: better-auth.session_token=..." \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens

# Include revoked tokens (used by the workspace settings "Show revoked"
# toggle and incident-response tooling). Revoked tokens are kept in the
# database indefinitely so historical activity attribution survives, but
# are excluded from listings by default to keep the response and UI tidy.
curl -H "Cookie: better-auth.session_token=..." \
  "https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens?includeRevoked=true"

# Mint a token — plaintext is returned EXACTLY ONCE in the response body
curl -X POST \
  -H "Cookie: better-auth.session_token=..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack release bot",
    "scopes": ["task:read", "task:write"],
    "projectScope": "selected",
    "projectIds": ["prj_..."],
    "expiresInDays": 90
  }' \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens

# Rotate — mints a sibling with identical scopes, schedules the old token
# for revocation in 7 days, and returns the new plaintext (one-time)
curl -X POST \
  -H "Cookie: better-auth.session_token=..." \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens/{tokenId}/rotate

# Revoke — instant, soft-delete (sets revokedAt = now)
curl -X DELETE \
  -H "Cookie: better-auth.session_token=..." \
  https://your-cadence-host.com/api/workspaces/{workspaceId}/api-tokens/{tokenId}
```

**Default expiry:** `expiresInDays` defaults to **365** when omitted. The maximum accepted value is **3650** (10 years). A `null` value meaning "never expires" is **not accepted in v1** — every token must have an explicit expiry. This forces a periodic operator decision rather than a fire-and-forget secret.

### Using a PAT

```bash
# List workspaces visible to the token's owning user
curl -H "Authorization: Bearer cdn_pat_..." \
  https://your-cadence-host.com/api/workspaces

# Create a task in a project the token is scoped to
curl -X POST \
  -H "Authorization: Bearer cdn_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"title":"From Slack","status":"todo"}' \
  https://your-cadence-host.com/api/projects/{projectId}/tasks
```

The interactive reference at `/api/docs` (Scalar UI) accepts a PAT via its **Authorize** button so endpoints can be exercised directly from the browser. See [integrations.md](./integrations.md) for end-to-end Slackbot and GitHub Actions walkthroughs.

---

## Security Best Practices

1. **Store in a secret manager.** Never hard-code a PAT into source. Use AWS Secrets Manager, GCP Secret Manager, GitHub Actions secrets, 1Password, Doppler, etc.
2. **Rotate every 90 days** (or sooner). Use the in-app Rotate action so you get a 7-day grace window — no downtime, no panic.
3. **Use the minimum scope.** A read-only Slackbot doesn't need `write:*`. A token scoped to one project can't be misused to delete others.
4. **Prefer "Selected projects" over "All projects"** whenever possible. Smaller blast radius if the secret leaks.
5. **Monitor `lastUsedAt`.** Revoke tokens unused for over 30 days. Stale credentials are an attack surface, not a convenience.
6. **Revoke immediately on suspected leak.** Don't wait. The action is instant and reversible (mint a new one).
7. **Never log the plaintext.** The prefix (`cdn_pat_a4kZ…`) is safe to log for diagnostics; the full token is not.
8. **Don't share tokens between humans.** PATs are per-user. If a teammate needs API access, they mint their own.
9. **Don't ship PATs in browser code.** They have no SameSite or HttpOnly protection in a browser. Use cookie auth in browsers and PATs only on servers and trusted CLIs.

---

## Operational Notes

- The token format includes the `cdn_pat_` prefix specifically to enable secret scanners to detect leaks in commits, logs, and shared documents.
- Do **not** commit tokens to git, even in private repositories. Once a secret is in git history, it must be rotated — `git rm` is not a fix.
- If a PAT is committed by accident: revoke immediately via the UI, then mint a replacement. Rewriting git history is not sufficient — assume the secret is compromised.

### Secret scanning

Cadence Personal Access Tokens use the `cdn_pat_` prefix so they can be detected by automated secret scanners.

The repo's own scanner is configured to flag `cdn_pat_[A-Za-z0-9_-]{32,}` matches in commits. See [.gitleaks.toml](../../.gitleaks.toml) for the active rule.

If you accidentally commit a token, **revoke it immediately** via the Settings → API Tokens UI, then mint a replacement. Rotation does not help here — the leaked plaintext is already exposed.

If you're hosting Cadence yourself and want GitHub-native secret scanning, you can register the `cdn_pat_` prefix as a custom secret pattern in your GitHub organization settings.
