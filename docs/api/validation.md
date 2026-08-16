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

This is the one error response in the API that does not carry a `requestId`. The hook receives `zValidator`'s generic `Context<Env>`, which is not compatible with the `Context<AppEnv>`-typed `errorResponse()` helper, so it builds the body with `c.json()` directly. See [Error Handling](./error-handling.md).

## Reading validated data in a handler

Handlers are standalone exported functions typed as `Context<AppEnv>`, so Hono cannot propagate the validated-input type through the middleware chain to them. `src/api/lib/validated.ts` bridges that gap:

```ts
import { validJson } from "../../lib/validated";
import { createInvitationSchema } from "@/shared/schemas/invitation";

const body = validJson(c, createInvitationSchema);
```

`validJson(c, schema)` and `validQuery(c, schema)` read what the middleware already parsed. The schema argument is used **only** for type inference — nothing is re-parsed at runtime, so passing a different schema than the route validated with produces a lie the compiler will believe.

They return `z.output<T>`, i.e. the value **after** any `.transform()` on the schema. That is what makes a normalising schema an enforcement point rather than a suggestion: `createInvitationSchema` trims and lowercases the invited email in the schema, so no handler on that route can persist a non-canonical address, whether or not it remembers to normalise. Put a canonicalisation rule in the schema, not in the handler.

## `validationHook`

The underlying hook function is also exported as `validationHook` for use as the `defaultHook` in `OpenAPIHono` instances. This allows `@hono/zod-openapi` route definitions to reuse the same 400-format validation error response without wrapping each route in `validateBody`.

```ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../middleware/validate";

const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
```
