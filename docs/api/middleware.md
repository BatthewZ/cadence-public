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
3. securityHeadersMiddleware -- sets security response headers
  |
  v
4. DB singleton            -- creates a single Drizzle DB instance per request
  |
  v
5. CORS                    -- validates origin, sets CORS headers
  |
  v
6. authSessionMiddleware   -- extracts user/session from cookies (skips DB when no credentials)
  |
  v
Route Handler (or 404 catch-all)
  |
  v
Response
```

This is registered in `src/api/index.ts`:

```ts
app.use("/api/*", requestIdMiddleware);
app.use("/api/*", requestLogger);
app.use("/api/*", securityHeadersMiddleware);
app.use("/api/*", async (c, next) => { c.set("db", createDb(c.env.DB)); await next(); });
app.use("/api/*", cors({ ... }));
app.use("/api/*", authSessionMiddleware);
```

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

### 3. Security Headers (`src/api/middleware/security-headers.ts`)

Sets security-related response headers on all API responses. These headers are applied **after** `await next()`, so they are set on the final response.

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing. |
| `X-Frame-Options` | `DENY` | Prevents the page from being embedded in iframes. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer information sent with requests. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables camera, microphone, and geolocation APIs. |
| `X-XSS-Protection` | `0` | Disables the legacy XSS filter (modern CSP is preferred). |
| `Content-Security-Policy` | See below | Controls which resources can be loaded. |

**CSP directives**:

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

### 4. DB Singleton (inline in `src/api/index.ts`)

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

### 5. CORS

CORS is configured using Hono's built-in `cors()` middleware. See [CORS](./cors.md) for full details.

### 6. Auth Session (`src/api/middleware/auth.ts`)

Extracts the user session from cookies on every request. Sets `c.get("user")` and `c.get("session")` -- either with valid session data or `null`. Does not block unauthenticated requests. See the [Auth documentation](../auth/auth.md) for details.

**Early exit optimization:** When neither a `cookie` header nor an `authorization` header is present on the request, the middleware sets both context values to `null` and skips the `getSession()` DB call entirely. This avoids unnecessary database round-trips for unauthenticated preflight and public requests.

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

**Current usage** (max-age values):

| Endpoint group | max-age | Rationale |
|---|---|---|
| Workspaces (list, detail, members) | 300s (5 min) | Rarely changes |
| Projects (list, detail) | 300s (5 min) | Rarely changes |
| Project labels | 300s (5 min) | Rarely changes |
| Task groups | 300s (5 min) | Rarely changes |
| Task detail, subtasks | 30s | Changes more frequently |

---

## Authorization Middleware

The authorization middleware is applied **per-route**, not globally. These functions live in `src/api/middleware/require-auth.ts` and `src/api/middleware/authorize.ts` and are used in route definitions to enforce authentication, workspace membership, project access, and role requirements.

All authorization middleware depends on `authSessionMiddleware` having run first (it reads `c.get("user")`). If no authenticated user is present, every function below returns `401 Unauthorized` immediately.

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

### `requireProjectAccess()` (`src/api/middleware/authorize.ts`)

Verifies that the authenticated user has access to the project identified by the `:projectId` route parameter. Access is granted through one of two paths:

1. **Workspace-level:** The user is an **owner** or **admin** of the project's parent workspace. In this case, the effective role is `"admin"` and the source is `"workspace"`.
2. **Project-level:** The user is a direct member of the project. The effective role matches their `project_member.role` and the source is `"project"`.

The access resolution logic is implemented in `resolveProjectAccess()` (`src/api/lib/access.ts`), which serves as the single source of truth for project access checks. This function is used by the middleware and can also be called directly from route handlers that need inline authorization (e.g. subtask, comment, and task-group routes).

**Checks:** User is a workspace owner/admin for the project's workspace, or a direct project member.

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
