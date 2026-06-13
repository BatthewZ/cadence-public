# Build & Deploy Scripts

From `package.json`:

| Script                      | Command                                                                      | Purpose                                    |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `bun run dev`               | `concurrently "vite" "wrangler dev"`                                         | Start local dev (Vite + Wrangler)          |
| `bun run build`             | `vite build`                                                                 | Build frontend to `dist/`                  |
| `bun run build:worker`      | `wrangler deploy --dry-run --outdir dist-worker`                            | Build the Worker bundle **without deploying** — runs the same esbuild bundle as a real deploy, so it catches worker-only failures that `tsc`/`vitest`/`vite` never see (notably an `@/` path-alias import in worker-reachable code, which esbuild can't resolve and which crashes `wrangler dev`/deploy while every other gate stays green). Output is ignored via `dist-worker/`. |
| `bun run deploy`            | `vite build && wrangler deploy`                                              | Build the frontend, then deploy Worker + assets to Cloudflare |
| `bun run db:generate`       | `drizzle-kit generate`                                                       | Generate migration SQL from schema changes |
| `bun run db:migrate:local`  | `wrangler d1 migrations apply cadence_au --local`                            | Apply migrations locally                   |
| `bun run db:migrate:remote` | `wrangler d1 migrations apply cadence_au --remote`                           | Apply migrations to production             |
| `bun run typecheck`         | `tsc --noEmit -p tsconfig.backend.json && tsc --noEmit -p tsconfig.web.json` | Typecheck backend and frontend             |
| `bun run test`              | `vitest run`                                                                 | Run all tests                              |
| `bun run ci`                | `concurrently … "typecheck:backend" "typecheck:web" "typecheck:tests" "lint" "test" "build && build:worker"` | Full CI gate in parallel: typecheck (backend/web/tests), lint, test, and **both** the frontend (`build`) and Worker (`build:worker`) bundles |
