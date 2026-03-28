# Migration Workflow

| Command                     | Script                                             | Purpose                                                         |
| --------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `bun run db:generate`       | `drizzle-kit generate`                             | Diff schema against migrations and generate new SQL             |
| `bun run db:migrate:local`  | `wrangler d1 migrations apply cadence_au --local`  | Apply pending migrations to the local D1 database               |
| `bun run db:migrate:remote` | `wrangler d1 migrations apply cadence_au --remote` | Apply pending migrations to the remote (production) D1 database |

Migration files are stored in the `migrations/` directory as numbered SQL files (e.g. `0000_many_gunslinger.sql`). These are standard SQL and are applied in order.

### Typical development cycle

1. Edit or add tables in `src/db/schema/`
2. Run `bun run db:generate` to create the migration
3. Run `bun run db:migrate:local` to apply locally
4. Test your changes with `bun run dev`
5. Before deploying, run `bun run db:migrate:remote` to apply to production
