# Authentication

## Overview

Authentication is handled by [Better Auth](https://www.better-auth.com/), a TypeScript-first auth library. The project uses email/password authentication with sessions stored in the D1 database. Auth is split across three layers:

1. **Backend**: Better Auth factory, session middleware, auth routes, and auth guard middleware.
2. **Frontend**: Better Auth React client, route guard components, and shared validation schemas.
3. **Shared**: Zod schemas used for both frontend form validation and backend request validation.

Cadence supports **two authentication primitives**:

- **Cookie sessions** for human users in browsers (this document).
- **Personal Access Tokens (PATs)** for machine clients — Slackbots, GitHub Actions, internal tools, AI agents (see [Machine authentication](#machine-authentication) below).

## Documentation

- [Configuration](./configuration.md) -- Better Auth setup, configuration options, and per-request auth factory
- [Auth Flows](./flows.md) -- sign up, sign in, sign out, password reset, email verification, session management, and account deletion
- [Rate Limiting](./rate-limiting.md) -- rate limit rules on auth endpoints
- [Middleware](./middleware.md) -- session extraction middleware and auth guard middleware
- [Frontend Auth Client](./client.md) -- Better Auth React client and exported functions
- [Route Guards](./guards.md) -- AuthGuard, GuestGuard, and TosGuard React components
- [Validation Schemas](./schemas.md) -- shared Zod schemas for auth forms
- [Database Schema](./database.md) -- auth-related database tables
- [Adding Providers](./adding-providers.md) -- how to add a new auth provider (Google, GitHub, etc.)
- [Environment Variables](./environment.md) -- required environment variables for auth

## Machine authentication

Machine clients authenticate with **Personal Access Tokens (PATs)** instead of cookie sessions. PATs are a **distinct subsystem that lives entirely outside Better Auth** — they are not Better Auth `session` rows, they are not produced by the Better Auth `bearer` plugin, and they share no code path with the cookie sign-in flow.

Why a separate subsystem rather than reusing Better Auth's bearer plugin:

- Better Auth's bearer plugin issues **session** tokens — short-lived credentials with the full permissions of the user. PATs are long-lived, scope-restricted, project-restricted, and individually revocable. Mixing the two would muddy the security model and prevent us from enforcing scope checks in middleware.
- PATs need their own lifecycle (rotation with grace window, scheduled auto-revocation, `lastUsedAt` warnings, secret-scanner-friendly prefix) that has no analogue in a Better Auth session.
- Keeping PATs out of the `session` table preserves the invariant that "a session is a browser-style ambient credential" — useful for rate-limit logic, observability, and audit.

The auth middleware (see [API Middleware § Auth Session](../api/middleware.md#7-auth-session-srcapimiddlewareauthts)) checks for `Authorization: Bearer cdn_pat_…` **before** the cookie path. On a successful PAT, it sets the same `c.get("user")` shape as the cookie path, plus `c.get("apiToken")` for downstream PAT-aware middleware (scope checks, project-scope checks, rate limiting, activity attribution). On a failed PAT, it returns `401` immediately — it **never falls back to the cookie path**, which prevents a downgrade attack where an attacker rides a victim's cookie session with a stale Bearer token.

For the full machine auth model — token format, scopes, project scoping, expiry, rotation, revocation, rate limits, and security best practices — see [docs/api/api-tokens.md](../api/api-tokens.md). For end-to-end Slackbot and GitHub Actions walkthroughs, see [docs/api/integrations.md](../api/integrations.md).
