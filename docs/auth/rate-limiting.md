# Auth Rate Limiting

Auth routes have rate limits to prevent brute-force attacks. These are applied in `src/api/routes/auth/auth.routes.ts`:

| Endpoint Pattern | Max Requests | Window | Prefix |
|---|---|---|---|
| `/auth/sign-in/*` | 10 | 60 seconds | `auth-signin` |
| `/auth/sign-up/*` | 5 | 60 seconds | `auth-signup` |
| `/auth/request-password-reset` | 3 | 60 seconds | `auth-password-reset` |
| `/auth/*` (all other auth) | 30 | 60 seconds | `auth-general` |

Rate limits are applied **per client IP** (determined from the `cf-connecting-ip` or `x-forwarded-for` header). The more specific limits (`sign-in`, `sign-up`) are applied first, then the general limit applies to all auth endpoints.

The `auth-signin` limit also caps verification email resends. A sign-in refused with `EMAIL_NOT_VERIFIED` issues a fresh verification link (`emailVerification.sendOnSignIn`), so that resend path is bounded by the same 10-per-60-seconds budget as sign-in itself and needs no separate rule. Password reset keeps its own tighter limit *and* a D1-backed 5-minute cooldown, because that path is reachable without knowing a password — see [Auth Flows § Password Reset](./flows.md#password-reset).

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
