# Auth Middleware

There are two separate middleware for auth, serving different purposes.

### Session Extraction Middleware (`src/api/middleware/auth.ts`)

This middleware runs on **every** `/api/*` request. It extracts the session from the request cookies and sets `user` and `session` on the Hono context. If no valid session exists, it sets both to `null`.

```ts
export const authSessionMiddleware = createMiddleware<{
  Bindings: AppBindings;
  Variables: AuthVariables;
}>(async (c, next) => {
  const auth = createAuth(c.env.DB, c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
});
```

This middleware **does not block unauthenticated requests**. It simply makes the user/session data available to downstream handlers. Routes that need to be public (like `/api/health`) can still access `c.get("user")` but will get `null`.

### Auth Guard Middleware (`src/api/middleware/require-auth.ts`)

This middleware **blocks unauthenticated requests** by returning a 401 if no user is present. It is applied per-route, not globally.

```ts
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};
```

Usage example (from `src/api/routes/users/users.routes.ts`):

```ts
const app = new Hono<AppEnv>();
app.use("/*", requireAuth);  // All routes in this module require auth
app.get("/me", getMe);
```

### Project Access Resolution (`src/api/lib/access.ts`)

The `resolveProjectAccess()` function is the single source of truth for determining whether a user has access to a project. It is used by the authorization middleware (`requireProjectAccess`, `requireProjectRole`, `requireTaskAccess` in `src/api/middleware/authorize.ts`) and can also be called directly from route handlers that need inline authorization without going through middleware (e.g. subtask, comment, and task-group routes).

See the [API middleware docs](../api/middleware.md#requireprojectaccess-srcapimiddlewareauthorizets) for the full access resolution rules.
