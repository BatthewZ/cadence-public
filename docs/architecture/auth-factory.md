# Cached Auth Factory

## Cached Auth Factory Pattern

### The Problem

Cloudflare Workers provide bindings (D1, KV, R2, etc.) through the request context -- they are **not available at module scope**. This means you cannot create a singleton auth instance at import time:

```ts
// THIS DOES NOT WORK in Workers
import { betterAuth } from "better-auth";
const auth = betterAuth({ database: db }); // db is not available yet
```

The D1 database binding (`c.env.DB`) only exists inside a request handler, after the Worker receives a request.

### The Solution

The project uses a **factory function with module-scoped caching**. The first call creates the Better Auth instance and caches it; subsequent calls within the same isolate return the cached instance:

```ts
// src/api/lib/auth.ts
let cachedAuth: ReturnType<typeof betterAuth> | null = null;
let cachedSecret: string | null = null;

export function createAuth(env: AppBindings) {
  if (cachedAuth && cachedSecret === env.BETTER_AUTH_SECRET) {
    return cachedAuth;
  }

  const db = createDb(env.DB);
  const emailService = createEmailService(env);

  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, sendResetPassword: /* ... */ },
    emailVerification: { sendVerificationEmail: /* ... */ },
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // ...
  });

  cachedAuth = auth;
  cachedSecret = env.BETTER_AUTH_SECRET;
  return auth;
}
```

This pattern is used in two places:

1. **Session middleware** (`src/api/middleware/auth.ts`) -- creates auth to extract the session from cookies on every `/api/*` request.
2. **Auth routes** (`src/api/routes/auth/auth.routes.ts`) -- creates auth to delegate sign-in/sign-up/etc. to Better Auth's handler.

Both call `createAuth(c.env)` inside a request handler where `c.env` is available.

### Why Caching Is Safe

Within a single Cloudflare Workers isolate, env bindings (D1, secrets, etc.) are stable -- every request receives the same object references. The cache is keyed on `BETTER_AUTH_SECRET` so that if an isolate is somehow reused across deployments with different config, the instance is recreated. When the isolate is recycled, module-level state resets naturally.

### CORS Origin Caching

The `resolveAllowedOrigin()` function similarly caches its parsed `Set<string>` of allowed origins to avoid re-parsing the `TRUSTED_ORIGINS` environment variable string on every request.

### Testing

A `resetAuthCache()` function is exported for tests so each test case gets a fresh instance and module-level state doesn't leak between test cases.
