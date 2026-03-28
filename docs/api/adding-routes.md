# How to Add a New API Route

## Step 1: Create Handler Functions

Create `src/api/routes/{domain}/{domain}.handlers.ts`:

```ts
import type { Context } from "hono";
import type { AppEnv } from "../../env";

export function listItems(c: Context<AppEnv>) {
  // Access the authenticated user (may be null if requireAuth is not used)
  const user = c.get("user");

  // Access D1 database
  const db = createDb(c.env.DB);

  // Return JSON response
  return c.json({ items: [] });
}

export async function createItem(c: Context<AppEnv>) {
  // Access validated body (when using validateBody middleware)
  const body = c.req.valid("json" as never);

  // ... create logic

  return c.json({ item: newItem }, 201);
}
```

## Step 2: Create Route Definitions

Create `src/api/routes/{domain}/{domain}.routes.ts`:

```ts
import { Hono } from "hono";

import type { AppEnv } from "../../env";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import { createItemSchema } from "@/shared/schemas/items";
import { listItems, createItem } from "./items.handlers";

const app = new Hono<AppEnv>();

// Public route
app.get("/items", listItems);

// Protected route with validation
app.post("/items", requireAuth, validateBody(createItemSchema), createItem);

export default app;
```

## Step 3: Register in Route Aggregator

Update `src/api/routes/index.ts`:

```ts
import { Hono } from "hono";

import type { AppEnv } from "../env";
import authRoutes from "./auth/auth.routes";
import userRoutes from "./users/users.routes";
import itemRoutes from "./items/items.routes";

const app = new Hono<AppEnv>();

app.route("/", authRoutes);
app.route("/", userRoutes);
app.route("/", itemRoutes);

export default app;
```

## Step 4: Add Rate Limiting (Optional)

If the endpoint needs rate limiting, add it in the route file:

```ts
import { rateLimit } from "../../middleware/rate-limit";

app.use("/items/*", rateLimit({ max: 100, windowSeconds: 60, prefix: "items" }));
```

## Step 5: Add Validation Schema (Optional)

Create `src/shared/schemas/items.ts`:

```ts
import { z } from "zod";

export const createItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
```

This schema can be used by both the backend (`validateBody`) and the frontend (form validation).
