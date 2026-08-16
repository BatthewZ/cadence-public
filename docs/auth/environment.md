# Auth Environment Variables

The following environment variables are required for auth:

| Variable | Required | Description |
|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | Secret key for signing session tokens. Must be a long, random string. |
| `BETTER_AUTH_URL` | Yes | The application's base URL (e.g., `http://localhost:5173` for local dev, `https://example.com` for production). |
| `TRUSTED_ORIGINS` | No | Comma-separated list of additional trusted origins for CORS (e.g., `https://staging.example.com,https://admin.example.com`). |
| `RESEND_API_KEY` | No | API key for the [Resend](https://resend.com) email service. When set, all transactional email (password reset, email verification, workspace invitations) is sent via Resend. When absent, emails are logged to the console instead. |
| `EMAIL_FROM` | No | Sender address for all outbound email — auth *and* workspace invitations (e.g., `noreply@yourdomain.com`). Falls back to `noreply@example.com` when unset, empty, or whitespace-only; a blank value is treated as unconfigured on purpose, because a declared-then-cleared secret would otherwise send mail with no sender. |

### Sender Resolution

Every outbound email resolves its `From:` through a single function, `resolveEmailFrom(env)` in `src/api/lib/email/from.ts` — auth mail, workspace invitations, API-token notices, and the webhook auto-disable notice alike. No call site applies its own `?? "…"` fallback, so a newly added mail sender cannot forget one and post a message with no sender. The transports carry the resolved address as their default too, so a message that omits `from` is still well-formed.

Three consequences worth knowing when configuring a deployment:

- **Blank counts as unset.** `EMAIL_FROM=`, or a Workers secret that was declared and later cleared, resolves to the default exactly as an absent variable does. Whitespace-only values are treated the same way.
- **The start-up warning agrees with the fallback.** `createEmailService` warns when `RESEND_API_KEY` is set but `EMAIL_FROM` is not configured — and it applies the same `.trim()` test, so a whitespace-only value produces the warning rather than passing silently.
- **The default is a reserved domain.** `noreply@example.com` (RFC 2606) can never belong to a real install, so a provider that rejects it is reporting the misconfiguration loudly instead of sending mail from a domain the deployment does not own. Resend will reject it — configure `EMAIL_FROM` with a verified sender before enabling `RESEND_API_KEY`.

Full detail, including which senders route through the resolver, is in [Email Service § Sender Address](../api/email.md#sender-address).

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
