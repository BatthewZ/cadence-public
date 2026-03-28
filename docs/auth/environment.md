# Auth Environment Variables

The following environment variables are required for auth:

| Variable | Required | Description |
|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | Secret key for signing session tokens. Must be a long, random string. |
| `BETTER_AUTH_URL` | Yes | The application's base URL (e.g., `http://localhost:5173` for local dev, `https://example.com` for production). |
| `TRUSTED_ORIGINS` | No | Comma-separated list of additional trusted origins for CORS (e.g., `https://staging.example.com,https://admin.example.com`). |
| `RESEND_API_KEY` | No | API key for the [Resend](https://resend.com) email service. When set, auth emails (password reset, email verification) are sent via Resend. When absent, emails are logged to the console instead. |
| `EMAIL_FROM` | No | Sender address for auth emails (e.g., `noreply@yourdomain.com`). Defaults to `noreply@example.com`. |

For local development, these are set in `.dev.vars` (gitignored):

```
BETTER_AUTH_SECRET=your-secret-key-here
BETTER_AUTH_URL=http://localhost:5173
# Optional: enable real email sending in dev
# RESEND_API_KEY=re_xxxxxxxxxxxx
# EMAIL_FROM=noreply@yourdomain.com
```

For production, set these as secrets in the Cloudflare dashboard or via Wrangler:

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put BETTER_AUTH_URL
wrangler secret put RESEND_API_KEY
wrangler secret put EMAIL_FROM
```

### Trusted Origins

The `TRUSTED_ORIGINS` variable is parsed by `parseTrustedOrigins()` in `src/api/lib/auth.ts`. It splits the value on commas, trims whitespace, and filters empty strings. These origins are added to Better Auth's `trustedOrigins` array and are also used by the CORS middleware via `resolveAllowedOrigin()`.

The `resolveAllowedOrigin()` function builds an allow-list from `BETTER_AUTH_URL` plus any `TRUSTED_ORIGINS`, and returns the origin if it is in the list or `null` if it is not. This is used as the CORS `origin` callback.
