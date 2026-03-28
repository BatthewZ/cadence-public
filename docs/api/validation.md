# Validation Middleware

The project provides validation middleware in `src/api/middleware/validate.ts` that wraps `@hono/zod-validator`.

## `validateBody(schema)`

Validates the JSON request body against a Zod schema. Returns 400 on validation failure.

```ts
import { validateBody } from "../../middleware/validate";
import { createPostSchema } from "@/shared/schemas/posts";

app.post("/posts", validateBody(createPostSchema), createPostHandler);
```

## `validateQuery(schema)`

Validates query parameters against a Zod schema. Returns 400 on validation failure.

```ts
import { validateQuery } from "../../middleware/validate";

app.get("/posts", validateQuery(listPostsQuerySchema), listPostsHandler);
```

## Validation Error Response

When validation fails, the response is:

```json
{
  "error": "Validation failed",
  "details": [
    { "path": "email", "message": "Invalid email" },
    { "path": "password", "message": "String must contain at least 8 character(s)" }
  ]
}
```

The `details` array maps each Zod issue to a `{ path, message }` object, where `path` is the dot-joined path to the invalid field.
