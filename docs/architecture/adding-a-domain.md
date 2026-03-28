# How to Add a New Domain

This is a full example of adding a "posts" domain to the project.

### Step 1: Database Schema

Create `src/db/schema/posts.ts`:

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const post = sqliteTable("post", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: text("authorId")
    .notNull()
    .references(() => user.id),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});
```

Re-export from `src/db/schema/index.ts`:

```ts
export * from "./auth";
export * from "./posts";
```

Run migrations:

```bash
bun run db:generate
bun run db:migrate:local
```

### Step 2: Shared Validation Schemas

Create `src/shared/schemas/posts.ts`:

```ts
import { z } from "zod";

export const createPostSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  body: z.string().min(1, "Body is required"),
});

export const updatePostSchema = createPostSchema.partial();

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
```

### Step 3: API Route Handlers

Create `src/api/routes/posts/posts.handlers.ts`:

```ts
import type { Context } from "hono";
import { eq } from "drizzle-orm";

import { createDb } from "@/db";
import { post } from "@/db/schema";
import type { AppEnv } from "../../env";

export async function listPosts(c: Context<AppEnv>) {
  const db = createDb(c.env.DB);
  const posts = await db.select().from(post);
  return c.json({ posts });
}

export async function createPost(c: Context<AppEnv>) {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = c.req.valid("json" as never);
  // ... insert logic
  return c.json({ post: newPost }, 201);
}
```

### Step 4: API Route Definitions

Create `src/api/routes/posts/posts.routes.ts`:

```ts
import { Hono } from "hono";

import type { AppEnv } from "../../env";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import { createPostSchema } from "@/shared/schemas/posts";
import { listPosts, createPost } from "./posts.handlers";

const app = new Hono<AppEnv>();

app.get("/posts", listPosts);
app.post("/posts", requireAuth, validateBody(createPostSchema), createPost);

export default app;
```

### Step 5: Register Routes

Update `src/api/routes/index.ts`:

```ts
import { Hono } from "hono";

import type { AppEnv } from "../env";
import authRoutes from "./auth/auth.routes";
import userRoutes from "./users/users.routes";
import postRoutes from "./posts/posts.routes";

const app = new Hono<AppEnv>();

app.route("/", authRoutes);
app.route("/", userRoutes);
app.route("/", postRoutes);

export default app;
```

### Step 6: Frontend Page

Create `src/web/pages/Posts/Posts.tsx`:

```tsx
import { AppLayout } from "@/web/components/layout";

export default function Posts() {
  return (
    <AppLayout>
      <h1>Posts</h1>
      {/* Post list, create form, etc. */}
    </AppLayout>
  );
}
```

### Step 7: Frontend Route

Update `src/web/App.tsx`:

```tsx
const Posts = lazy(() => import("./pages/Posts/Posts"));

// Inside <Routes>:
<Route
  path="/posts"
  element={
    <AuthGuard>
      <Posts />
    </AuthGuard>
  }
/>
```
