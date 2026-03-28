## Webhook System

Implementation complete. See `swarm/PLAN.md` for the full specification.

### What was built

- **Database**: `webhook` and `webhookDelivery` tables with retry tracking, auto-disable counter
- **25 webhook events** across Task, Project, Workspace, and Invitation domains
- **Dispatch engine**: HMAC-SHA256 signed payloads, 10s fetch timeout, non-blocking via `waitUntil()`
- **Agent-friendly payloads**: Full entity objects with before/after change tracking, workspace/project context
- **SSRF protection**: URL validation blocks private IPs, localhost, metadata endpoints
- **Exponential backoff retries**: 5 attempts over ~2.5 hours, cron-based retry processing
- **Auto-disable**: Webhooks disabled after 10 consecutive failures
- **Delivery retention**: 30-day cleanup + 200-per-webhook cap
- **CRUD API**: 6 endpoints under `/workspaces/:workspaceId/webhooks` (owner/admin only)
- **Frontend**: Full settings page with create/edit/delete, event selector, delivery log, test button
- **Free tier compatible**: Batch sizes tuned for Cloudflare Workers free tier CPU limits
