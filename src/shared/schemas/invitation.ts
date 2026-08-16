import { z } from "zod";

import { WORKSPACE_ROLES } from "../types/roles";

/**
 * Canonical form of an email address for identity comparison.
 *
 * ## Why this exists — the bug it closes
 *
 * An invited address and an account address are compared in three places, and
 * before this helper each one picked its own rule:
 *
 * | Site | Old comparison |
 * | --- | --- |
 * | `createInvitation`'s "does this invitee already have an account?" lookup | case-SENSITIVE `eq(user.email, body.email)` |
 * | `listMyPendingInvitations` | case-SENSITIVE `eq(invitation.email, user.email)` |
 * | `acceptInvitation` | case-INSENSITIVE `.toLowerCase()` on both sides |
 *
 * Account addresses land in the `user` table lowercased, and nothing
 * normalised the *invited* address on write. So inviting `Alice@Example.com`
 * stored that string verbatim, and then:
 *
 *   - the account lookup missed, so `alice@example.com` — who has an account —
 *     was treated as a stranger and got **no `invitation_received`
 *     notification**;
 *   - her pending list came back **empty**, because the row's email did not
 *     match her account's byte for byte;
 *   - yet `acceptInvitation` would have accepted her, because that one site
 *     lowercased.
 *
 * The inconsistency is what made it silent. Nothing errored: the admin saw a
 * 201 and a pending row, the invitee saw nothing at all, and the two views
 * disagreed with no signal that they did. Since the token stopped being
 * returned in-app, the emailed link is the invitee's only remaining route in,
 * so a mistyped capital letter was enough to strand a new hire behind a
 * bounced or filtered email with no in-app fallback.
 *
 * ## Why lowercase-and-trim specifically
 *
 * Trim first: a trailing space pasted out of a spreadsheet or a chat message
 * is the single most common way an address arrives malformed, and it is
 * invisible in the members list afterwards. Lowercase second: the local part
 * of an address is case-sensitive per RFC 5321, but no mail provider in
 * practical use treats it as such, and `user.email` is already stored folded —
 * so folding here makes the invited address agree with the identity it will be
 * compared against, which is the only property that matters. Deliberately NOT
 * done: stripping `+tag` suffixes or Gmail's dots. Those are provider-specific
 * policies, and collapsing them would let one address claim an invitation
 * addressed to a different mailbox — the opposite of what this is for.
 *
 * Applied on write via {@link createInvitationSchema}, so every stored
 * `invitation.email` is already canonical, and on read at each comparison site
 * so that rows predating `migrations/0036_normalize_invitation_email.sql`
 * cannot resurrect the mismatch.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const createInvitationSchema = z.object({
  // `.trim()` runs before `.email()` so that a pasted "  a@b.com " validates
  // instead of being rejected for the whitespace, and the transform then folds
  // case. The transform is on the schema rather than in the handler so that it
  // is impossible to persist a non-canonical address through this route:
  // `validJson` hands the handler `z.output`, i.e. the normalised value.
  email: z.string().trim().email().transform(normalizeEmail),
  role: z
    .enum(WORKSPACE_ROLES)
    .refine((val) => val !== "owner", { message: "Cannot invite as owner" })
    .optional(),
});

/**
 * An invitation is accepted through exactly one of two selectors.
 *
 * - `token` — the secret carried by the emailed `/invite/:token` link. It is
 *   the only selector available to someone who has not signed in yet, so it
 *   must keep working forever.
 * - `invitationId` — the non-secret row id, used by the in-app pending list.
 *
 * Why the id selector exists: the pending list used to hand the raw `token`
 * to any session whose account email matched the invitation (audit finding
 * 04). That turned a read endpoint into a credential dispenser — an
 * over-shared API response, a proxy log or a cache entry was enough to hand
 * someone a working invite. A signed-in invitee does not need the secret: the
 * server already knows who they are and can authorise on the session's
 * (now verified) email instead. The id is therefore an *identifier*, never a
 * capability — {@link acceptInvitation} re-runs every check on the id path
 * (email match, pending status, expiry) exactly as it does on the token path.
 *
 * Exactly one selector is required. Accepting both would leave the server
 * choosing which one to trust, and "whichever wins" is precisely the kind of
 * ambiguity that becomes a confused-deputy bug later.
 */
export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1, "Token is required").optional(),
    invitationId: z.string().min(1, "Invitation id is required").optional(),
  })
  .refine(
    (value) => (value.token === undefined) !== (value.invitationId === undefined),
    { message: "Provide exactly one of token or invitationId" },
  );

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
