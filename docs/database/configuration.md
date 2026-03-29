# Configuration

## Architecture Overview

```
wrangler.toml          -- D1 binding configuration
drizzle.config.ts      -- Drizzle Kit configuration (dialect, schema path, migration output)
src/db/schema/         -- Table definitions (Drizzle SQLite schema)
src/db/index.ts        -- createDb() factory function
migrations/            -- Generated SQL migration files
```

The database is accessed through a **factory pattern**: since D1 is only available inside a Cloudflare Workers request context (as an environment binding), the Drizzle client is instantiated per-request rather than as a global singleton.

---

## Configuration Files

### `drizzle.config.ts`

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema",
  out: "./migrations",
});
```

| Option    | Value               | Purpose                                         |
| --------- | ------------------- | ----------------------------------------------- |
| `dialect` | `"sqlite"`          | D1 is SQLite-based                              |
| `schema`  | `"./src/db/schema"` | Directory containing Drizzle table definitions  |
| `out`     | `"./migrations"`    | Where generated SQL migration files are written |

### `wrangler.toml` (D1 section)

```toml
[[d1_databases]]
binding = "DB"
database_name = "cadence"
database_id = "placeholder"
```

| Field           | Purpose                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `binding`       | The name used to access the database in Workers (`env.DB`)                                                       |
| `database_name` | The human-readable D1 database name (used in migration commands)                                                 |
| `database_id`   | The UUID of the D1 database in your Cloudflare account (replace `"placeholder"` with the real ID after creation) |

---

## The `createDb` Factory

**File:** `src/db/index.ts`

```ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
```

**Why a factory?** Cloudflare Workers provide the D1 binding (`env.DB`) only at request time. There is no global database connection. Every request creates a fresh Drizzle instance by calling `createDb(env.DB)`.

The `schema` import passes all table definitions to Drizzle, enabling the relational query API (`db.query.user.findMany()`).

The exported `Database` type can be used to type function parameters that accept the Drizzle instance.
