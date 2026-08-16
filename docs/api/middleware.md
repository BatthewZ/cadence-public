# Middleware

## Middleware Stack

Middleware is applied to all `/api/*` routes **in this exact order**. Order matters because each middleware depends on the context set by previous ones.

```
Request
  |
  v
1. requestIdMiddleware     -- assigns a unique request ID
  |
  v
2. requestLogger           -- logs method, path, status, duration, requestId
  |
  v
3. telemetryMiddleware     -- creates a TelemetrySink, tracks http_request events
  |
  v
4. securityHeadersMiddleware -- sets security response headers
  |
  v
5. DB singleton            -- creates a single Drizzle DB instance per request
  |
  v
6. CORS                    -- validates origin, sets CORS headers
  |
  v
7. authSessionMiddleware   -- resolves PAT (Bearer) OR cookie session, sets user/session/apiToken
  |
  v
8. auditPatMutations       -- writes one audit_log row per successful PAT-attributed mutation
  |
  v
Route-level middleware + Route Handler (or 404 catch-all)
  |
  v
Response
```

This is registered in `src/api/index.ts`:

```ts
app.use("/api/*", requestIdMiddleware);
app.use("/api/*", requestLogger);
app.use("/api/*", telemetryMiddleware);
app.use("/api/*", securityHeadersMiddleware);
app.use("/api/*", async (c, next) => { c.set("db", createDb(c.env.DB)); await next(); });
app.use("/api/*", cors({ ... }));
app.use("/api/*", authSessionMiddleware);
app.use("/api/*", auditPatMutations);
app.route("/api", routes);
```

**Registration order is dispatch order.** Hono composes matched handlers in the order they were registered, so a route registered *before* a middleware never runs that middleware. `/api/docs`, `/api/docs/webhooks`, and `/api/health` are registered between the CORS line and the auth-session line and answer without calling `next()` -- which is why they are reachable without a session. Everything mounted by `app.route("/api", routes)`, including the generated `/api/openapi.json`, is registered after the full stack and therefore runs all of it.

---

## Middleware Details

### 1. Request ID (`src/api/middleware/request-id.ts`)

Assigns a unique identifier to every request. If the incoming request has an `x-request-id` header, that value is reused. Otherwise, a new UUID is generated via `crypto.randomUUID()`.

The request ID is:
- Stored in the Hono context as `requestId` (available via `c.get("requestId")`).
- Set as the `X-Request-Id` response header.
- Included in error responses (see [Error Handling](./error-handling.md)).

```ts
export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
});
```

### 2. Request Logger (`src/api/middleware/logger.ts`)

Logs every request as a structured JSON object to `console.log`. The log is written **after** the response is generated, so it includes the response status and duration.

Fields logged:

| Field | Source |
|---|---|
| `method` | `c.req.method` |
| `path` | `c.req.path` |
| `status` | `c.res.status` |
| `duration` | Elapsed time in milliseconds |
| `requestId` | From context (set by request ID middleware) |
| `ip` | `cf-connecting-ip` header |
| `userAgent` | First 128 characters of `user-agent` header |

```ts
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  console.log(
    JSON.stringify({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration,
      requestId: c.get("requestId") ?? null,
      ip: c.req.header("cf-connecting-ip") ?? null,
      userAgent: c.req.header("user-agent")?.slice(0, 128) ?? null,
    })
  );
});
```

### 3. Telemetry (`src/api/middleware/telemetry.ts`)

Creates a `TelemetrySink` from the environment bindings and stores it in the Hono context as `c.get("telemetry")`. After the response is generated, tracks an `http_request` event with method, path, status code, duration, request ID, user ID, and workspace ID.

The sink is also used by downstream systems (webhook delivery, scheduled tasks) to track their own events.

**Context set:**

| Key | Type | Value |
|---|---|---|
| `telemetry` | `TelemetrySink \| undefined` | Telemetry sink instance (see **Sink selection** below) |

**Sink selection** (via `createTelemetrySink` in `src/api/lib/telemetry/index.ts`):

| Condition | Sink |
|---|---|
| `TELEMETRY_SINK=noop` | `NoopSink` — silently discards all events |
| `TELEMETRY_SINK=console` | `ConsoleSink` — writes structured JSON to `console.log` |
| `ANALYTICS` binding present | `AnalyticsEngineSink` — writes to Cloudflare Analytics Engine |
| Fallback | `ConsoleSink` |

### 4. Security Headers (`src/api/middleware/security-headers.ts`)

