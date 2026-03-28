# Environment Variables

### Local development

For local development, environment variables are set in a `.env` file at the project root (not committed to git):

```env
BETTER_AUTH_SECRET=your-local-dev-secret
BETTER_AUTH_URL=http://localhost:8787
```

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
| `TRUSTED_ORIGINS` | No | Comma-separated list of additional trusted origins for CORS. |
| `RESEND_API_KEY` | No | API key for [Resend](https://resend.com) email delivery. Without this, auth emails are logged to the console. |
| `EMAIL_FROM` | No | Sender address for auth emails (e.g. `noreply@yourdomain.com`). Defaults to `noreply@example.com`. |

The D1 database binding (`DB`), R2 storage binding (`STORAGE`), and asset binding (`ASSETS`) are configured in `wrangler.toml` and do not need separate secret configuration. The `STORAGE` binding is optional -- when absent, upload endpoints return 503. See [File Storage](../api/storage.md) for R2 setup.
