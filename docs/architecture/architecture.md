# Architecture

## Overview

Cadence is a full-stack application served from a **single Cloudflare Worker**. The Worker runs a Hono API for backend logic and serves a React single-page application (SPA) for the frontend. Both are deployed as one unit -- there is no separate API server or static hosting service.

The stack:

- **Runtime**: Cloudflare Workers
- **API framework**: Hono
- **Frontend**: React 19 + React Router + Tailwind CSS v4
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Auth**: Better Auth (email/password)
- **Validation**: Zod (shared between frontend and backend)
- **Package manager**: Bun

## Documentation

- [Worker Architecture](./worker.md) -- single Worker setup, `run_worker_first`, and request flow
- [Per-Request Auth Factory](./auth-factory.md) -- how auth instances are created per-request in Workers
- [TypeScript Configuration](./typescript-config.md) -- dual tsconfig setup and the `@/` path alias
- [Folder Structure](./folder-structure.md) -- domain-driven folder organization and conventions
- [How to Add a New Domain](./adding-a-domain.md) -- step-by-step guide for adding a new domain
- [Frontend Routing](./routing.md) -- lazy loading, route guards, and page transitions
- [API Middleware & Authorization](../api/middleware.md) -- the global middleware stack and its order, the per-route workspace/project/task guards, and where API-token binding and scopes are enforced
