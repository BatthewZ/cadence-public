# Build & Deploy Scripts

From `package.json`:

| Script                      | Command                                                                      | Purpose                                    |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `bun run dev`               | `concurrently "vite" "wrangler dev"`                                         | Start local dev (Vite + Wrangler)          |
| `bun run build`             | `vite build`                                                                 | Build frontend to `dist/`                  |
| `bun run deploy`            | `wrangler deploy`                                                            | Deploy Worker + assets to Cloudflare       |
| `bun run db:generate`       | `drizzle-kit generate`                                                       | Generate migration SQL from schema changes |
| `bun run db:migrate:local`  | `wrangler d1 migrations apply cadence --local`                               | Apply migrations locally                   |
| `bun run db:migrate:remote` | `wrangler d1 migrations apply cadence --remote`                              | Apply migrations to production             |
| `bun run typecheck`         | `tsc --noEmit -p tsconfig.backend.json && tsc --noEmit -p tsconfig.web.json` | Typecheck backend and frontend             |
| `bun run test`              | `vitest run`                                                                 | Run all tests                              |
