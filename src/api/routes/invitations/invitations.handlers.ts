import { and, eq, gt, sql } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { invitation } from "../../../db/schema/invitation";
import { workspace, workspaceMember } from "../../../db/schema/workspace";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  normalizeEmail,
} from "../../../shared/schemas/invitation";
import type { AppBindings, AppEnv } from "../../env";
import { deferWork } from "../../lib/defer";
import { createEmailService } from "../../lib/email";
// From the leaf module, not the `./email` barrel: the invitation tests replace
// the barrel wholesale with a `createEmailService`-only stub, so importing the
// sender resolver through it would yield `undefined` under test — silently
// restoring the missing-`EMAIL_FROM` bug the resolver exists to prevent, in
// exactly the tests meant to catch it.
import { resolveEmailFrom } from "../../lib/email/from";
import { workspaceInvitationEmail } from "../../lib/email/templates/workspace-invitation";
import { errorResponse, throwWithContext } from "../../lib/error-response";
import { createNotification } from "../../lib/notifications";
import { requireParam, requireParams } from "../../lib/params";
import { validJson } from "../../lib/validated";
import {
  buildInvitationEventData,
  buildMemberEventData,
  fireWebhookEvent,
} from "../../lib/webhook-payloads";
import { mayGrantAdmin } from "../../lib/workspace-roles";

// ---------------------------------------------------------------------------
// Token handling policy
// ---------------------------------------------------------------------------
//
// The invitation `token` is a bearer credential: whoever holds it can, after
// signing in with the invited address, join the workspace. Audit finding 04
// found it being returned from two list endpoints, which made every cache,
// proxy log and over-shared JSON body a distribution channel for it.
//
// The rule this module now enforces: a raw token leaves the server through
// exactly two doors —
//   1. the invitation email, addressed to the invited mailbox; and
//   2. `getInvitationLink`, a deliberate, per-invitation, admin-gated fetch
//      that exists so a workspace admin can recover the link when mail
//      bounces (audit finding 03's permanent fallback). Its route mounts
//      `rejectPatAuth()` — a machine credential must not be able to harvest
//      another credential, and the scope machinery cannot enforce that here
//      (write-scope middleware no-ops on GET, and v1 has no
//      `invitation:read` scope to require instead).
// Nothing else — not `createInvitation`'s 201 body, not `listInvitations`,
// not `listMyPendingInvitations` — may include it. `INVITATION_PUBLIC_COLUMNS`
// is the single projection that guarantees this: select through it rather
// than `db.select()` so that adding a column to the table can never silently
// widen a response.
//
// ---------------------------------------------------------------------------
// Token hashing at rest — considered, deliberately DEFERRED
// ---------------------------------------------------------------------------
//
// `invitation.token` is still stored and compared in plaintext, so a database
// backup leak yields directly usable tokens. That is a real gap and it is not
// being papered over; what follows is why it was not closed in the same change
// as the seven fixes above, and exactly what closing it costs.
//
// ## What it would take (the plan, so the next person does not re-derive it)
//
// Reuse `src/api/lib/api-tokens.ts` — `mintToken(prefix, pepper)` +
// `hashToken(plaintext, pepper)` + `requireTokenHashPepper` — exactly as
// `calendar_feed_token` does. Do NOT invent a second scheme (CLAUDE.md rule 4).
// Concretely: a migration that drops `invitation_token_unique`, adds a nullable
// `tokenHash`, revokes every still-pending invitation (a digest cannot be
// reversed, so in-flight links cannot be carried across), drops `token`, and
// creates `invitation_tokenHash_unique`. Then `createInvitation` mints and
// stores the digest, `getInvitation` and `acceptInvitation` hash-then-look-up,
// and `getInvitationLink` becomes rotate-and-return.
//
// ## Why not now
//
//  1. `getInvitationLink` cannot stay a GET. Under hashing it must mint a new
//     token to have anything to return, and a GET that mutates is not a
//     pedantic complaint here: the members page fetches this through React
//     Query, so an ordinary refetch — window focus, a retry — would silently
//     invalidate a link the admin had already pasted into a chat. Doing this
//     properly means turning the route into a POST and updating
//     `src/web/pages/WorkspaceSettings/WorkspaceMembers.tsx` with it.
//  2. It invalidates every in-flight invitation on deploy, and the client
//     copes badly: `src/web/hooks/use-invitation-actions.ts` registers no
//     `onError`, so an invitee clicking Accept on a now-dead invitation gets a
//     spinner that stops and nothing else — no toast, no message, and the stale
//     row stays in the list. That needs fixing FIRST or the migration turns a
//     security improvement into a silent dead end for exactly the people this
//     subsystem exists to onboard.
//  3. The risk is materially smaller than for the credentials that already use
//     this pattern. A PAT or a calendar-feed token is sufficient on its own. An
//     invitation token is not: `acceptInvitation` still requires a session
//     whose *verified* email matches the invited address, the token expires in
//     seven days, and it is single-use. Entropy is not the issue either
//     (UUIDv4, ~122 bits, not enumerable).
//  4. It is the only change in this area needing a destructive schema migration
//     (index drop, column drop). Landing that beside seven behavioural fixes
//     multiplies the blast radius of any one of them being wrong.
//
// Sequence when picking this up: (a) add the missing `onError` handling to the
// accept mutation, (b) convert the link route to POST end to end, (c) then the
// hashing migration. Steps (a) and (b) are independently useful and carry none
// of the migration's risk.

