-- Canonicalise `invitation.email` for every row written before invited
-- addresses were normalised on write.
--
-- WHY THIS MIGRATION EXISTS
-- `createInvitationSchema` now folds the invited address with
-- `normalizeEmail` (trim + lowercase) before it is persisted, and the three
-- sites that compare an invited address against an account address —
-- `createInvitation`'s "does this person already have an account?" lookup,
-- `listMyPendingInvitations`, and `acceptInvitation` — all fold both operands
-- the same way. Rows written before that change still hold whatever the
-- inviting admin typed.
--
-- The code change alone is enough for correctness, because every comparison
-- folds at read time too. This migration exists so the *stored* data stops
-- disagreeing with the invariant the schema now advertises: without it,
-- `invitation.email` is "canonical, except for rows older than this deploy",
-- and the index `invitation_email_status_expires_idx` cannot be used for an
-- equality probe on a folded address without a mid-list exception nobody will
-- remember. A single source of truth that holds only for recent rows is not
-- one (CLAUDE.md rule 4).
--
-- THE BUG THIS COMPLETES THE FIX FOR
-- Inviting `Alice@Example.com` stored that exact string. Account addresses are
-- stored lowercased, so the account lookup missed and `alice@example.com`
-- received no `invitation_received` notification; her pending list came back
-- empty because that query compared byte-for-byte. Meanwhile `acceptInvitation`
-- lowercased, so the invitation *would* have worked had she ever been able to
-- see it. Nothing errored anywhere: the admin saw a 201 and a pending row, and
-- the invitee saw nothing at all. With the raw token no longer surfaced in the
-- app, the emailed link was the only remaining route in — so one stray capital
-- letter was enough to strand a new hire behind a bounced or filtered email.
--
-- STEP 1 — RETIRE DUPLICATES THAT ONLY FOLDING WOULD REVEAL
-- `createInvitation` refuses a second pending invitation for the same
-- workspace and address, but that guard also compared byte-for-byte, so
-- `Alice@Example.com` and `alice@example.com` could both be pending in one
-- workspace today. Folding them makes two indistinguishable pending rows for
-- one mailbox. That is not corrupting — accepting either one satisfies the
-- invitee, and the second then fails the already-a-member check with a 400 —
-- but it is confusing in the admin's pending list (two identical entries, one
-- of which can never do anything) and it is the one input that can still reach
-- the concurrent-accept compensation path in `acceptInvitation`. Keep the
-- newest per (workspace, folded address) and revoke the rest.
--
-- `revoked`, not deleted: the row is evidence that an admin performed an
-- action, `invitation.revoked` semantics already exist, and `revokeInvitation`
-- uses exactly this status for "this invitation is retired but happened".
-- Deleting would erase the audit trail to tidy up a display artefact.
--
-- WHAT THE SURVIVOR CHOICE COSTS, STATED PLAINLY
-- The survivor is the newest by `createdAt`, and `createdAt` has one-second
-- resolution — so two invitations created in the same second are separated by
-- `id DESC`, which is UUID order, which is arbitrary. Whichever loses, its
-- token stops working immediately. That matters because a token can have been
-- shared out of band: pasted into a chat by an admin using the copy-link
-- control, or forwarded by the invitee. Someone holding the losing link gets
-- "Invitation is revoked" with no explanation of why.
--
-- Accepted deliberately, because every alternative is worse. Keeping both
-- leaves the admin's pending list showing two identical entries for one
-- mailbox, only one of which can ever work — and it is the one input that can
-- still drive `acceptInvitation` into its rollback path. Keeping the *oldest*
-- would retire the invitation the admin most recently chose to send, which is
-- the opposite of intent. The blast radius is small and bounded: it requires
-- two live invitations to one mailbox in one workspace that differ only in
-- case, which `createInvitation`'s duplicate guard has always tried to
-- prevent and which folding on write now makes impossible to create again.
-- Recovery is one click — the admin re-invites, and the address is canonical
-- from here on.
--
-- ROW_NUMBER() requires SQLite >= 3.25; D1 is well past it (0026 already
-- depends on window functions in this same folder).
UPDATE `invitation`
SET `status` = 'revoked'
WHERE `status` = 'pending'
  AND `id` NOT IN (
    SELECT `id` FROM (
      SELECT
        `id`,
        ROW_NUMBER() OVER (
          PARTITION BY `workspaceId`, lower(trim(`email`))
          ORDER BY `createdAt` DESC, `id` DESC
        ) AS rn
      FROM `invitation`
      WHERE `status` = 'pending'
    )
    WHERE rn = 1
  );
--> statement-breakpoint
-- STEP 2 — FOLD EVERY REMAINING ADDRESS
-- Applied to rows of every status, not just `pending`. Accepted and revoked
-- rows are read by the workspace export and by anyone auditing who was invited
-- to what; leaving a mixed-case tail there would mean an export search for an
-- address silently misses history that this same migration was run to make
-- findable.
--
-- The `WHERE` clause is what makes this idempotent and cheap to re-run: rows
-- already canonical are not rewritten, so a second application is a no-op and
-- `wrangler d1 migrations apply` re-running it can never do harm.
--
-- No `updatedAt` on this table, so there is no modification timestamp to
-- corrupt — unlike 0035, this migration has nothing to deliberately leave
-- alone.
--
-- SCOPE
-- Data only — no schema change, so drizzle-kit's snapshot is untouched and no
-- `meta/_journal.json` entry is generated (the same convention the
-- hand-written 0025, 0026 and 0035 migrations in this folder follow).
--
-- NOT NORMALISED HERE: `user.email`. Better Auth owns that column and already
-- stores it folded, and rewriting an identity column out from under the auth
-- library is a far larger blast radius than this fix needs — every comparison
-- site now folds the account address at read time, which covers any row that
-- somehow is not.
UPDATE `invitation`
SET `email` = lower(trim(`email`))
WHERE `email` <> lower(trim(`email`));
