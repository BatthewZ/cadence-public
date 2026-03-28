# CORS Configuration

CORS is configured in `src/api/index.ts` using Hono's `cors()` middleware:

```ts
app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const env = c.env as AppBindings;
      return resolveAllowedOrigin(origin, env.BETTER_AUTH_URL, env.TRUSTED_ORIGINS);
    },
    credentials: true,
  })
);
```

The `resolveAllowedOrigin` function (from `src/api/lib/auth.ts`) builds an allow-list from:
1. `BETTER_AUTH_URL` (always allowed)
2. `TRUSTED_ORIGINS` (comma-separated, optional)

If the request's `Origin` header matches an entry in the list, that origin is returned (allowing the request). Otherwise, `null` is returned (blocking the request).

`credentials: true` allows cookies to be sent and received in cross-origin requests, which is required for session-based authentication.

In local development, `BETTER_AUTH_URL` is typically set to `http://localhost:5173` (the Vite dev server), and the Vite dev server proxies `/api` requests to `http://localhost:8787` (the Wrangler dev server), so CORS is generally not an issue.