const INVITATION_PUBLIC_COLUMNS = {
  id: invitation.id,
  workspaceId: invitation.workspaceId,
  email: invitation.email,
  role: invitation.role,
  invitedBy: invitation.invitedBy,
  status: invitation.status,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  createdAt: invitation.createdAt,
} as const;

/**
 * Strip the bearer token from an invitation row before it goes over the wire.
 *
 * The return type is `Omit<InvitationRow, "token">` on purpose: adding a
 * column to the `invitation` table then fails to compile here until someone
 * decides whether it is safe to publish, which is the same guarantee
 * `INVITATION_PUBLIC_COLUMNS` gives the queries. Keep the two in step.
 */
function toPublicInvitation(
  row: typeof invitation.$inferSelect,
): Omit<typeof invitation.$inferSelect, "token"> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy,
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Compose the absolute URL of the web `/invite/:token` route.
 *
 * `BETTER_AUTH_URL` is the app's canonical origin — it is already what Better
 * Auth uses to build password-reset and verification links — so reusing it
 * keeps every outbound link pointing at the same host instead of introducing
 * a second source of truth for "where does this deployment live".
 */
export function buildInviteUrl(
  env: Pick<AppBindings, "BETTER_AUTH_URL">,
  token: string,
): string {
  const baseUrl = env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
  return `${baseUrl}/invite/${token}`;
}

/**
 * Send the workspace invitation email.
 *
 * Why this exists at all: before audit finding 03 was fixed, creating an
 * invitation only wrote a row and — if the invitee already had an account —
 * created an in-app notification. Anyone *without* an account received
 * nothing whatsoever, so onboarding a new person through the product was
 * impossible. This is the delivery step that was missing.
 *
 * Why it never throws: the invitation row is already committed by the time
 * this runs, and the caller dispatches it through `deferWork`. A dead mail
 * provider must not delay the 201, and must not turn a successful invitation
 * into a 500 that tells the admin to retry — the retry would then trip the
 * duplicate-pending-invite guard and leave them stuck. Failures are logged;
 * the copy-link control in the members UI is the operator's recovery path.
 *
 * With no `RESEND_API_KEY` — the default for self-hosted installs —
 * `createEmailService` returns the console transport, so the link stays
 * visible in the logs rather than being silently discarded.
 *
 * Why the sender goes through `resolveEmailFrom` rather than `env.EMAIL_FROM`:
 * this path used to pass the raw binding, so an install with `RESEND_API_KEY`
 * set but `EMAIL_FROM` unset sent Resend `from: undefined`, got a 4xx, and had
 * it swallowed by the catch below — while password-reset and verification mail
 * (which applied a fallback in `auth.ts`) kept working. "Mail works, except
 * invitations, and nothing says so" is the hardest failure mode to diagnose
 * from the outside, and it defeated the whole point of wiring delivery up.
 */
