# Redeploying

After making code changes:

```bash
bun run build              # Rebuild frontend
bun run db:migrate:remote  # Apply any pending migrations — always run this
bun run deploy             # Deploy
```

Run all three steps, in this order, every time.

## Why the migration step is not optional

This page used to say you could skip `db:migrate:remote` when no schema
changed. That advice was unsafe, because **not every migration changes the
schema**. `migrations/` also holds data-only migrations — backfills that
populate a column for rows that predate a new rule. To a reader diffing the
code, such a change looks exactly like "backend code only".

The failure mode is severe and silent. A backfill that grandfathers existing
users into a newly-enforced constraint is worthless if the code ships without
it: the constraint applies to everyone, the backfill that was supposed to
exempt them never ran, and every existing account is locked out at once —
including the owner's, so there is no in-app route back. `bun run deploy` is
`vite build && wrangler deploy`; it does **not** apply migrations, so nothing
downstream catches the omission.

Two such migrations ship in this repository, and they are the concrete case
the paragraph above describes:

- **`migrations/0035_backfill_email_verified.sql`** — marks every account
  created before email verification became mandatory as verified. Sign-in now
  refuses unverified accounts, so deploying that rule without this backfill
  signs out every existing user, workspace owners included, with no
  self-service way back in.
- **`migrations/0036_normalize_invitation_email.sql`** — folds stored
  invitation addresses to their canonical (trimmed, lowercased) form, matching
  how they are now written and compared. Without it, invitations created before
  the change stay invisible to the person they were sent to.

Neither touches the schema. Both are idempotent — their `WHERE` clauses
exclude rows already in the target state — so re-running them does nothing.

Always running the command costs nothing. `wrangler d1 migrations apply`
compares `migrations/` against the `d1_migrations` table and applies only what
is missing, so on a no-op deploy it exits having done nothing. Skipping it is
the only way to get this wrong.

Hand-written data-only migrations carry no `meta/_journal.json` entry (they
change no schema, so drizzle-kit generates nothing for them) — which is another
reason not to judge "is there anything to migrate?" from the diff. Ask
`wrangler`; it is cheap and it is right.

## Local development

The same applies locally — `bun run dev` does not apply migrations either:

```bash
bun run db:migrate:local
```

Run it after pulling changes that add a migration. If sign-in starts failing
for accounts that worked yesterday, an unapplied backfill is the first thing
to check.

## Frontend-only changes

If only frontend code changed, the build step is still required, since the
Worker serves the built assets.
