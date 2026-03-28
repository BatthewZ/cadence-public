# Auth Rate Limiting

Auth routes have rate limits to prevent brute-force attacks. These are applied in `src/api/routes/auth/auth.routes.ts`:

| Endpoint Pattern | Max Requests | Window | Prefix |
|---|---|---|---|
| `/auth/sign-in/*` | 10 | 60 seconds | `auth-signin` |
| `/auth/sign-up/*` | 5 | 60 seconds | `auth-signup` |
| `/auth/*` (all other auth) | 30 | 60 seconds | `auth-general` |

Rate limits are applied **per client IP** (determined from the `cf-connecting-ip` or `x-forwarded-for` header). The more specific limits (`sign-in`, `sign-up`) are applied first, then the general limit applies to all auth endpoints.

When rate-limited, the response is:

```json
{
  "error": "Too many requests",
  "retryAfter": 45
}
```

With headers:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000000
```