Sets security-related response headers on all API responses. These headers are applied **after** `await next()`, so they are set on the final response.

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing. |
| `X-Frame-Options` | `DENY` | Prevents the page from being embedded in iframes. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer information sent with requests. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables camera, microphone, and geolocation APIs. |
| `X-XSS-Protection` | `0` | Disables the legacy XSS filter (modern CSP is preferred). |
| `Content-Security-Policy` | See below | Controls which resources can be loaded. |

**CSP directives** (API default):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

**Docs CSP** (`/api/docs` and `/api/openapi.json`): A relaxed policy is applied to these paths to allow the Scalar interactive API documentation to load its scripts, styles, and fonts from `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com`, `fonts.scalar.com`, and `api.scalar.com`.

### 5. DB Singleton (inline in `src/api/index.ts`)

Creates a single Drizzle ORM instance per request and stores it in the Hono context as `c.get("db")`. All downstream middleware and handlers use this shared instance instead of calling `createDb(c.env.DB)` themselves, avoiding 3-5 duplicate Drizzle wrapper constructions per request.

```ts
app.use("/api/*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});
```

**Context set:**

| Key | Type | Value |
|---|---|---|
| `db` | `Database` (from `src/db`) | Drizzle ORM instance wrapping the D1 binding |

### 6. CORS

CORS is configured using Hono's built-in `cors()` middleware. See [CORS](./cors.md) for full details.

### 7. Auth Session (`src/api/middleware/auth.ts`)

Resolves the authenticated identity for every request. Two paths are supported, evaluated in priority order:

1. **Personal Access Token** — if the request carries `Authorization: Bearer cdn_pat_…`, the middleware calls `verifyToken()` from [`src/api/lib/api-tokens.ts`](../../src/api/lib/api-tokens.ts). On success it sets `c.set("user", result.user)`, `c.set("session", null)`, `c.set("apiToken", result.token)`, pre-caches `c.set("workspaceMembership", result.workspaceMembership)` to spare a downstream DB lookup, and schedules a fire-and-forget `bumpLastUsedAt()` via `deferWork()` so the request itself never blocks on the write. On failure (malformed, unknown, expired, revoked) the middleware returns `401 Invalid API token` **immediately** — it does **not** fall through to the cookie path. Falling through would let an attacker present a stale PAT and silently ride a victim's cookie session (a downgrade attack).
2. **Cookie session** — if no Bearer token is present, the middleware extracts the Better Auth session from cookies. Sets `c.get("user")` and `c.get("session")` -- either with valid session data or `null`. Does not block unauthenticated requests. See the [Auth documentation](../auth/auth.md) for details.

**Context set:**

| Key | Type | Value |
|---|---|---|
| `user` | `User \| null` | The authenticated user (same shape for cookie and PAT branches) |
| `session` | `Session \| null` | The session record on the cookie branch; `null` on the PAT branch |
| `apiToken` | `ApiToken \| null` | The verified PAT row on the PAT branch; `null` on the cookie branch |
| `workspaceMembership` | optional pre-cached membership | Pre-populated on the PAT branch because the token already encodes the workspace |

Downstream middleware can branch on `c.get("apiToken")` to apply PAT-specific behavior:

