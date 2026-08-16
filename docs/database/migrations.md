# Migration Workflow

| Command                     | Script                                             | Purpose                                                         |
| --------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `bun run db:generate`       | `drizzle-kit generate`                             | Diff schema against migrations and generate new SQL             |
| `bun run db:migrate:local`  | `wrangler d1 migrations apply cadence_au --local`  | Apply pending migrations to the local D1 database               |
| `bun run db:migrate:remote` | `wrangler d1 migrations apply cadence_au --remote` | Apply pending migrations to the remote (production) D1 database |

Migration files are stored in the `migrations/` directory as numbered SQL files (e.g. `0000_many_gunslinger.sql`). These are standard SQL and are applied in order.

### Hand-written migrations

Most migrations are produced by `db:generate`, which also records them in `migrations/meta/_journal.json` alongside a snapshot of the schema. A few are written by hand, because they express something `drizzle-kit` cannot derive by diffing two schemas — a table rebuild it would not sequence safely, or a change to **data** rather than to structure. Those files carry no `_journal.json` entry and leave the snapshot untouched, which is why the file count in `migrations/` runs ahead of the journal:

```bash
ls migrations/*.sql | wc -l                                  # every migration
jq '.entries | length' migrations/meta/_journal.json          # the generated ones
```

`wrangler d1 migrations apply` applies everything in `migrations/` in filename order regardless, so a hand-written file needs no registration — only a number that sorts correctly.

| Migration | Kind | What it does |
| --- | --- | --- |
| `0025_webhook_projectid_cascade` | Schema | Rebuilds `webhook` so `projectId` cascades on project deletion |
| `0026_unique_position_indexes` | Schema + data | Repacks duplicate `position` values, then adds the unique indexes that stop them recurring |
| `0035_backfill_email_verified` | **Data only** | Grandfathers `user.emailVerified` for accounts that predate mandatory verification |
| `0036_normalize_invitation_email` | **Data only** | Canonicalises `invitation.email` to its trimmed, lower-cased form |
| `0037_workspace_policy` | Schema | Adds the nullable `workspace.policy` JSON column for admin-configurable governance toggles |

Every **data-only** migration in this table is idempotent — each `UPDATE` carries a `WHERE` clause that excludes rows already in the target state — so re-application is a no-op. The schema ones are not, and do not need to be: `wrangler d1 migrations apply` records what it has run in the `d1_migrations` table and never re-applies a file. Idempotency matters for the data migrations because their statements are the kind a human might reasonably paste into a console by hand while debugging.

#### `0035_backfill_email_verified` (data only)

A single `UPDATE user SET emailVerified = 1 WHERE emailVerified = 0`. No structural change: the column already existed, and nothing about the table definition moves, so the drizzle snapshot is untouched.

It exists because the same change that added it turned on `requireEmailVerification` in `src/api/lib/auth.ts`. Sign-up had always issued a working session with `emailVerified = 0`, so without the backfill the first deploy would have refused sign-in to **every existing account**, owners included — and with no self-service way back in, since password reset does not clear the flag. The migration asserts something true and narrow: the product never asked these people to prove their address, so it does not hold that against them. Accounts created from this point on go through verification normally.

`updatedAt` is deliberately left alone. It records when the user last changed their own profile, and an administrative backfill is not a profile edit; rewriting it would flatten that signal across every row at once. The migration also cannot *un*-verify anyone — the `WHERE` clause only ever moves rows in one direction. The file's own header comment records the residual risk this grandfathering accepts and why a narrower predicate was considered and rejected; read it before proposing a follow-up.

#### `0036_normalize_invitation_email` (data only)

Two `UPDATE` statements against `invitation`, separated by a `--> statement-breakpoint`. No structural change either: `invitation.email` is the same plain `text` column it has always been, with the same indexes, so the drizzle snapshot is again untouched.

The code half of this fix normalises invited addresses on write (`createInvitationSchema` folds trim + lower-case) and folds both operands at every site that compares an invited address to an account address. That alone is enough for correctness. The migration exists so the *stored* data stops disagreeing with the invariant the schema now advertises — otherwise `invitation.email` would be "canonical, except for rows written before this deploy", and the `(email, status, expiresAt)` index could not be treated as an exact-equality probe without a caveat nobody would remember.

1. **Retire duplicates that folding would reveal.** The duplicate-invitation guard also used to compare byte-for-byte, so one workspace could hold two pending invitations to the same mailbox differing only in case. Folding them would make two indistinguishable pending rows. The newest per (`workspaceId`, folded `email`) survives — newest by `createdAt`, tie-broken by `id` — and the rest are set to `revoked` rather than deleted, because the row is evidence that an admin took an action and `revoked` is the status the product already uses for "retired but happened". The cost is stated plainly in the file: a link for a losing invitation stops working, and the admin's recovery is to re-invite.
2. **Fold every remaining address** to `lower(trim(email))`, across rows of *every* status — not just pending ones. Accepted and revoked rows are read by the workspace export and by anyone auditing who was invited to what, so leaving a mixed-case tail there would mean a search for an address silently misses the history this migration was run to make findable.

`user.email` is explicitly out of scope. Better Auth owns that column and already stores it folded; rewriting an identity column out from under the auth library is a much larger blast radius than this fix needs, and every comparison site now folds the account address at read time anyway.

#### `0037_workspace_policy` (schema)

A single `ALTER TABLE workspace ADD policy text`. Hand-written rather than generated because the reasoning that decides its shape — nullable, no default, never backfilled — is not derivable by diffing two schemas, and it is exactly what a future reader needs before adding toggle #2.

The column holds admin-configurable governance toggles as one JSON object. See [Schema § `workspace`](./schema.md#workspace) for the full rationale; the two decisions that matter to *this file* are:

1. **Nullable with no database default, and nothing backfilled.** `NULL` is the meaningful value: it says "this workspace has never expressed a preference", which `resolveWorkspacePolicy` resolves to every code default. Writing `'{}'` at migration time would behave identically today but would assert that every existing workspace made a choice it never made — and would need a follow-up migration on every future toggle. Absent keys already mean "code default", so a toggle added next year takes effect correctly for every workspace that predates it with no migration at all.
2. **This migration is not idempotent and does not need to be.** SQLite's `ADD COLUMN` has no `IF NOT EXISTS`, so a second run errors. `wrangler d1 migrations apply` never runs it twice — unlike the data-only migrations above, whose statements are the kind someone might paste into a console by hand.

Because no structural change is generated by `drizzle-kit`, the schema definition in `src/db/schema/workspace.ts` and the drizzle snapshot must be kept in step by hand. The column is declared there as `text("policy")`; the typed shape lives in `src/shared/types/workspace-policy.ts` and is never read straight off the row — see the schema doc for why every read goes through `resolveWorkspacePolicy`.

### Typical development cycle

1. Edit or add tables in `src/db/schema/`
2. Run `bun run db:generate` to create the migration
3. Run `bun run db:migrate:local` to apply locally
4. Test your changes with `bun run dev`
5. Before deploying, run `bun run db:migrate:remote` to apply to production
