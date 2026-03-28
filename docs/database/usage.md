# Using the Database

## Using the Database in Route Handlers

The D1 database is available as `c.env.DB` in any Hono route handler. To use Drizzle, call the `createDb` factory:

```ts
import { createDb } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../env";

export async function listUsers(c: Context<AppEnv>) {
  const db = createDb(c.env.DB);
  const users = await db.select().from(user);
  return c.json({ users });
}
```

### Environment type chain

The `AppEnv` type (defined in `src/api/env.ts`) wires everything together:

```ts
export type AppBindings = {
  DB: D1Database;              // D1 binding from wrangler.toml
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  TRUSTED_ORIGINS?: string;
  ASSETS: Fetcher;
};

export type AppVariables = AuthVariables & {
  requestId: string;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
```

- `c.env.DB` is the raw D1 binding (type `D1Database`)
- `c.get("user")` and `c.get("session")` are set by the auth session middleware
- `c.get("requestId")` is set by the request ID middleware

### Batching multiple queries

When a handler needs several independent queries, use `db.batch()` to execute them in a single D1 round-trip instead of sequential `await` calls:

```ts
const [tasks, members] = await db.batch([
  db.select().from(task).where(eq(task.projectId, projectId)),
  db.select().from(projectMember).where(eq(projectMember.projectId, projectId)),
] as const);
```

See [Query Examples: Batch](./query-examples.md#batch-multiple-queries) for full usage including SQL aliasing and `.returning()`.

### How Better Auth uses the database

The `createAuth()` factory in `src/api/lib/auth.ts` also uses `createDb`:

```ts
export function createAuth(d1: D1Database, env: AppBindings) {
  return betterAuth({
    database: drizzleAdapter(createDb(d1), {
      provider: "sqlite",
      schema,
    }),
    // ...
  });
}
```
