# Rate Limiting

Rate limiting is implemented as a Hono middleware in `src/api/middleware/rate-limit.ts`. It uses an **in-memory store** (JavaScript `Map`) scoped to the Worker isolate.

## Configuration

```ts
rateLimit({
  max: 10,           // Maximum requests in the window
  windowSeconds: 60, // Window duration in seconds
  prefix: "auth",    // Namespace for this limiter
  keyFn: (c) => ..., // Optional: custom key extractor (defaults to client IP)
})
```

## How It Works

1. **Key generation**: Each client is identified by `{prefix}:{clientIP}`. The IP is extracted from `cf-connecting-ip` or `x-forwarded-for`.
2. **Window tracking**: Each key has a `count` and `resetAt` timestamp. If the current time is past `resetAt`, the window resets.
3. **Enforcement**: If `count >= max`, the middleware returns a 429 response immediately without calling the next handler.
4. **Cleanup**: Every 100 requests, expired entries are purged from the store.

## Response Headers

Every response (whether rate-limited or not) includes these headers:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed in the window. |
| `X-RateLimit-Remaining` | Remaining requests in the current window. |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets. |

When rate-limited (429), an additional header is set:

| Header | Description |
|---|---|
| `Retry-After` | Seconds until the client can retry. |

## Rate-Limited Response

```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000000
```

```json
{
  "error": "Too many requests",
  "retryAfter": 45
}
```

## Current Rate Limits

| Endpoint | Max | Window | Prefix |
|---|---|---|---|
| `/api/auth/sign-in/*` | 10 | 60s | `auth-signin` |
| `/api/auth/sign-up/*` | 5 | 60s | `auth-signup` |
| `/api/auth/*` (all other) | 30 | 60s | `auth-general` |

## Limitations

The rate limit store is **in-memory per isolate**. In a production Cloudflare Workers environment, requests may be handled by different isolates, so the rate limit is not perfectly global. For stricter rate limiting, consider using Cloudflare's built-in rate limiting rules or a KV/Durable Object-backed store.
