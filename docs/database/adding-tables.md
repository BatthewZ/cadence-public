# How to Add a New Table

### Step 1: Define the table

Create a new file in `src/db/schema/` (e.g. `src/db/schema/posts.ts`):

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const post = sqliteTable("post", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  authorId: text("authorId")
    .notNull()
    .references(() => user.id),
  published: integer("published", { mode: "boolean" }).default(false),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});
```

### Step 2: Export from the barrel file

Add the re-export to `src/db/schema/index.ts`:

```ts
export * from "./auth";
export * from "./posts";
```

### Step 3: Generate the migration

```bash
bun run db:generate
```

This invokes `drizzle-kit generate` and produces a new SQL file in the `migrations/` directory.

### Step 4: Apply the migration locally

```bash
bun run db:migrate:local
```

### Step 5: Apply the migration to production

```bash
bun run db:migrate:remote
```
