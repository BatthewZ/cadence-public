# Authentication

## Overview

Authentication is handled by [Better Auth](https://www.better-auth.com/), a TypeScript-first auth library. The project uses email/password authentication with sessions stored in the D1 database. Auth is split across three layers:

1. **Backend**: Better Auth factory, session middleware, auth routes, and auth guard middleware.
2. **Frontend**: Better Auth React client, route guard components, and shared validation schemas.
3. **Shared**: Zod schemas used for both frontend form validation and backend request validation.

## Documentation

- [Configuration](./configuration.md) -- Better Auth setup, configuration options, and per-request auth factory
- [Auth Flows](./flows.md) -- sign up, sign in, sign out, password reset, email verification, session management, and account deletion
- [Rate Limiting](./rate-limiting.md) -- rate limit rules on auth endpoints
- [Middleware](./middleware.md) -- session extraction middleware and auth guard middleware
- [Frontend Auth Client](./client.md) -- Better Auth React client and exported functions
- [Route Guards](./guards.md) -- AuthGuard and GuestGuard React components
- [Validation Schemas](./schemas.md) -- shared Zod schemas for auth forms
- [Database Schema](./database.md) -- auth-related database tables
- [Adding Providers](./adding-providers.md) -- how to add a new auth provider (Google, GitHub, etc.)
- [Environment Variables](./environment.md) -- required environment variables for auth