async function sendInvitationEmail(
  c: Context<AppEnv>,
  args: {
    recipientEmail: string;
    workspaceName: string;
    inviterName: string;
    role: string;
    token: string;
  },
): Promise<void> {
  try {
    const env = c.env;
    const emailService = createEmailService({
      RESEND_API_KEY: env.RESEND_API_KEY,
      EMAIL_FROM: env.EMAIL_FROM,
    });
    const { subject, html, text } = workspaceInvitationEmail({
      workspaceName: args.workspaceName,
      inviterName: args.inviterName,
      role: args.role,
      url: buildInviteUrl(env, args.token),
    });
    await emailService.send({
      to: args.recipientEmail,
      from: resolveEmailFrom(env),
      subject,
      html,
      text,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        handler: "createInvitation",
        op: "sendInvitationEmail",
        email: args.recipientEmail,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// createInvitation
// ---------------------------------------------------------------------------

export async function createInvitation(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");
  const body = validJson(c, createInvitationSchema);

  // Batch: existing account for the invited address + existing pending
  // invitation + the *actor's* own membership row. All three are independent
  // (they need only `body.email` / `workspaceId` / `user.id`), so batching
  // costs one round-trip regardless of which branches below end up reading
  // which result.
  //
  // `body.email` is already canonical here — `createInvitationSchema`
  // normalises it and `validJson` returns the schema's output — so the
  // account lookup is a plain equality against the lowercased address the
  // `user` table stores. That is the fix for the stranded-invitee bug: the
  // lookup used to miss on any address the admin typed with a capital
  // letter, which suppressed the `invitation_received` notification for
  // someone who did in fact have an account. See `normalizeEmail`.
  const [userResult, invitationResult, actorResult] = await db.batch([
    db
      .select()
      .from(userTable)
      .where(eq(userTable.email, body.email))
      .limit(1),
    db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.workspaceId, workspaceId),
          eq(invitation.email, body.email),
          eq(invitation.status, "pending"),
        ),
      )
      .limit(1),
    db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, user.id),
        ),
      )
      .limit(1),
  ] as const);

  const [existingUser] = userResult;
  const [existingInvitation] = invitationResult;
  const [actorMembership] = actorResult;

  // Only the owner may create an admin, through the SAME predicate
  // `updateMemberRole` uses to gate promotion (`api/lib/workspace-roles.ts`).
  // Sharing it is the point: an admin blocked from promoting a member to admin
  // could otherwise invite a brand-new admin instead and reach the identical
  // end state through a different door, and a rule enforced on one of two
  // equivalent paths is not a rule — it just tells an attacker which door to
  // use. `mayGrantAdmin` is fail-closed on an absent actor, which is what makes
  // this safe to evaluate before the membership row has been proven to exist.
  //
  // Checked before the already-a-member and duplicate-invitation branches on
  // purpose. Those return 400s that describe the *invitee* ("User is already a
  // member", "A pending invitation already exists"), and an admin who is not
  // allowed to perform this action at all should not be able to use it as an
  // oracle for who is already in the workspace.
  //
  // Note what this deliberately does NOT restrict: inviting a plain `member`.
  // Admins keep the whole of the authority the audit assigned them; what they
  // lose is the ability to enlarge the tier that outranks their own peers.
  if (body.role === "admin" && !mayGrantAdmin(actorMembership)) {
    return errorResponse(
      c,
      "Only the workspace owner can invite someone as an admin",
      403,
    );
  }

  // Membership check is conditional — only runs if the user exists (needs existingUser.id)
  if (existingUser) {
    const [existingMember] = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, existingUser.id),
        ),
      )
      .limit(1);

    if (existingMember) {
      return errorResponse(c, "User is already a member of this workspace", 400);
    }
  }

  if (existingInvitation) {
    return errorResponse(c, "A pending invitation already exists for this email", 400);
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [created] = await db
    .insert(invitation)
    .values({
      id,
      workspaceId,
      email: body.email,
      role: body.role ?? "member",
      invitedBy: user.id,
      token,
      status: "pending",
      expiresAt,
      createdAt: now,
    })
    .returning();

  // Delivery + notification, off the response path.
  //
  // The email is sent to EVERY invitee, account or not — that asymmetry was
  // the whole of audit finding 03. The in-app notification is still only
  // meaningful for someone who already has an account to read it in, so it
  // stays conditional, but it is now an *addition* to delivery rather than a
  // substitute for it.
  const recipientId = existingUser?.id ?? null;
  deferWork(c, async () => {
    const [ws] = await db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);

    await sendInvitationEmail(c, {
      recipientEmail: body.email,
      workspaceName: ws?.name ?? "a workspace",
      inviterName: user.name || user.email,
      role: body.role ?? "member",
      token,
    });

    if (recipientId) {
      await createNotification(db, {
        userId: recipientId,
        type: "invitation_received",
        title: ws
          ? `You've been invited to join workspace "${ws.name}"`
          : `You've been invited to join a workspace`,
        actorId: user.id,
        workspaceId,
        invitationId: id,
      });
    }
  });

  // Non-blocking webhook dispatch for invitation.created
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: user.id }, [
    { event: "invitation.created", data: buildInvitationEventData(created) },
  ]);

  // `created` carries the raw token (it is the row as inserted); the response
  // must not. See the token handling policy above — admins recover the link
  // from `getInvitationLink`, never from a body they did not explicitly ask
  // for.
  return c.json({ invitation: toPublicInvitation(created) }, 201);
}