- `requireWorkspaceMember()` / `requireWorkspaceRole()` reject with `403` if `apiToken.workspaceId !== requestedWorkspaceId`. These see only a `:workspaceId`, so they enforce the **workspace half** of the token's binding and nothing else.
- `requireProjectAccess()` / `requireProjectRole()` / `requireTaskAccess()` / `requireTaskRole()` reject with `403` unless the resolved project passes **both** halves: it belongs to the token's workspace, and (for a `projectScope: "selected"` token) it is in `apiToken.projectIds`.
- `requireTokenScope(scope)`, `requireReadScopeForResource(resource)`, and `requireWriteScopeForResource({ resource })` enforce the `scopes` array. Cookie auth bypasses these checks entirely — they are a no-op when no `apiToken` is in context.
- `rejectPatAuth(message?)` refuses PAT callers outright on surfaces that must stay human-only.
- Rate-limit key resolution (`defaultRateLimitKey`) prefers `pat:<tokenId>` over `user:<userId>` over IP, so a machine client gets its own bucket rather than sharing one with everything behind its egress IP. `RATE_LIMIT_DEFAULTS` in `rate-limit.ts` records the intended ceilings (120/min for cookies, 600/min for PATs), but every limiter mounted today passes an explicit `max` that applies to both — so what a PAT currently changes is the bucket, not the quota. See [Rate Limiting](./rate-limiting.md) for the per-route table and [API Tokens § Rate Limits](./api-tokens.md#rate-limits).
- Activity attribution captures `c.get("apiToken")?.id` so mutations made via a PAT render as `"Jane (via Slackbot)"` in the feed.
- `auditPatMutations` (step 8 above) records every successful PAT-attributed mutation in the `audit_log` table.

Each of these is detailed under [Authorization Middleware](#authorization-middleware) below; the scope grammar itself lives in [API Tokens § Scopes Reference](./api-tokens.md#scopes-reference) and the project/workspace binding rules in [API Tokens § Project Scoping](./api-tokens.md#project-scoping) and [§ Workspace Scoping](./api-tokens.md#workspace-scoping).

**Early exit optimization:** When neither a `cookie` header nor an `authorization` header is present on the request, the middleware sets all context values to `null` and skips both the PAT lookup and the `getSession()` DB call. This avoids unnecessary database round-trips for unauthenticated preflight and public requests.

For the full PAT model — format, scopes, project scoping, expiry, rotation, revocation, and security best practices — see [API Tokens](./api-tokens.md).

### 8. PAT Audit Ledger (`src/api/middleware/audit-pat.ts`)

Writes one `audit_log` row per **successful, PAT-attributed mutation**, so a workspace owner can answer "what did this integration change?" without trawling request logs. It runs `await next()` first and inspects the finished response, which is why it is mounted after `authSessionMiddleware` (it needs `c.get("apiToken")`) and before `app.route("/api", routes)` (it must wrap every route handler).

A row is written only when all of the following hold:

| Condition | Why |
|---|---|
| `c.get("apiToken")` is set | Cookie traffic is out of scope — the ledger exists to attribute machine clients. |
| Method is `POST`, `PUT`, `PATCH`, or `DELETE` | Reads are high-volume telemetry, not security-audit material. |
| Response status is `2xx` | A rejected request changed nothing and would only add noise. |

The insert itself is handed to `recordPatAuditLog()` in `src/api/lib/audit-log.ts`, which writes through `deferWork` — the response is never blocked by the ledger, and a failed insert is logged and dropped rather than turned into an API error.

The `(resourceType, resourceId, action)` triple is derived from the matched Hono route pattern (`routePath(c, -1)`) plus the resolved route params, so handlers need no cooperation: `/collection/:id` yields a method-derived action on that collection, `/collection/:id/verb` yields the verb, and `/collection/:id/subcollection` yields a create on the child collection. Remaining route params are kept as metadata for context. Routes that fit none of these shapes record `resourceType: "unknown"` rather than throwing. `deriveAuditFields()` is exported so this mapping is unit-tested without standing up Hono.

This middleware is not the only writer to `audit_log`: the workspace export handler records its own row for a *read*, because a full-workspace download is exactly the event an operator must be able to reconstruct later. Both writers share one insert path. The ledger itself — table shape, what it captures, and how it complements the user-facing activity feed — is described in [API Tokens § Activity Attribution](./api-tokens.md#activity-attribution).

---

## Route-Level Middleware

### `cacheControl(maxAge)` (`src/api/middleware/cache-control.ts`)

Adds a `Cache-Control: private, max-age=<seconds>` header to successful GET responses. Applied at the **route level** to individual GET endpoints whose data is reasonably stable.

- Only applies to `GET` requests with a `2xx` status code.
- Uses the `private` directive because all API endpoints sit behind authentication -- responses must never be stored in shared (CDN/proxy) caches.
- Do **not** apply to volatile data (notifications, activity feeds, dashboard stats) or write endpoints.

**Usage:**

```ts
import { cacheControl } from "../../middleware/cache-control";

app.get("/projects/:projectId", requireAuth, requireProjectAccess(), cacheControl(300), getProject);
```

**Current usage:** none. No route mounts `cacheControl()` today. The handlers that do send caching headers set them inline, each with a value specific to that response: the public config endpoint and the ICS calendar feed use `private, max-age=300`, and the workspace/project freshness endpoints use `public, s-maxage=2`. The middleware stays available (and tested) for GET endpoints where a plain per-route TTL is the right answer — prefer it over hand-writing the header.

### `noStoreCacheControl()` (`src/api/middleware/cache-control.ts`)

The inverse of `cacheControl(maxAge)`: sets `Cache-Control: no-store` and `Pragma: no-cache` on every response from the route, regardless of method or status. Mounted on routes that return credential metadata — the PAT management surface (`/workspaces/:workspaceId/api-tokens/*`) — so that token prefixes, scopes, and `lastUsedAt` timestamps can never be retained by a misconfigured intermediate cache. `cacheControl()` is opt-in caching; this is opt-in lockdown.

---

## Authorization Middleware

The authorization middleware is applied **per-route**, not globally. These functions live in `src/api/middleware/require-auth.ts` and `src/api/middleware/authorize.ts` and are used in route definitions to enforce authentication, workspace membership, project access, and role requirements.

All authorization middleware depends on `authSessionMiddleware` having run first (it reads `c.get("user")`). If no authenticated user is present, every function below returns `401 Unauthorized` immediately.

### Order Within a Route

Domain route files register PAT scope middleware with `app.use(path, …)` **above** their route definitions, then list the remaining guards inline on each route. Because Hono dispatches in registration order, the resulting chain is:

```
[global stack]
  -> requireReadScopeForResource / requireWriteScopeForResource   (app.use, per path)
  -> requireAuth                                                   (is there a user at all?)
  -> requireWorkspaceRole / requireProjectRole / requireTaskRole   (may this human do this?
                                                                    + PAT binding guard)
  -> requireProjectCreation                                        (does this workspace's own
                                                                    policy allow it?)
  -> rateLimit(...)                                                (only authorised calls
                                                                    consume quota)
  -> validateBody / validateQuery                                  (is the payload well-formed?)
  -> handler
```

Three orderings in that list are deliberate rather than incidental:

- **Scope before role.** A PAT carries at most the permissions of the human who minted it, so effective permission is `min(token scopes, user role)`. The scope mount answers "was this token issued for this kind of work?" and the role guard answers "may this human do it here?" — both must pass, and neither substitutes for the other.
- **Role before policy.** The role guards answer a question about the product ("what does a project admin do?"); a policy guard answers a question about *this workspace's* configuration ("has this workspace narrowed that?"). Running role first means the policy check never fires for someone who was never going to pass anyway, and — for `requireProjectCreation()` on a route with no `:workspaceId` — it is what resolves the owning workspace the policy has to be read from. Getting this backwards on the duplicate route makes the guard throw rather than silently pass; see [`requireProjectCreation()`](#requireprojectcreation-srcapimiddlewareauthorizets).
- **Role before rate limit.** The limiter is mounted after the role guard so a rejected caller cannot spend an authorised caller's quota. `rejectPatAuth()` is the exception: where it is mounted it runs immediately after `requireAuth`, before anything else consults the request.

### Authorization Caching

The authorization middleware caches resolved access in the Hono context so that multiple middleware or handlers in the same request chain can skip redundant DB lookups. Two internal helpers power this:

- **`getOrResolveWorkspaceMembership(c, workspaceId, userId)`** -- returns cached workspace membership if `c.get("workspaceMembership")` exists for the same `workspaceId`; otherwise queries the DB, caches, and returns the result.
- **`getOrResolveProjectAccess(c, projectId, userId)`** -- returns cached project access if `c.get("currentProject")` and `c.get("projectAccess")` exist for the same `projectId`; otherwise calls `resolveProjectAccess()`, caches, and returns. Distinguishes between not-found (project doesn't exist) and forbidden (no access).

Cache validation ensures the cached entry matches the requested workspace/project ID before reusing it. Negative results (user has no access) are not cached, since the middleware short-circuits on denial.

### `requireAuth` (`src/api/middleware/require-auth.ts`)

Guards routes that require an authenticated user. This is the simplest gate -- it checks that `c.get("user")` is not `null` and does nothing else.

**Checks:** `c.get("user")` is non-null.

**Context set:** None (user is already set by `authSessionMiddleware`).

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |

**Usage:**

```ts
import { requireAuth } from "../../middleware/require-auth";

app.get("/workspaces", requireAuth, listWorkspaces);
```

### `requireWorkspaceMember()` (`src/api/middleware/authorize.ts`)

Verifies that the authenticated user is a member of the workspace identified by the `:workspaceId` route parameter. Any role (owner, admin, or member) is sufficient.

**Checks:** User has a row in the `workspace_member` table for the given workspace.

**PAT binding:** If the request carries a PAT, `apiToken.workspaceId` must equal the `:workspaceId` in the URL — the token is the workspace boundary, not the user, so a token minted in workspace A is refused on workspace B even when its owning human belongs to both. This guard sees no project, so it enforces only the workspace half of the token's binding; a handler behind it that reads or writes project-owned rows must apply the project half itself (see [PAT Enforcement Inside Handlers](#pat-enforcement-inside-handlers)).

**Context set:**

| Key | Type | Value |
|---|---|---|
| `workspaceMembership` | `{ id: string; workspaceId: string; role: WorkspaceRole }` | The membership record ID, workspace ID, and the user's role in the workspace (typed as `WorkspaceRole` from `src/shared/types/roles.ts`) |

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |
| 403 | `{ "error": "Forbidden", "requestId": "..." }` | User is not a member of the workspace |

**Usage:**

```ts
import { requireWorkspaceMember } from "../../middleware/authorize";

app.get(
  "/workspaces/:workspaceId",
  requireAuth,
  requireWorkspaceMember(),
  getWorkspace,
);
```

### `requireWorkspaceRole(...roles)` (`src/api/middleware/authorize.ts`)

Verifies that the authenticated user holds one of the specified roles within the workspace identified by the `:workspaceId` route parameter. This is stricter than `requireWorkspaceMember()` -- the user must be a member **and** their role must be in the allowed list.

**Checks:** User is a workspace member and `membership.role` is in `allowedRoles`.

**PAT binding:** Same workspace-half check as `requireWorkspaceMember()`. A higher required role is not a substitute for project selection — handlers behind this guard that touch project-owned rows still apply the project half themselves.

**Context set:**

| Key | Type | Value |
|---|---|---|
| `workspaceMembership` | `{ id: string; workspaceId: string; role: WorkspaceRole }` | The membership record ID, workspace ID, and the user's role in the workspace (typed as `WorkspaceRole` from `src/shared/types/roles.ts`) |

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |
| 403 | `{ "error": "Forbidden", "requestId": "..." }` | User is not a workspace member, or their role is not in the allowed list |

**Usage:**

```ts
import { requireWorkspaceRole } from "../../middleware/authorize";

// Only owners and admins can update workspace settings
app.patch(
  "/workspaces/:workspaceId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(updateWorkspaceSchema),
  updateWorkspace,
);

// Only owners can delete a workspace
app.delete(
  "/workspaces/:workspaceId",
  requireAuth,
  requireWorkspaceRole("owner"),
  deleteWorkspace,
);
```

### `requireProjectCreation()` (`src/api/middleware/authorize.ts`)

Verifies that the authenticated user may bring a **new** project into existence in the workspace this request targets. This is the single enforcement point for the workspace's `allowMemberProjectCreation` governance toggle (see [Database § `workspace.policy`](../database/schema.md#workspace)).

**Checks, in order:**

1. User is authenticated, else `401`.
2. User is a member of the target workspace, else a generic `403`.
3. If their workspace role is `owner` or `admin` — pass. **No policy query is made.** Admins are never subject to the toggle, so the common case costs nothing, and turning the setting off can never lock out the only people who could turn it back on.
4. Otherwise load the workspace policy via `loadWorkspacePolicy()` and pass only if `allowMemberProjectCreation` is `true` (its default).

**Resolving the workspace id.** The two mount points name the target workspace differently, so the middleware accepts both shapes rather than being split in two:

| Mount | Source of the workspace id |
|---|---|
| `POST /workspaces/:workspaceId/projects` | The `:workspaceId` route parameter |
| `POST /projects/:projectId/duplicate` | `currentProject.workspaceId`, cached by the `requireProjectRole("admin")` that runs first — a read of an already-resolved value, not an extra query |

> **Ordering requirement.** On any route without a `:workspaceId` parameter, this **must** be mounted *after* a project-access guard. Given neither source, it **throws** rather than calling `next()` — a misconfigured mount is a server bug, and failing loudly beats silently waving requests through a policy check that had nothing to check.

**Why it guards the duplicate route too.** Skipping it would make the toggle decorative. `createProject` adds its caller as project **admin**, so any member who created a project while the setting was on keeps satisfying `requireProjectRole("admin")` on it forever and could go on minting projects by duplicating that one. A rule about who may bring projects into existence has to hold on every path that brings one into existence. Workspace import (`POST /workspaces/:workspaceId/import`) also creates projects and is deliberately **not** guarded — it is already owner/admin-only, so this policy could neither widen nor narrow it.

**Context set:** None of its own. Step 2 populates `workspaceMembership` through the same shared resolver `requireWorkspaceMember()` uses.

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |
| 403 | `{ "error": "Forbidden", "requestId": "..." }` | Caller is not a member of the target workspace |
| 403 | `{ "error": "Only workspace owners and admins can create projects in this workspace", "requestId": "..." }` | Caller is a `member` and the workspace has the toggle off |

> **Why this 403 explains itself.** The membership and PAT guards in this file answer a deliberately generic `"Forbidden"` so a probe cannot distinguish "wrong token" from "no membership". That reasoning does not transfer here: everyone reaching this check has already proved workspace membership, and the policy they hit is their own workspace's configuration, shown to their admins in **Workspace Settings > Member Permissions**. There is nothing left to conceal, and a bare `"Forbidden"` would send an integrator hunting for a scope or membership bug instead of reading the setting.

**Usage:**

```ts
import { requireProjectCreation, requireProjectRole } from "../../middleware/authorize";

// Route parameter supplies the workspace id
app.post(
  "/workspaces/:workspaceId/projects",
  requireAuth,
  requireWorkspaceMember(),
  requireProjectCreation(),
  validateBody(createProjectSchema),
  createProject,
);

// No :workspaceId here — must run AFTER the project-access guard that caches it
app.post(
  "/projects/:projectId/duplicate",
  requireAuth,
  requireProjectRole("admin"),
  requireProjectCreation(),
  validateBody(duplicateProjectSchema),
  duplicateProject,
);
```

### `requireProjectAccess()` (`src/api/middleware/authorize.ts`)

Verifies that the authenticated user has access to the project identified by the `:projectId` route parameter. Access is granted through one of two paths:

1. **Workspace-level:** The user is an **owner** or **admin** of the project's parent workspace. In this case, the effective role is `"admin"` and the source is `"workspace"`.
2. **Project-level:** The user is a direct member of the project. The effective role matches their `project_member.role` and the source is `"project"`.

The access resolution logic is implemented in `resolveProjectAccess()` (`src/api/lib/access.ts`), which serves as the single source of truth for project access checks. This function is used by the middleware and can also be called directly from route handlers that need inline authorization (e.g. subtask, comment, and task-group routes).

**Checks:** User is a workspace owner/admin for the project's workspace, or a direct project member.

**PAT binding:** Both halves are enforced against the resolved project — it must belong to `apiToken.workspaceId`, and for a `projectScope: "selected"` token it must appear in `apiToken.projectIds`. The check runs **after** the membership check, and returns the same bare `Forbidden` 403, so the response never distinguishes "outside this token's project list" from "this user has no access".

**Context set:**

| Key | Type | Value |
|---|---|---|
| `projectAccess` | `{ role: ProjectRole; source: "workspace" \| "project" }` | The effective role and whether it was derived from workspace or project membership (typed as `ProjectRole` from `src/shared/types/roles.ts`) |
| `currentProject` | `{ id: string; workspaceId: string }` | The resolved project ID and its parent workspace ID |

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |
| 404 | `{ "error": "Not found", "requestId": "..." }` | Project does not exist |
| 403 | `{ "error": "Forbidden", "requestId": "..." }` | Project exists but user has no access |

**Usage:**

```ts
import { requireProjectAccess } from "../../middleware/authorize";

app.get("/projects/:projectId", requireAuth, requireProjectAccess(), getProject);

app.get(
  "/projects/:projectId/members",
  requireAuth,
  requireProjectAccess(),
  listMembers,
);
```

### `requireProjectRole(...roles)` (`src/api/middleware/authorize.ts`)

Verifies that the authenticated user holds one of the specified effective roles for the project identified by the `:projectId` route parameter. Uses the same two-path access resolution as `requireProjectAccess()`, then additionally checks the effective role against the allowed list.

**Checks:** User has project access (via workspace admin or direct membership) and effective role is in `allowedRoles`.

**PAT binding:** Identical to `requireProjectAccess()` — workspace binding plus selected-project list, applied after the role check.

**Context set:**

| Key | Type | Value |
|---|---|---|
| `projectAccess` | `{ role: ProjectRole; source: "workspace" \| "project" }` | The effective role and whether it was derived from workspace or project membership (typed as `ProjectRole` from `src/shared/types/roles.ts`) |
| `currentProject` | `{ id: string; workspaceId: string }` | The resolved project ID and its parent workspace ID |

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |
| 404 | `{ "error": "Not found", "requestId": "..." }` | Project does not exist |
| 403 | `{ "error": "Forbidden", "requestId": "..." }` | User has no project access, or their effective role is not in the allowed list |

**Usage:**

```ts
import { requireProjectRole } from "../../middleware/authorize";

// Only project admins (or workspace owners/admins) can update a project
app.patch(
  "/projects/:projectId",
  requireAuth,
  requireProjectRole("admin"),
  validateBody(updateProjectSchema),
  updateProject,
);

// Members and admins can create tasks
app.post(
  "/projects/:projectId/tasks",
  requireAuth,
  requireProjectRole("admin", "member"),
  validateBody(createTaskSchema),
  createTask,
);
```

### `requireTaskAccess()` (`src/api/middleware/authorize.ts`)

Resolves the project that owns the task identified by the `:taskId` route parameter, then delegates to the same project-level access logic used by `requireProjectAccess()`. This allows task-scoped routes (e.g. `/tasks/:taskId`) to enforce project access without requiring the client to pass a `projectId`.

**Checks:** Task exists, then user has access to the task's parent project (via workspace admin or direct project membership).

**PAT binding:** Enforced against the project resolved *from the task* — the URL carries only a `:taskId`, so the token's workspace binding and selected-project list must both cover the owning project.

**Context set:**

| Key | Type | Value |
|---|---|---|
| `projectAccess` | `{ role: ProjectRole; source: "workspace" \| "project" }` | The effective role and whether it was derived from workspace or project membership (typed as `ProjectRole` from `src/shared/types/roles.ts`) |
| `currentProject` | `{ id: string; workspaceId: string }` | The resolved project ID and its parent workspace ID |

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |
| 404 | `{ "error": "Not found", "requestId": "..." }` | Task does not exist |
| 403 | `{ "error": "Forbidden", "requestId": "..." }` | Task exists but user has no access to its parent project |

**Usage:**

```ts
import { requireTaskAccess } from "../../middleware/authorize";

app.get("/tasks/:taskId", requireAuth, requireTaskAccess(), getTask);

app.patch(
  "/tasks/:taskId",
  requireAuth,
  requireTaskAccess(),
  validateBody(updateTaskSchema),
  updateTask,
);

app.post(
  "/tasks/:taskId/subtasks",
  requireAuth,
  requireTaskAccess(),
  validateBody(createSubtaskSchema),
  createSubtask,
);
```

### `requireTaskRole(...roles)` (`src/api/middleware/authorize.ts`)

The mutating-endpoint variant of `requireTaskAccess()`. Resolves the task's parent project with the same single JOIN query, then additionally requires the effective project role to be in the allowed list. Use this instead of `requireTaskAccess()` wherever the request writes, so a viewer cannot modify a task they are entitled to read.

**Checks:** Task exists, user has access to its parent project, and the effective role is in `allowedRoles`.

**PAT binding:** Identical to `requireTaskAccess()` — the token's binding is evaluated against the project that owns the task.

**Context set:**

| Key | Type | Value |
|---|---|---|
| `projectAccess` | `{ role: ProjectRole; source: "workspace" \| "project" }` | The effective role and whether it was derived from workspace or project membership |
| `currentProject` | `{ id: string; workspaceId: string }` | The resolved project ID and its parent workspace ID |

**Error responses:**

| Status | Body | Condition |
|---|---|---|
| 401 | `{ "error": "Unauthorized", "requestId": "..." }` | No authenticated user |
| 404 | `{ "error": "Not found", "requestId": "..." }` | Task does not exist |
| 403 | `{ "error": "Forbidden", "requestId": "..." }` | No access to the parent project, effective role not allowed, or the request's PAT is not bound to that project |

**Usage:**

```ts
import { requireTaskRole } from "../../middleware/authorize";

app.post(
  "/tasks/:taskId/duplicate",
  requireAuth,
  requireTaskRole("admin", "member"),
  duplicateTask,
);
```

---

## PAT Scope Middleware

These middleware are **no-ops for cookie-authenticated requests** — they return early when `c.get("apiToken")` is null, so human sessions behave exactly as they did before scopes existed. They supply the token half of `min(token scopes, user role)`; the role half stays with the guards above.

Unlike the authorization guards, the 403 message here names the missing scope. That is deliberate: the caller has already proven possession of a token, and an integration developer needs to know which scope to request. See [API Tokens § Scopes Reference](./api-tokens.md#scopes-reference) for the grammar and the full scope table.

### `requireTokenScope(scope)` (`src/api/middleware/authorize.ts`)

Requires one named scope, whatever the method. Use it where a route's requirement does not follow from its verb.

| Status | Body | Condition |
|---|---|---|
| 403 | `{ "error": "Insufficient scope: requires <scope>", "requestId": "..." }` | PAT present and `scope` not granted |

### `requireReadScopeForResource(resource)` / `requireWriteScopeForResource({ resource, allowDelete })`

Method-driven versions of the same check, mounted once per resource path at the top of a domain's route file so individual handlers never repeat scope wiring:

| Method | `requireReadScopeForResource` | `requireWriteScopeForResource` |
|---|---|---|
| `GET`, `HEAD` | requires `<resource>:read` | no check |
| `OPTIONS` | no check | no check |
| `POST`, `PUT`, `PATCH` | no check | requires `<resource>:write` |
| `DELETE` | no check | requires `<resource>:delete` when `allowDelete: true`, otherwise `<resource>:write` |

The two are mounted together so reads and writes are gated symmetrically:

```ts
const taskReadScope = requireReadScopeForResource("task");
const taskWriteScope = requireWriteScopeForResource({ resource: "task", allowDelete: true });

app.use("/projects/:projectId/tasks", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId", taskReadScope, taskWriteScope);
```

`allowDelete` is set at the mount rather than baked into the middleware because only some resources define a separate `<resource>:delete` scope; the scope table in [API Tokens](./api-tokens.md#scopes-reference) is the authority on which.

### `rejectPatAuth(message?)` (`src/api/middleware/authorize.ts`)

Refuses any request that arrived with a PAT, with a uniform 403. Mount it on surfaces that must never be reachable by machine credentials — the rule being that a machine credential must not be able to obtain a second credential. Current mounts: the PAT management routes themselves, calendar-feed token minting, and the invitation link / listing / accept routes.

Because the policy is one rule but the credential differs per mount, the message is a parameter: a caller refused on an invitation route is told `"API tokens cannot accept invitations"`, not something about token management. Mount it directly after `requireAuth`, before any other middleware consults the request.

| Status | Body | Condition |
|---|---|---|
| 403 | `{ "error": "<message>", "requestId": "..." }` | Request carries a PAT |

---

## PAT Enforcement Inside Handlers

Middleware alone cannot enforce the whole PAT policy, for two reasons:

1. **Workspace-level routes see no project.** `requireWorkspaceMember()` / `requireWorkspaceRole()` know only the `:workspaceId`, yet the handlers behind them read across every project in the workspace (search, dashboards, activity, labels, the workspace task-group list, webhooks).
2. **Some routes have no workspace or project in the URL at all.** The notification feed is keyed by user, so no workspace guard can be mounted on it.

`src/api/middleware/authorize.ts` therefore exports the same policy in shapes a handler can use. They are one policy, not several — the predicate below is the definition, and everything else is that predicate re-expressed for a different call shape.

| Export | Shape | Use when |
|---|---|---|
| `tokenAllowsProject(token, project)` | pure predicate | You want the policy itself. Both halves: the project must belong to the token's workspace, and pass its `projectScope`. No token ⇒ `true`. |
| `enforceTokenProjectBinding(c, project)` | `Response \| null` | A handler resolved project access inline (subtasks, comments, task groups, webhooks). Call it **after** your own membership/role check and return the response if non-null. |
| `tokenProjectAllowList(token)` | `string[] \| null` | You need the selected-project set enumerated. `null` means unrestricted. **Project half only** — the caller must already have established the workspace half. |
| `tokenProjectScopeFilter(c, projectIdColumn)` | Drizzle `SQL \| undefined` | A list query should return fewer rows rather than an error. `undefined` for unrestricted requests, so the SQL for cookie sessions is unchanged; an empty allow-list compiles to a literal `1 = 0` rather than an empty `IN ()`. |
| `tokenWorkspaceScopeFilter(c, workspaceIdColumn)` | Drizzle `SQL \| undefined` | The route cannot mount a workspace guard, so the workspace half has to travel in the `WHERE` clause. Pair it with `tokenProjectScopeFilter` in the same query. |
| `enforceTokenWorkspaceWideAccess(c)` | `Response \| null` | The response is inherently the whole workspace and cannot be honestly narrowed — the workspace export is the canonical case. Refuses `projectScope: "selected"` tokens outright. |

Two rules govern which of these to reach for:

- **Filter where you can, refuse where you must.** An endpoint that can simply return fewer rows should use `tokenProjectScopeFilter`; a narrowed token seeing less is better developer experience than one seeing an error, and it keeps a mis-scoped token's failure mode obvious. Reserve `enforceTokenWorkspaceWideAccess` for output that would be *wrong* if partial — a document whose own envelope claims to be a complete workspace archive.
- **Never enforce half the policy.** The two `*ScopeFilter` helpers are deliberately separate functions rather than one combined filter, so that "apply the filter" cannot quietly mean "apply one half". A route sitting behind a workspace guard already has the workspace half; a route without one must supply it with `tokenWorkspaceScopeFilter` alongside the project half in the same query.

The equivalence between `tokenProjectAllowList` and `tokenAllowsProject` (for projects inside the token's own workspace) is asserted mechanically in `src/api/middleware/authorize.test.ts`, so the enumerable form and the predicate form cannot drift apart unnoticed.
