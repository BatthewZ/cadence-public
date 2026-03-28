# Cadence

A project management application built on Cloudflare Workers. Organize work with workspaces, projects, kanban boards, and task management. Features team collaboration with invitations, role-based access control, drag-and-drop task boards, multiple project views (board, list, timeline), and outbound webhooks for integrating with external systems.

Read the [project philosophy](docs/ethos.md) to understand the principles behind Cadence.

> **Note:** This is a personal project. It is shared publicly so anyone can explore the code, learn from it, or fork it for their own use. It is not accepting external contributions or pull requests.

## Tech Stack

| Layer        | Technology                                                                  |
| ------------ | --------------------------------------------------------------------------- |
| Runtime      | [Cloudflare Workers](https://workers.cloudflare.com/)                       |
| API          | [Hono](https://hono.dev/)                                                   |
| Frontend     | [React 19](https://react.dev/) + [React Router](https://reactrouter.com/)   |
| Styling      | [Tailwind CSS v4](https://tailwindcss.com/) with CSS custom property tokens |
| Database     | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite)             |
| ORM          | [Drizzle ORM](https://orm.drizzle.team/)                                    |
| Auth         | [Better Auth](https://www.better-auth.com/) (email/password)                |
| Drag & Drop  | [dnd-kit](https://dndkit.com/)                                              |
| Validation   | [Zod](https://zod.dev/) (shared between frontend and backend)               |
| Icons        | [Lucide React](https://lucide.dev/icons/)                                   |
| Testing      | [Vitest](https://vitest.dev/) + Testing Library                             |
| Package Mgr  | [Bun](https://bun.sh/)                                                      |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (package manager)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (Cloudflare Workers tooling)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)

### Local Development

```bash
# Clone the repo
git clone <your-repo-url>
cd cadence

# Install dependencies
bun install

# Authenticate with Cloudflare (required for local D1 database)
wrangler login

# Create local environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars and replace the BETTER_AUTH_SECRET with a random string:
# openssl rand -base64 32

# Generate and apply database migrations
bun run db:generate
bun run db:migrate:local

# Start the dev server
bun run dev
```

The app runs at `http://localhost:8787` or `http://localhost:5173` for hot module reloading.

### Deployment

For deploying to Cloudflare Workers, see the [Deployment Guide](docs/deployment/guide.md). You'll need to create a D1 database, set production secrets, and run `bun run deploy`.

For more on Cloudflare Workers and D1, see the official docs:
- [Cloudflare Workers — Get Started](https://developers.cloudflare.com/workers/get-started/guide/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)

## Documentation

| Topic | Description |
|---|---|
| [Architecture](docs/architecture/architecture.md) | Worker architecture, request flow, folder structure, routing |
| [API](docs/api/api.md) | Endpoints, middleware, error handling, validation |
| [Webhooks](docs/api/webhooks.md) | Event types, payload format, HMAC signing, retries, dev mode |
| [Auth](docs/auth/auth.md) | Better Auth setup, auth flows, middleware, route guards, schemas |
| [Database](docs/database/database.md) | D1 + Drizzle ORM setup, schema, migrations, query examples |
| [Design System](docs/design-system/design-system.md) | Tokens, colors, typography, spacing, theming, motion |
| [UI Components](docs/ui/ui.md) | Layout, UI primitives, display components, forms, animations |
| [User Guide](docs/guides/user-guide.md) | Features, navigation, tasks, projects, teams, webhooks, shortcuts |
| [Testing](docs/guides/tests.md) | Writing and running tests, important rules, visual testing |
| [Deployment](docs/deployment/deployment.md) | Prerequisites, step-by-step guide, environment, custom domains |

## License

[MIT](LICENSE)