// ---------------------------------------------------------------------------
// listInvitations
// ---------------------------------------------------------------------------

export async function listInvitations(c: Context<AppEnv>) {
  const db = c.get("db");
  const workspaceId = requireParam(c, "workspaceId");

  // Projected, not `select()` — the admin members page needs email/role/dates
  // to render the pending list and nothing more. Shipping the token to every
  // admin on every page load was audit finding 04's second half.
  const invitations = await db
    .select(INVITATION_PUBLIC_COLUMNS)
    .from(invitation)
    .where(
      and(
        eq(invitation.workspaceId, workspaceId),
        eq(invitation.status, "pending"),
      ),
    );

  return c.json({ invitations });
}

// ---------------------------------------------------------------------------
// getInvitationLink
// ---------------------------------------------------------------------------

/**
 * Return the shareable `/invite/:token` URL for a single pending invitation.
 *
 * This is the "copy invite link" control in the workspace members page, and
 * the permanent fallback for the case the invitation email never arrives —
 * a bounced address, an aggressive spam filter, or a deployment with no mail
 * provider configured at all. Without it, a failed delivery is unrecoverable
 * except by revoking and re-inviting.
 *
 * Why a dedicated endpoint instead of a `token` field on the list: this is a
 * deliberate, per-invitation, admin-authenticated request. The list response
 * is fetched on every visit to the members page and cached by the client;
 * folding a bearer credential into it multiplies the number of places the
 * secret comes to rest, which is exactly the exposure audit finding 04
 * described. Reachability is unchanged (the same admins could always revoke
 * and re-issue) — what changes is that the token is handed over on request
 * rather than broadcast.
 *
 * Only *pending* invitations expose a link. A revoked or already-accepted
 * token is dead weight — surfacing it would invite an admin to paste a link
 * that cannot work.
 */
export async function getInvitationLink(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, id } = requireParams(c, "workspaceId", "id");

  const [inv] = await db
    .select({ token: invitation.token, status: invitation.status, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(and(eq(invitation.id, id), eq(invitation.workspaceId, workspaceId)))
    .limit(1);

  if (!inv) {
    return errorResponse(c, "Invitation not found", 404);
  }

  if (inv.status !== "pending") {
    return errorResponse(c, `Invitation is ${inv.status}`, 400);
  }

  if (inv.expiresAt < new Date()) {
    return errorResponse(c, "Invitation has expired", 400);
  }

  return c.json({ url: buildInviteUrl(c.env, inv.token), expiresAt: inv.expiresAt });
}

// ---------------------------------------------------------------------------
// revokeInvitation
// ---------------------------------------------------------------------------

export async function revokeInvitation(c: Context<AppEnv>) {
  const db = c.get("db");
  const { workspaceId, id } = requireParams(c, "workspaceId", "id");

  const [existing] = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!existing) {
    return errorResponse(c, "Invitation not found", 404);
  }

  await db
    .update(invitation)
    .set({ status: "revoked" })
    .where(eq(invitation.id, id));

  // Non-blocking webhook dispatch for invitation.revoked
  const user = c.get("user")!;
  const revokedInvitation = { ...existing, status: "revoked" as const };
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId, actorId: user.id }, [
    { event: "invitation.revoked", data: buildInvitationEventData(revokedInvitation) },
  ]);

  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------
