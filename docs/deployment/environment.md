# Environment Variables

### Local development

For local development, the Worker's variables are set in a `.dev.vars` file at the project root (not committed to git) — that is the file `wrangler dev` reads. Copy `.dev.vars.example` and fill it in:

```env
BETTER_AUTH_SECRET=your-local-dev-secret
TOKEN_HASH_PEPPER=your-local-dev-pepper
BETTER_AUTH_URL=http://localhost:8787
```

A `.env.example` is also provided for tooling that reads `.env`; the Worker itself does not.

The local dev server is started with:

```bash
bun run dev
```

This runs both the Vite dev server and `wrangler dev` concurrently, with the API available at `http://localhost:8787`.

### Production

Production secrets are managed via `wrangler secret put`:

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `BETTER_AUTH_SECRET` | Yes | Signing secret for auth tokens. Must be a strong random string (32+ characters). |
| `BETTER_AUTH_URL` | Yes | The base URL of the deployed application (e.g. `https://your-app.workers.dev`). Used for auth callbacks and CORS. |
| `TOKEN_HASH_PEPPER` | If using API tokens or calendar feeds | Strong random string mixed into every Personal Access Token and calendar-feed-token hash. Requests that need it fail with a 500 when it is unset. Rotating it invalidates every existing token — treat rotation as a forced re-mint for every integration. See [API Tokens](../api/api-tokens.md). |
| `TRUSTED_ORIGINS` | No | Comma-separated list of additional trusted origins for CORS. |
| `RESEND_API_KEY` | No | API key for [Resend](https://resend.com) email delivery. Without this, **every** transactional email is logged to the console instead of sent — password reset, email verification, workspace invitations, API-token created/rotated/revoked notices, and the webhook-created notice. |
| `EMAIL_FROM` | No | Sender address for **all** outbound email, not just auth (e.g. `noreply@yourdomain.com`) — see [Email Service § Sender Address](../api/email.md#sender-address) for the full list of senders. Falls back to `noreply@example.com` when unset, empty, or whitespace-only; a blank value is treated as unconfigured on purpose, because a declared-then-cleared secret would otherwise send mail with no sender. When `RESEND_API_KEY` is set and this is not, start-up logs a warning. |
| `UNSPLASH_ACCESS_KEY` | No | Unsplash API access key. Register an app at [unsplash.com/oauth/applications](https://unsplash.com/oauth/applications). When this or `UNSPLASH_SECRET_KEY` is omitted, the Unsplash photo picker is hidden in the UI and `/api/unsplash/*` returns 503 (safe default for mirror / self-hosted installs). |
| `UNSPLASH_SECRET_KEY` | No | Unsplash API secret key, paired with `UNSPLASH_ACCESS_KEY`. |
| `UNSPLASH_APP_NAME` | No | UTM source used on Unsplash attribution links. Defaults to `cadence`. |
| `TELEMETRY_SINK` | No | Telemetry backend override. Values: `console` (structured JSON to stdout), `noop` (discard). When unset, auto-detects the `ANALYTICS` binding or falls back to `console`. |

The D1 database binding (`DB`), R2 storage binding (`STORAGE`), asset binding (`ASSETS`), and optional Analytics Engine binding (`ANALYTICS`) are configured in `wrangler.toml` and do not need separate secret configuration. The `STORAGE` binding is optional -- when absent, upload endpoints return 503. See [File Storage](../api/storage.md) for R2 setup. The `ANALYTICS` binding is optional -- when present, telemetry events are written to Cloudflare Analytics Engine; when absent, telemetry falls back to console logging (see [Telemetry](../api/middleware.md#3-telemetry-srcapimiddlewaretelemetryts)).