// listMyPendingInvitations — returns pending invitations for the authenticated user
// ---------------------------------------------------------------------------

export async function listMyPendingInvitations(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const db = c.get("db");

  // No `token` in this projection — see the token handling policy above.
  // Callers accept from this list with `{ invitationId }`, which the server
  // authorises against the session rather than treating as a secret.
  const rows = await db
    .select({
      id: invitation.id,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      inviterId: userTable.id,
      inviterName: userTable.name,
      inviterEmail: userTable.email,
    })
    .from(invitation)
    .leftJoin(workspace, eq(invitation.workspaceId, workspace.id))
    .leftJoin(userTable, eq(invitation.invitedBy, userTable.id))
    .where(
      and(
        // `normalizeEmail`, not the raw session address. Invited addresses are
        // canonical on write and were canonicalised in place by
        // `migrations/0036_normalize_invitation_email.sql`, so folding the
        // session side too makes both operands agree by construction. The
        // previous byte-for-byte `eq(invitation.email, user.email)` is what
        // returned an EMPTY list to an invitee whose invitation was addressed
        // with any capital letter — the failure was silent on both sides, and
        // with the token no longer surfaced in-app it left the emailed link as
        // their only way in.
        eq(invitation.email, normalizeEmail(user.email)),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    );

  const invitations = rows.map((r) => ({
    id: r.id,
    role: r.role,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    workspace: r.workspaceId
      ? { id: r.workspaceId, name: r.workspaceName }
      : null,
    invitedBy: r.inviterId
      ? { id: r.inviterId, name: r.inviterName, email: r.inviterEmail }
      : null,
  }));

  return c.json({ invitations });
}

// ---------------------------------------------------------------------------
// getInvitation (public — no auth required)
// ---------------------------------------------------------------------------

export async function getInvitation(c: Context<AppEnv>) {
  const db = c.get("db");
  const token = requireParam(c, "token");

  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.token, token))
    .limit(1);

  if (!inv) {
    return errorResponse(c, "Invitation not found", 404);
  }

  if (inv.status !== "pending") {
    return errorResponse(c, `Invitation is ${inv.status}`, 400);
  }

  if (inv.expiresAt < new Date()) {
    return errorResponse(c, "Invitation has expired", 400);
  }

  // Batch workspace + inviter lookups (both independent, both only need IDs from inv)
  let ws: { id: string; name: string } | undefined;
  let inviter: { id: string; name: string | null; email: string } | null = null;

  if (inv.invitedBy) {
    // Both workspace and inviter lookups are independent — batch them
    const [wsResult, inviterResult] = await db.batch([
      db
        .select({ id: workspace.id, name: workspace.name })
        .from(workspace)
        .where(eq(workspace.id, inv.workspaceId))
        .limit(1),
      db
        .select({ id: userTable.id, name: userTable.name, email: userTable.email })
        .from(userTable)
        .where(eq(userTable.id, inv.invitedBy))
        .limit(1),
    ] as const);

    [ws] = wsResult;
    inviter = inviterResult[0] ?? null;
  } else {
    // No inviter to look up — just fetch workspace
    [ws] = await db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, inv.workspaceId))
      .limit(1);
  }

  return c.json({
    invitation: {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      workspace: ws ? { id: ws.id, name: ws.name } : null,
      invitedBy: inviter,
    },
  });
}

// ---------------------------------------------------------------------------
// acceptInvitation
// ---------------------------------------------------------------------------

/**
 * Accept an invitation, selected by either the emailed `token` or — for a
 * signed-in invitee reading their in-app pending list — the invitation `id`.
 *
 * Both selectors converge on ONE validation path on purpose. The id selector
 * is a new, weaker-to-guess-but-more-widely-visible handle (workspace admins
 * see ids in `listInvitations`; the invitee sees theirs in the pending list),
 * so it can only ever be as powerful as the checks that follow the lookup.
 * Those checks are, in order and identically for both selectors:
 *
 *   1. the invitation exists                       → 404
 *   2. its status is still `pending`               → 409 (revoked/accepted)
 *   3. it has not expired                          → 400
 *   4. the session's email matches the invited one → 403
 *
 * Step 4 is the one that makes the id path safe: knowing an id is not
 * authority, being the invited mailbox is. That check in turn only means
 * something because `requireEmailVerification` is now enabled in
 * `src/api/lib/auth.ts` — before it was, anyone could register the invited
 * address and satisfy step 4 without ever proving they controlled the mailbox
 * (audit finding 04). The two changes are a matched pair; weakening either
 * re-opens the hole.
 *
 * Deliberately NOT a shortcut: there is no branch that trusts the id because
 * "the user must have seen it in their own pending list". The pending list is
 * a read, and a read is not a capability grant.
 */
export async function acceptInvitation(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const db = c.get("db");
  const body = validJson(c, acceptInvitationSchema);

  // Exactly one of the two selectors is present — `acceptInvitationSchema`
  // refines on it — so this picks a single lookup predicate with no fallback
  // that could match the wrong row. The final `else` is unreachable through
  // the validated route, and is kept as a fail-closed guard so that a future
  // caller reaching the handler directly gets a 400 rather than an
  // unconstrained query.
  let selector;
  if (body.token !== undefined) {
    selector = eq(invitation.token, body.token);
  } else if (body.invitationId !== undefined) {
    selector = eq(invitation.id, body.invitationId);
  } else {
    return errorResponse(c, "Provide exactly one of token or invitationId", 400);
  }

  const [inv] = await db
    .select()
    .from(invitation)
    .where(selector)
    .limit(1);

  if (!inv) {
    return errorResponse(c, "Invitation not found", 404);
  }

  if (inv.status !== "pending") {
    return errorResponse(c, `Invitation is ${inv.status}`, 409);
  }

  if (inv.expiresAt < new Date()) {
    return errorResponse(c, "Invitation has expired", 400);
  }

  // Verify the accepting user's email matches the invitation. Both sides go
  // through `normalizeEmail` so this site cannot drift from the write-side
  // rule and from `listMyPendingInvitations` — the three used to disagree,
  // which is what made an invitee visible to one and invisible to the others.
  if (normalizeEmail(inv.email) !== normalizeEmail(user.email)) {
    return errorResponse(c, "This invitation was sent to a different email address", 403);
  }

  // Check if user is already a workspace member
  const [existingMember] = await db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, inv.workspaceId),
        eq(workspaceMember.userId, user.id),
      ),
    )
    .limit(1);

  if (existingMember) {
    return errorResponse(c, "You are already a member of this workspace", 400);
  }

  const now = new Date();
  const newMemberId = crypto.randomUUID();

  // ---- Grant membership and consume the invitation, atomically -------------
  //
  // ## Why one batch and not two statements
  //
  // Accepting was a check-then-write: read the status, insert the membership,
  // then flip the status, with a hand-rolled compensating delete if the flip
  // threw. The `status !== "pending"` guard above is a *read*, and a read is
  // not a lock, so two concurrent accepts both passed it, both inserted, and
  // the unique index on `(workspaceId, userId)` rejected the loser — as an
  // unhandled 500. The data survived (that index is what audit finding 11
  // credited with preventing corruption) but the caller was told the server
  // was broken when their invitation had merely already been used.
  //
  // The obvious repair — claim the invitation first with a conditional UPDATE,
  // then insert — fixes the race but trades it for a worse failure. Between
  // the claim and the insert the invitation is consumed with no membership
  // behind it, and a compensating write only runs if an *error* is thrown, not
  // if the isolate is torn down. That window locks the invitee out
  // permanently, with no retry (the invitation is no longer pending) and no
  // signal to anyone. Availability failures that are invisible are worse than
  // the 500 we set out to remove.
  //
  // D1 runs `batch()` as a single implicit transaction — the same guarantee
  // `tasks/handlers/import.ts` already relies on, and verified against this
  // project's D1 rather than taken from the documentation. Putting both writes
  // in one batch removes every window: either the person is a member and the
  // invitation is spent, or neither happened and they can simply try again.
  // There is no compensating write left to get wrong, and no state a crash can
  // strand.
  //
  // ## Why the INSERT is a SELECT, and why it runs FIRST
  //
  // Both statements are guarded on `status = 'pending'`, and inside one
  // transaction both therefore see the same pre-state. The insert has to be
  // `INSERT … SELECT … WHERE status = 'pending'` rather than a plain VALUES
  // insert because a conditional UPDATE that matches zero rows is a *success*
  // in SQLite, not an error — a naive `[claim, insert]` batch would happily
  // grant membership from an invitation it had just failed to claim. Deriving
  // the inserted row from the invitation row makes the insert a no-op in
  // exactly the cases the claim is a no-op. The insert precedes the UPDATE
  // because the UPDATE is what makes `status` stop being `'pending'`.
  //
  // Role and inviter are read from the row inside SQL rather than from `inv`
  // for the same reason: they cannot be stale, because they come from the same
  // snapshot the guard is evaluated against.
  //
  // Three outcomes, all of them clean:
  //   * claim applied, insert applied  → 200
  //   * claim matched nothing          → nothing was written at all → 409
  //   * already a member               → unique index aborts and rolls back
  //                                      the whole batch → 400, and the
  //                                      invitation is left pending rather
  //                                      than burned
  const joinedAtSeconds = Math.floor(now.getTime() / 1000);

  let claimed: { id: string }[];
  try {
    [, claimed] = await db.batch([
      // `insert().select()` rather than a raw `db.run(sql)`: only a query
      // BUILDER can be a `db.batch()` item (the driver calls `_prepare()` on
      // each), and this form also makes Drizzle emit the target column list
      // from the table definition, so the projection below cannot silently
      // drift out of order if a column is ever added to `workspace_member`.
      db.insert(workspaceMember).select(
        sql`SELECT ${newMemberId}, "invitation"."workspaceId", ${user.id}, "invitation"."role", "invitation"."invitedBy", ${joinedAtSeconds}
            FROM "invitation"
            WHERE "invitation"."id" = ${inv.id} AND "invitation"."status" = 'pending'`,
      ),
      db
        .update(invitation)
        .set({ status: "accepted", acceptedAt: now })
        .where(and(eq(invitation.id, inv.id), eq(invitation.status, "pending")))
        .returning({ id: invitation.id }),
    ] as const);
  } catch (error) {
    // The batch rolled back, so nothing this request attempted survives.
    //
    // The reachable cause is a membership that already exists: two DIFFERENT
    // pending invitations to the same workspace for the same person, accepted
    // concurrently. `createInvitation`'s duplicate guard makes that rare rather
    // than impossible — rows predating the guard, or two invitations whose
    // addresses differed only in case before `migrations/0036`, both produce it.
    //
    // Classified by re-reading the row, never by matching the driver's error
    // text: message matching would stop working the day D1 rewords a constraint
    // error, and it would fail by turning this clean 400 back into the 500 this
    // change exists to remove.
    const [alreadyMember] = await db
      .select({ id: workspaceMember.id })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, inv.workspaceId),
          eq(workspaceMember.userId, user.id),
        ),
      )
      .limit(1);

    if (alreadyMember) {
      // Identical status and wording to the pre-flight check above: it is the
      // same fact, found a few milliseconds later. A client must not have to
      // handle two different answers to one question because of timing it
      // cannot observe.
      return errorResponse(c, "You are already a member of this workspace", 400);
    }

    throwWithContext(error, "acceptInvitation");
  }

  if (claimed.length === 0) {
    // Someone else accepted, or an admin revoked, between the read above and
    // this batch. The guarded insert made this a complete no-op, so there is
    // nothing to undo.
    //
    // Re-read rather than hardcode the wording so this answer is byte-identical
    // to the `status !== "pending"` branch earlier in the handler. Losing a race
    // and arriving late are the same fact from the caller's side, and returning
    // two different bodies for it would invite clients to branch on a
    // distinction that is pure timing.
    const [current] = await db
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.id, inv.id))
      .limit(1);

    return errorResponse(c, `Invitation is ${current?.status ?? "no longer pending"}`, 409);
  }

  // Non-blocking webhook dispatch for invitation.accepted and workspace.member_joined
  const acceptedInvitation = { ...inv, status: "accepted" as const };
  const joinedUser = { id: user.id, name: user.name, email: user.email };
  fireWebhookEvent(db, () => c.executionCtx, { workspaceId: inv.workspaceId, actorId: user.id }, [
    { event: "invitation.accepted", data: buildInvitationEventData(acceptedInvitation) },
    { event: "workspace.member_joined", data: buildMemberEventData({ userId: user.id, workspaceId: inv.workspaceId }, inv.role, joinedUser) },
  ]);

  return c.json({ ok: true, workspaceId: inv.workspaceId });
}
